import { query, readState } from "@/lib/db";
import { evaluateEmailSendCompliance } from "@/lib/outbound-compliance-runtime";
import { recordOutboundEventByMode } from "@/lib/outbound-event-ledger";
import { resolveOutboundRuntimeConfig } from "@/lib/outbound-runtime-config";
import { ensureLegacyCampaignVersionForAttribution } from "@/lib/outbound-revenue-attribution";
import { loadMailboxCredentials } from "@/lib/mailbox-credentials";

export const APPOINTMENT_GOAL_PER_DAY = 4;
export const LEAD_BUFFER_TARGET = 200;
const FALLBACK_APPOINTMENT_RATE = 0.025;
const MAX_RECOMMENDED_SENDS = 240;
const MIN_DAILY_SENDS_PER_MAILBOX = 30;

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

async function loadSenderHealth(workspace:string) {
  try {
    return await query<{
      target_id:string;health_status:string;recommended_daily_limit:number|null;enforced_daily_limit?:number|null
    }>(`
      select target_id,health_status,recommended_daily_limit,enforced_daily_limit
      from outbound_sender_health_state
      where workspace=$1 and target_type='mailbox'
    `,[workspace]);
  } catch {
    return [];
  }
}

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


type PflegeLeadPayload = {
  jobReferences?:Array<{title?:string}>;
  signals?:{jobTitles?:string[];websiteAudit?:{finding?:string}};
};

function stableVariant(seed:string) {
  let hash=2166136261;
  for(let i=0;i<seed.length;i++){hash^=seed.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0)%2===0 ? "A" : "B";
}

function cleanFinding(value:string) {
  return value.replace(/[–—]/g,",").replace(/\s+/g," ").replace(/[.!?]+$/,"").trim();
}

function personalizedFirstTouch(lead:{lead_id:string;company:string;contact:string;city:string;lead_payload:PflegeLeadPayload|null}) {
  const payload=lead.lead_payload||{};
  const title=String(payload.jobReferences?.[0]?.title||payload.signals?.jobTitles?.[0]||"Pflegefachkräfte").trim();
  const finding=cleanFinding(String(payload.signals?.websiteAudit?.finding||""));
  const greeting=lead.contact.trim() ? "Hallo "+lead.contact.trim().split(/\s+/)[0]+"," : "Hallo,";
  const variant=stableVariant(lead.lead_id||lead.company);
  if(variant==="B"){
    const area=lead.city.trim() ? " aus "+lead.city.trim() : " aus eurer Gegend";
    return {variant,subject:"kurze Frage",body:greeting+"\n\nWir sprechen gerade mit Pflegefachkräften"+area+", die offen für einen Wechsel sind. Sucht ihr aktuell noch Verstärkung?"};
  }
  const websitePart=finding ? " und habe kurz auf euren Karriereauftritt geschaut, "+finding.charAt(0).toLowerCase()+finding.slice(1) : "";
  return {variant,subject:title.length<80?title:"kurze Frage zur offenen Stelle",body:greeting+"\n\nBin gerade über eure Stelle für "+title+" gestolpert"+websitePart+". Läuft die Besetzung gerade zäh?"};
}

function conciseFollowUp(lead:{contact:string},stepIndex:number) {
  const greeting=lead.contact.trim() ? "Hallo "+lead.contact.trim().split(/\s+/)[0]+"," : "Hallo,";
  if(stepIndex===1)return {subject:"noch aktuell?",body:greeting+"\n\nIst das Thema bei euch noch aktuell? Wenn nicht, hake ich es direkt ab."};
  return {subject:"soll ich es abhaken?",body:greeting+"\n\nSoll ich das Thema bei euch erstmal abhaken oder sucht ihr noch?"};
}

export async function getAppointmentGoalSnapshot(workspace="default") {
  const [todayRow] = await query<{appointments:number}>(`
    with booked as (
      select lead_id from er_events
      where workspace=$1 and type in ('appointment','appointment_attended')
        and ${berlinDaySql("created_at")}

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

    )
    select
      (select count(*)::int from sent) sent,
      (select count(*)::int from booked b join sent s using(lead_id)) appointments
  `, [workspace]);

  const health = await loadSenderHealth(workspace);

  const state = (await readState(workspace).catch(() => null))?.payload as State | undefined;
  const credentials = await loadMailboxCredentials().catch(() => []);
  const configuredSettings = new Map((state?.mailboxes || []).map(m => [String(m.email || "").toLowerCase(),m]));
  const active = credentials.map(cred => {
    const setting = configuredSettings.get(String(cred.email || "").toLowerCase());
    return { id:cred.id, email:cred.email, enabled:setting?.enabled ?? true, dailyLimit:Number(setting?.dailyLimit || 30) };
  }).filter(m => m.enabled);
  const healthById = new Map(health.map(h => [h.target_id,h]));
  const safeCapacity = active.reduce((sum,m) => {
    const h = healthById.get(m.id);
    if (h?.health_status === "paused") return sum;
    const configured=Math.max(MIN_DAILY_SENDS_PER_MAILBOX,Number(m.dailyLimit||0));
    const recommended=h?.health_status==="healthy"
      ?Math.max(MIN_DAILY_SENDS_PER_MAILBOX,Number(h?.recommended_daily_limit??configured))
      :Number(h?.recommended_daily_limit??configured);
    return sum + Math.max(0,Math.min(configured,recommended));
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
    || (state?.campaigns || []).find(c => c.status === "Bereit" && c.steps?.length)
    || {
      id:"pflege-starter-v2",
      name:"Pflege Recruiting NRW",
      audience:"Private Pflegebetriebe in NRW mit aktivem Personalbedarf",
      status:"Bereit",
      dailyLimit:150,
      steps:[
        {waitDays:0,subject:"kurze Frage",body:"{{company}}"},
        {waitDays:3,subject:"noch aktuell?",body:"{{company}}"},
        {waitDays:7,subject:"soll ich es abhaken?",body:"{{company}}"},
      ],
    };

  const credentials = await loadMailboxCredentials().catch(() => []);
  const configured = new Map((state?.mailboxes || []).map(m => [String(m.email || "").toLowerCase(),m]));
  const mailboxes = credentials.map(cred => {
    const setting = configured.get(String(cred.email || "").toLowerCase());
    return {
      id:cred.id,
      email:cred.email,
      enabled:setting?.enabled ?? true,
      dailyLimit:Number(setting?.dailyLimit || 30),
    };
  }).filter(m => m.enabled);
  if (!mailboxes.length) {
    return { ok:false, skipped:true, reason:"no_active_mailboxes", snapshot:await getAppointmentGoalSnapshot(workspace) };
  }

  const health = await loadSenderHealth(workspace);
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
    const configured=Math.max(MIN_DAILY_SENDS_PER_MAILBOX,Number(m.dailyLimit||0));
    const healthLimit=h?.health_status==="healthy"
      ?Math.max(MIN_DAILY_SENDS_PER_MAILBOX,Number(h?.recommended_daily_limit??configured))
      :Number(h?.recommended_daily_limit??configured);
    const safe=h?.health_status==="paused"?0:Math.max(0,Math.min(configured,healthLimit));
    remainingByMailbox.set(m.id,Math.max(0,safe-(used.get(m.id)||0)));
  }
  let remainingCapacity = [...remainingByMailbox.values()].reduce((a,b)=>a+b,0);
  const enrollmentCapacity=remainingCapacity;
  if (remainingCapacity <= 0) {
    return { ok:true, queuedLeads:0, queuedMessages:0, reason:"safe_capacity_used", snapshot:await getAppointmentGoalSnapshot(workspace) };
  }

  const version = await ensureLegacyCampaignVersionForAttribution({
    campaignId:campaign.id,
    campaignName:campaign.name,
    audience:campaign.audience,
    steps:campaign.steps,
    workspace,
  }).catch(() => ({ id:null as string|null }));

  let queueSource:"pflege_email_outreach"|"crm"="pflege_email_outreach";
  let candidates:Array<{
    queue_id:string;lead_id:string;email:string;company:string;contact:string;city:string;lead_payload:PflegeLeadPayload|null
  }>=[];
  try {
    candidates = await query<{
      queue_id:string;lead_id:string;email:string;company:string;contact:string;city:string;lead_payload:PflegeLeadPayload|null
    }>(`
      select q.id::text queue_id,l.id lead_id,ct.email,c.name company,coalesce(ct.name,'') contact,coalesce(c.city,'') city,q.lead lead_payload
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
  } catch {
    queueSource="crm";
    candidates = await query<{
      queue_id:string;lead_id:string;email:string;company:string;contact:string;city:string;lead_payload:PflegeLeadPayload|null
    }>(`
      select
        l.id queue_id,
        l.id lead_id,
        ct.email,
        c.name company,
        coalesce(ct.name,'') contact,
        coalesce(c.city,'') city,
        jsonb_build_object(
          'jobReferences',jsonb_build_array(jsonb_build_object('title',coalesce(nullif(c.metadata->>'jobTitle',''),'Pflegefachkräfte'))),
          'signals',jsonb_build_object('jobTitles',jsonb_build_array(coalesce(nullif(c.metadata->>'jobTitle',''),'Pflegefachkräfte')))
        ) lead_payload
      from sales_leads l
      join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
      join sales_contacts ct on ct.id=l.contact_id and ct.workspace=l.workspace
      where l.workspace=$1
        and l.status='active'
        and l.stage in ('Neu','Research','Bereit')
        and coalesce(l.do_not_contact,false)=false
        and coalesce(ct.email,'')<>''
        and lower(coalesce(c.source,''))='pflegedienstjobs24'
        and not exists(select 1 from er_suppressions s where s.workspace=$1 and lower(s.email)=lower(ct.email))
        and not exists(select 1 from er_outbox o where o.workspace=$1 and o.campaign_id=$2 and o.lead_id=l.id and o.status not in ('failed','suppressed'))
      order by l.priority_score desc,l.updated_at desc
      limit 250
    `, [workspace,campaign.id]);
  }

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
        if(queueSource==="pflege_email_outreach") await query("update pflege_email_outreach set status='blocked',updated_at=now() where id=$1::uuid",[lead.queue_id]);
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

    const spreadMinutes=enrollmentCapacity<=1?0:Math.floor((queuedLeads*360)/Math.max(1,enrollmentCapacity-1));
    const firstTouchAt=Date.now()+spreadMinutes*60_000;
    const firstTouch=personalizedFirstTouch(lead);
    for (let stepIndex=0;stepIndex<campaign.steps.length;stepIndex++) {
      const step=campaign.steps[stepIndex];
      const scheduled = new Date(firstTouchAt+Math.max(0,step.waitDays)*86400000);
      const copy=stepIndex===0?firstTouch:conciseFollowUp(lead,stepIndex);
      await query(`
        insert into er_outbox(
          id,workspace,campaign_id,lead_id,mailbox_id,recipient,subject,body,variant,scheduled_at,campaign_version_id
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,[
        crypto.randomUUID(),workspace,campaign.id,lead.lead_id,mailbox.id,lead.email,
        copy.subject,copy.body,firstTouch.variant,scheduled,version.id,
      ]);
      queuedMessages++;
    }
    await query(
      "insert into er_events(workspace,lead_id,type,meta) values($1,$2,'experiment_assignment',$3::jsonb)",
      [workspace,lead.lead_id,JSON.stringify({campaignId:campaign.id,variant:firstTouch.variant,experiment:"pflege-personalized-2sentence-v1",source:"appointment_goal_queue"})],
    );

    if(queueSource==="pflege_email_outreach") await query("update pflege_email_outreach set status='approved',updated_at=now() where id=$1::uuid",[lead.queue_id]);
    await recordOutboundEventByMode({
      workspace,
      type:"send_planned",
      actorType:"workflow",
      leadId:lead.lead_id,
      campaignVersionId:version.id,
      idempotencyKey:`appointment-goal-enroll:${campaign.id}:${lead.lead_id}`,
      payload:{legacyCampaignId:campaign.id,mailboxId:mailbox.id,source:queueSource,spreadMinutes},
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
