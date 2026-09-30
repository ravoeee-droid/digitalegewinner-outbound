import { query, readState } from "@/lib/db";
import { evaluateEmailSendCompliance } from "@/lib/outbound-compliance-runtime";
import { recordOutboundEventByMode } from "@/lib/outbound-event-ledger";
import { resolveOutboundRuntimeConfig } from "@/lib/outbound-runtime-config";
import { ensureLegacyCampaignVersionForAttribution } from "@/lib/outbound-revenue-attribution";

export const APPOINTMENT_GOAL_PER_DAY = 4;
export const LEAD_BUFFER_TARGET = 200;
const FALLBACK_APPOINTMENT_RATE = 0.025;
const MAX_RECOMMENDED_SENDS = 240;

type CampaignStep = { waitDays:number; subject:string; body:string };
type Campaign = {
  id:string;
  name?:string;
  audience?:string;
  status?:string;
  dailyLimit?:number;
  steps:CampaignStep[];
};
type Mailbox = { id:string; email?:string; enabled:boolean; dailyLimit:number };
type State = { campaigns?:Campaign[]; mailboxes?:Mailbox[] };

function berlinDaySql(column:string) {
  return `(${column} at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date`;
}

function render(template:string, lead:{company:string; contact:string; city:string}, senderName:string) {
  const first = lead.contact.trim().split(/\s+/)[0] || "zusammen";
  return template
    .replaceAll("{{first_name}}", first)
    .replaceAll("{{company}}", lead.company)
    .replaceAll("{{city}}", lead.city)
    .replaceAll("{{sender_name}}", senderName);
}

export async function getAppointmentGoalSnapshot(workspace="default") {
  const [todayRow] = await query<{appointments:number}>(`
    with booked as (
      select lead_id from er_events
      where workspace=$1 and type in ('appointment','appointment_attended')
        and ${berlinDaySql("created_at")}
      union
      select lead_id from outbound_events
      where workspace=$1 and event_type='meeting_booked'
        and ${berlinDaySql("occurred_at")}
    )
    select count(distinct lead_id)::int appointments from booked where lead_id is not null
  `, [workspace]);

  const [history] = await query<{sent:number;appointments:number}>(`
    with sent as (
      select distinct lead_id
      from er_outbox
      where workspace=$1 and status='sent' and sent_at>=now()-interval '14 days'
    ),
    booked as (
      select distinct lead_id from er_events
      where workspace=$1 and type in ('appointment','appointment_attended')
        and created_at>=now()-interval '14 days'
      union
      select distinct lead_id from outbound_events
      where workspace=$1 and event_type='meeting_booked'
        and occurred_at>=now()-interval '14 days'
    )
    select
      (select count(*)::int from sent) sent,
      (select count(*)::int from booked b join sent s using(lead_id)) appointments
  `, [workspace]);

  const health = await query<{
    target_id:string;health_status:string;recommended_daily_limit:number|null;enforced_daily_limit:number|null
  }>(`
    select target_id,health_status,recommended_daily_limit,enforced_daily_limit
    from outbound_sender_health_state
    where workspace=$1 and target_type='mailbox'
  `, [workspace]);

  const state = (await readState(workspace).catch(() => null))?.payload as State | undefined;
  const active = (state?.mailboxes || []).filter(m => m.enabled);
  const healthById = new Map(health.map(h => [h.target_id,h]));
  const safeCapacity = active.reduce((sum,m) => {
    const h = healthById.get(m.id);
    if (h?.health_status === "paused") return sum;
    const recommended = Number(h?.recommended_daily_limit ?? m.dailyLimit ?? 0);
    return sum + Math.max(0, Math.min(Number(m.dailyLimit || 0), recommended || Number(m.dailyLimit || 0)));
  }, 0);

  const sent14 = Number(history?.sent || 0);
  const booked14 = Number(history?.appointments || 0);
  const observedRate = sent14 >= 40 ? booked14 / Math.max(1,sent14) : 0;
  const planningRate = observedRate > 0 ? observedRate : FALLBACK_APPOINTMENT_RATE;
  const recommendedDailySends = Math.min(
    MAX_RECOMMENDED_SENDS,
    Math.max(LEAD_BUFFER_TARGET > 120 ? 120 : LEAD_BUFFER_TARGET, Math.ceil(APPOINTMENT_GOAL_PER_DAY / planningRate)),
  );

  const appointmentsToday = Number(todayRow?.appointments || 0);
  return {
    goal: APPOINTMENT_GOAL_PER_DAY,
    appointmentsToday,
    remainingAppointments: Math.max(0, APPOINTMENT_GOAL_PER_DAY - appointmentsToday),
    sent14,
    booked14,
    observedAppointmentRate: observedRate,
    planningAppointmentRate: planningRate,
    recommendedDailySends,
    safeDailyCapacity: safeCapacity,
    capacityGap: Math.max(0, recommendedDailySends - safeCapacity),
    leadBufferTarget: LEAD_BUFFER_TARGET,
  };
}

export async function ensureAppointmentGoalQueue(workspace="default") {
  const runtime = await resolveOutboundRuntimeConfig();
  if (runtime.v3Mode === "active") {
    return { ok:false, skipped:true, reason:"legacy_worker_disabled", snapshot:await getAppointmentGoalSnapshot(workspace) };
  }

  const row = await readState(workspace);
  const state = row?.payload as State | undefined;
  const campaign = (state?.campaigns || []).find(c => c.id === "pflege-starter-v2")
    || (state?.campaigns || []).find(c => c.status === "Bereit" && c.steps?.length);
  if (!campaign?.steps?.length) {
    return { ok:false, skipped:true, reason:"no_ready_campaign", snapshot:await getAppointmentGoalSnapshot(workspace) };
  }

  const mailboxes = (state?.mailboxes || []).filter(m => m.enabled && Number(m.dailyLimit || 0) > 0);
  if (!mailboxes.length) {
    return { ok:false, skipped:true, reason:"no_active_mailboxes", snapshot:await getAppointmentGoalSnapshot(workspace) };
  }

  const health = await query<{
    target_id:string;health_status:string;recommended_daily_limit:number|null
  }>(`
    select target_id,health_status,recommended_daily_limit
    from outbound_sender_health_state
    where workspace=$1 and target_type='mailbox'
  `, [workspace]);
  const healthById = new Map(health.map(h => [h.target_id,h]));

  const sentRows = await query<{mailbox_id:string;count:number}>(`
    select mailbox_id,count(*)::int count
    from er_outbox
    where workspace=$1 and status='sent' and ${berlinDaySql("sent_at")}
    group by mailbox_id
  `, [workspace]);
  const queuedRows = await query<{mailbox_id:string;count:number}>(`
    select mailbox_id,count(*)::int count
    from er_outbox
    where workspace=$1 and status='queued'
      and scheduled_at < date_trunc('day', now() at time zone 'Europe/Berlin') + interval '1 day'
    group by mailbox_id
  `, [workspace]);
  const used = new Map<string,number>();
  for (const r of [...sentRows,...queuedRows]) used.set(r.mailbox_id,(used.get(r.mailbox_id)||0)+Number(r.count||0));

  const remainingByMailbox = new Map<string,number>();
  for (const m of mailboxes) {
    const h = healthById.get(m.id);
    const safe = h?.health_status === "paused" ? 0 : Math.max(
      0,
      Math.min(Number(m.dailyLimit || 0), Number(h?.recommended_daily_limit ?? m.dailyLimit ?? 0)),
    );
    remainingByMailbox.set(m.id,Math.max(0,safe-(used.get(m.id)||0)));
  }
  let remainingCapacity = [...remainingByMailbox.values()].reduce((a,b)=>a+b,0);
  if (remainingCapacity <= 0) {
    return { ok:true, queuedLeads:0, queuedMessages:0, reason:"safe_capacity_used", snapshot:await getAppointmentGoalSnapshot(workspace) };
  }

  const version = await ensureLegacyCampaignVersionForAttribution({
    campaignId:campaign.id,
    campaignName:campaign.name,
    audience:campaign.audience,
    steps:campaign.steps,
    workspace,
  });

  const candidates = await query<{
    queue_id:string;lead_id:string;email:string;company:string;contact:string;city:string
  }>(`
    select q.id::text queue_id,l.id lead_id,ct.email,c.name company,coalesce(ct.name,'') contact,coalesce(c.city,'') city
    from pflege_email_outreach q
    join sales_contacts ct on lower(ct.email)=lower(q.email) and ct.workspace=$1
    join sales_leads l on l.contact_id=ct.id and l.workspace=$1
    join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
    where q.status in ('draft','approved')
      and q.lead_date >= (now() at time zone 'Europe/Berlin')::date - 30
      and l.status='active'
      and l.stage in ('Neu','Research','Bereit')
      and coalesce(l.do_not_contact,false)=false
      and not exists(select 1 from er_suppressions s where s.workspace=$1 and lower(s.email)=lower(q.email))
      and not exists(select 1 from er_outbox o where o.workspace=$1 and o.campaign_id=$2 and o.lead_id=l.id and o.status not in ('failed','suppressed'))
    order by
      case when q.lead_date=(now() at time zone 'Europe/Berlin')::date then 0 else 1 end,
      q.lead_date desc,
      q.rank asc
    limit 250
  `, [workspace,campaign.id]);

  let queuedLeads=0, queuedMessages=0, complianceBlocked=0;
  let mailboxIndex=0;
  const senderName = "Raphael Hermann";

  for (const lead of candidates) {
    if (remainingCapacity <= 0) break;

    if (runtime.complianceMode !== "off") {
      const compliance = await evaluateEmailSendCompliance(lead.lead_id,lead.email,workspace);
      await recordOutboundEventByMode({
        workspace,
        type:compliance.decision.allowed ? "permission_verified" : "permission_denied",
        actorType:"system",
        leadId:lead.lead_id,
        idempotencyKey:`appointment-goal-compliance:${campaign.id}:${lead.lead_id}:${compliance.decision.reason}`,
        payload:{stage:"appointment_goal_queue",allowed:compliance.decision.allowed,reason:compliance.decision.reason,mode:runtime.complianceMode},
      });
      if (runtime.complianceMode === "enforce" && !compliance.decision.allowed) {
        complianceBlocked++;
        await query("update pflege_email_outreach set status='blocked',updated_at=now() where id=$1::uuid",[lead.queue_id]);
        continue;
      }
    }

    let mailbox:Mailbox|undefined;
    for (let tries=0;tries<mailboxes.length;tries++) {
      const candidate = mailboxes[(mailboxIndex+tries)%mailboxes.length];
      if ((remainingByMailbox.get(candidate.id)||0) > 0) {
        mailbox=candidate;
        mailboxIndex=(mailboxIndex+tries+1)%mailboxes.length;
        break;
      }
    }
    if (!mailbox) break;

    for (const step of campaign.steps) {
      const scheduled = new Date(Date.now()+Math.max(0,step.waitDays)*86400000);
      await query(`
        insert into er_outbox(
          id,workspace,campaign_id,lead_id,mailbox_id,recipient,subject,body,variant,scheduled_at,campaign_version_id
        ) values($1,$2,$3,$4,$5,$6,$7,$8,'A',$9,$10)
      `,[
        crypto.randomUUID(),workspace,campaign.id,lead.lead_id,mailbox.id,lead.email,
        render(step.subject,lead,senderName),render(step.body,lead,senderName),scheduled,version.id,
      ]);
      queuedMessages++;
    }

    await query("update pflege_email_outreach set status='approved',updated_at=now() where id=$1::uuid",[lead.queue_id]);
    await recordOutboundEventByMode({
      workspace,
      type:"send_planned",
      actorType:"workflow",
      leadId:lead.lead_id,
      campaignVersionId:version.id,
      idempotencyKey:`appointment-goal-enroll:${campaign.id}:${lead.lead_id}`,
      payload:{legacyCampaignId:campaign.id,mailboxId:mailbox.id,source:"pflege_email_outreach"},
    });

    remainingByMailbox.set(mailbox.id,(remainingByMailbox.get(mailbox.id)||0)-1);
    remainingCapacity--;
    queuedLeads++;
  }

  return {
    ok:true,
    campaignId:campaign.id,
    campaignVersionId:version.id,
    queuedLeads,
    queuedMessages,
    complianceBlocked,
    snapshot:await getAppointmentGoalSnapshot(workspace),
  };
}
