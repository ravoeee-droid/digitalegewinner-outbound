import { query, readState } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { loadMailboxCredentials, type StoredMailboxCredential } from "@/lib/mailbox-credentials";
import { recordOutboundEventByMode } from "@/lib/outbound-event-ledger";
import { resolveOutboundRuntimeConfig } from "@/lib/outbound-runtime-config";
import { evaluateEmailSendCompliance } from "@/lib/outbound-compliance-runtime";
import { getMailboxHealthMap } from "@/lib/outbound-deliverability";
import { recordOutboundConversationMessage } from "@/lib/outbound-conversation-intelligence";
import { recordExperimentExposureForSend } from "@/lib/outbound-experiment-engine";
import { trackedEmailHtml } from "@/lib/email-tracking";

export const runtime = "nodejs";
export const maxDuration = 60;

type OutboxRow = {
  id:string;
  lead_id:string;
  campaign_id:string|null;
  mailbox_id:string;
  recipient:string;
  subject:string;
  body:string;
  variant:string;
  attempts:number;
  campaign_version_id:string|null;
  experiment_id:string|null;
  experiment_arm_key:string|null;
};
type Credential = StoredMailboxCredential;
type State = { mailboxes?: Array<{id:string;email?:string;enabled:boolean;dailyLimit:number}>; campaigns?: Array<{id:string;status?:string;dailyLimit?:number}> };
const MIN_DAILY_SENDS_PER_MAILBOX=30;
const PFLEGE_CAMPAIGN_DAILY_TARGET=120;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}

function berlinClock(){
  const parts=new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/Berlin",
    weekday:"short",
    hour:"2-digit",
    minute:"2-digit",
    hour12:false,
  }).formatToParts(new Date());
  const value=(type:string)=>parts.find(part=>part.type===type)?.value||"";
  return {weekday:value("weekday"),hour:Number(value("hour")),minute:Number(value("minute"))};
}

function insideBusinessSendWindow(){
  const now=berlinClock();
  if(["Sat","Sun"].includes(now.weekday))return false;
  const minutes=now.hour*60+now.minute;
  return minutes>=8*60+30&&minutes<=17*60+30;
}

async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error:"Unauthorized" }, { status:401 });
  if(!insideBusinessSendWindow()){
    return Response.json({ok:true,skipped:true,reason:"outside_berlin_business_window",window:"08:30-17:30 Europe/Berlin"});
  }
  const runtimeConfig=await resolveOutboundRuntimeConfig();
  if (runtimeConfig.v3Mode === "active") {
    return Response.json(
      { error:"Legacy send worker is disabled while Outbound OS V3 is active." },
      { status:409 },
    );
  }
  let credentials: Credential[] = [];
  try { credentials = await loadMailboxCredentials(); }
  catch { return Response.json({ error:"Mailbox Credentials JSON ist ungültig." }, { status:503 }); }
  const credMap = new Map(credentials.map((c) => [c.id,c]));
  const state = (await readState().catch(() => null))?.payload as State | undefined;
  // state.mailboxes only carries the daily-limit/enabled toggle set via the "Domains & Mail" UI
  // (a display label, not a credential) - it must be keyed by the real credential id (credMap's
  // keys, what er_outbox.mailbox_id actually holds), joined by email, not by state.mailboxes' own id.
  const mailboxSettingsByEmail = new Map((state?.mailboxes || []).map((m) => [m.email?.toLowerCase(), m]));
  const mailboxLimits = new Map(
    credentials
      .map((c) => ({ id: c.id, known: mailboxSettingsByEmail.get(c.email?.toLowerCase()) }))
      .filter(({ known }) => known?.enabled ?? true)
      .map(({ id, known }) => [id, Math.max(MIN_DAILY_SENDS_PER_MAILBOX, Math.min(100, Number(known?.dailyLimit || MIN_DAILY_SENDS_PER_MAILBOX)))] as const),
  );
  const campaignLimits = new Map((state?.campaigns || []).map((c) => [c.id, Math.max(1, Math.min(500, Number(c.dailyLimit || 150)))]));
  const healthMap = runtimeConfig.deliverabilityMode==="off"
    ? new Map()
    : await getMailboxHealthMap("default").catch(()=>new Map());

  await query("update er_outbox set status='queued',scheduled_at=now()+interval '5 minutes',error='Stale send claim recovered' where workspace='default' and status='sending' and scheduled_at<now()-interval '15 minutes'");

  const sentTodayRows = await query<{mailbox_id:string;count:string}>(
    `select mailbox_id,count(*)::text as count from er_outbox where workspace='default' and status='sent' and (sent_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date group by mailbox_id`
  );
  const sentToday = new Map(sentTodayRows.map((r) => [r.mailbox_id, Number(r.count)]));
  const campaignTodayRows = await query<{campaign_id:string;count:string}>(
    `select campaign_id,count(*)::text as count from er_outbox where workspace='default' and status='sent' and campaign_id is not null and (sent_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date group by campaign_id`
  );
  const campaignToday = new Map(campaignTodayRows.map((r) => [r.campaign_id, Number(r.count)]));

  const due = await query<OutboxRow>(
    `with claim as (
       select o.id
       from er_outbox o
       left join sales_leads sl on sl.id=o.lead_id and sl.workspace='default'
       where o.workspace='default' and o.status='queued' and o.scheduled_at<=now()
         and not exists(select 1 from er_suppressions s where s.workspace=o.workspace and lower(s.email)=lower(o.recipient))
         and not exists(
           select 1 from er_events e
           where e.workspace=o.workspace and e.lead_id=o.lead_id
             and (
               e.type in ('reply','positive_reply')
               or (e.type='appointment' and coalesce(o.campaign_id,'') not like 'noshow:%')
               or (e.type='appointment_attended' and coalesce(o.campaign_id,'') like 'noshow:%')
             )
         )
         and (sl.id is null or (sl.stage not in ('Gewonnen','Verloren') and not sl.do_not_contact))
       order by o.scheduled_at asc
       for update of o skip locked
       limit 100
     )
     update er_outbox o
     set status='sending',attempts=o.attempts+1,scheduled_at=now()
     from claim
     where o.id=claim.id
     returning o.id,o.lead_id,o.campaign_id,o.mailbox_id,o.recipient,o.subject,o.body,o.variant,o.attempts,
               o.campaign_version_id,o.experiment_id,o.experiment_arm_key`
  );

  let sent=0, failed=0, limited=0, skipped=0, deliverabilityLimited=0, deliverabilityWouldLimit=0;
  const sentThisCycle=new Map<string,number>();
  for (const row of due) {
    const credential = credMap.get(row.mailbox_id);
    if (!credential) {
      await query("update er_outbox set status='failed',error='Keine Zugangsdaten für Mailbox-ID' where id=$1 and status='sending'", [row.id]);
      await recordOutboundEventByMode({
        workspace:"default",
        type:"send_failed",
        actorType:"system",
        leadId:row.lead_id,
        idempotencyKey:`legacy:send-failed:${row.id}:missing-credential`,
        payload:{
          legacyOutboxId:row.id,
          legacyCampaignId:row.campaign_id,
          variant:row.variant,
          mailboxId:row.mailbox_id,
          reason:"missing_mailbox_credentials",
        },
      });
      failed++; continue;
    }
    const configuredMailboxLimit = Math.max(MIN_DAILY_SENDS_PER_MAILBOX, mailboxLimits.get(row.mailbox_id) ?? MIN_DAILY_SENDS_PER_MAILBOX);
    const health = healthMap.get(row.mailbox_id) as {
      health_status?:string;
      recommended_daily_limit?:number|null;
      enforced_daily_limit?:number|null;
      observed_at?:Date|string;
      last_reason?:string|null;
    }|undefined;

    let mailboxLimit=configuredMailboxLimit;
    if(runtimeConfig.deliverabilityMode==="enforce"){
      const observedAt=health?.observed_at?new Date(health.observed_at).getTime():0;
      const stale=!observedAt||(Date.now()-observedAt)>3*60*60*1000;
      const paused=!health||stale||health.health_status==="paused"||Number(health.enforced_daily_limit??0)<=0;
      if(paused){
        const reason=!health?"health_state_missing":stale?"health_state_stale":health.last_reason||"sender_paused";
        await query(
          "update er_outbox set status='queued',attempts=greatest(attempts-1,0),scheduled_at=now()+interval '60 minutes',error=$2 where id=$1 and status='sending'",
          [row.id,`Deliverability gate: ${reason}`],
        );
        limited++;
        deliverabilityLimited++;
        continue;
      }
      const healthLimit=health.health_status==="healthy"
        ?Math.max(MIN_DAILY_SENDS_PER_MAILBOX,Number(health.enforced_daily_limit??configuredMailboxLimit))
        :Math.max(1,Number(health.enforced_daily_limit??configuredMailboxLimit));
      mailboxLimit=Math.min(configuredMailboxLimit,healthLimit);
    }else if(runtimeConfig.deliverabilityMode==="shadow"&&health){
      const recommended=Number(health.recommended_daily_limit??configuredMailboxLimit);
      if(recommended<configuredMailboxLimit)deliverabilityWouldLimit++;
    }

    const mailboxCurrent = sentToday.get(row.mailbox_id) ?? 0;
    const cycleCurrent=sentThisCycle.get(row.mailbox_id)??0;
    const cycleLimit=2;
    if(cycleCurrent>=cycleLimit){
      await query("update er_outbox set status='queued',attempts=greatest(attempts-1,0),scheduled_at=now()+interval '10 minutes',error=null where id=$1 and status='sending'", [row.id]);
      limited++;
      continue;
    }
    const campaignLimit = row.campaign_id && !row.campaign_id.startsWith("noshow:") ? (row.campaign_id==="pflege-starter-v2" ? Math.max(PFLEGE_CAMPAIGN_DAILY_TARGET,campaignLimits.get(row.campaign_id) ?? PFLEGE_CAMPAIGN_DAILY_TARGET) : (campaignLimits.get(row.campaign_id) ?? 150)) : undefined;
    const campaignCurrent = row.campaign_id ? campaignToday.get(row.campaign_id) ?? 0 : 0;
    if (mailboxCurrent >= mailboxLimit || (campaignLimit !== undefined && campaignCurrent >= campaignLimit)) {
      await query("update er_outbox set status='queued',attempts=greatest(attempts-1,0),scheduled_at=now()+interval '60 minutes',error=null where id=$1 and status='sending'", [row.id]);
      limited++; continue;
    }

    if(runtimeConfig.complianceMode!=="off"){
      try{
        const compliance=await evaluateEmailSendCompliance(row.lead_id,row.recipient);
        await recordOutboundEventByMode({
          workspace:"default",
          type:compliance.decision.allowed?"permission_verified":"permission_denied",
          actorType:"system",
          companyId:compliance.companyId,
          contactId:compliance.contactId,
          leadId:row.lead_id,
          idempotencyKey:`compliance:email:${row.id}:${compliance.decision.policyVersion}`,
          payload:{
            mode:runtimeConfig.complianceMode,
            allowed:compliance.decision.allowed,
            reason:compliance.decision.reason,
            policyVersion:compliance.decision.policyVersion,
            jurisdiction:compliance.jurisdiction,
            permissionId:compliance.permission?.id||null,
            permissionBasis:compliance.permission?.basis||null,
            permissionStatus:compliance.permission?.status||null,
            legacyOutboxId:row.id,
            legacyCampaignId:row.campaign_id,
            variant:row.variant,
          },
        });

        if(runtimeConfig.complianceMode==="enforce"&&!compliance.decision.allowed){
          await query(
            "update er_outbox set status='suppressed',error=$2 where id=$1 and status='sending'",
            [row.id,`Compliance gate: ${compliance.decision.reason}`],
          );
          skipped++;
          continue;
        }
      }catch(error){
        const message=error instanceof Error?error.message:"Compliance evaluation failed";
        await recordOutboundEventByMode({
          workspace:"default",
          type:"permission_denied",
          actorType:"system",
          leadId:row.lead_id,
          idempotencyKey:`compliance-error:email:${row.id}:${row.attempts}`,
          payload:{
            mode:runtimeConfig.complianceMode,
            allowed:false,
            reason:"evaluation_error",
            error:message,
            legacyOutboxId:row.id,
            legacyCampaignId:row.campaign_id,
            variant:row.variant,
          },
        });
        if(runtimeConfig.complianceMode==="enforce"){
          await query(
            "update er_outbox set status='queued',attempts=greatest(attempts-1,0),scheduled_at=now()+interval '60 minutes',error=$2 where id=$1 and status='sending'",
            [row.id,`Compliance evaluator unavailable: ${message}`],
          );
          skipped++;
          continue;
        }
      }
    }

    try {
      await recordOutboundEventByMode({
        workspace:"default",
        type:"send_attempted",
        actorType:"workflow",
        leadId:row.lead_id,
        idempotencyKey:`legacy:send-attempted:${row.id}:${row.attempts}`,
        payload:{
          legacyOutboxId:row.id,
          legacyCampaignId:row.campaign_id,
          variant:row.variant,
          mailboxId:row.mailbox_id,
          recipient:row.recipient,
          attempt:row.attempts,
        },
      });
      const origin=new URL(request.url).origin;
      const html=trackedEmailHtml(row.body,origin,row.id,row.lead_id);
      const result = await sendMail({ ...credential, to:row.recipient, subject:row.subject, text:row.body, html });
      await query("update er_outbox set status='sent',sent_at=now(),provider_message_id=$2,error=null where id=$1 and status='sending'", [row.id,result.id]);
      await query("update pflege_email_outreach set status='sent',updated_at=now() where lower(email)=lower($1) and status='approved'", [row.recipient]);
      await query("insert into er_events(workspace,lead_id,type,meta) values('default',$1,'email_sent',$2::jsonb)", [row.lead_id,JSON.stringify({ outboxId:row.id, mailboxId:row.mailbox_id, campaignId:row.campaign_id, variant:row.variant })]);
      await recordOutboundEventByMode({
        workspace:"default",
        type:"provider_accepted",
        actorType:"provider",
        leadId:row.lead_id,
        messageId:result.id,
        idempotencyKey:`legacy:provider-accepted:${row.id}:${result.id}`,
        payload:{
          legacyOutboxId:row.id,
          legacyCampaignId:row.campaign_id,
          variant:row.variant,
          mailboxId:row.mailbox_id,
          recipient:row.recipient,
          providerMessageId:result.id,
        },
      });
      try{
        await recordExperimentExposureForSend({
          experimentId:row.experiment_id,
          campaignVersionId:row.campaign_version_id,
          armKey:row.experiment_arm_key,
          leadId:row.lead_id,
          legacyCampaignId:row.campaign_id,
          legacyOutboxId:row.id,
          providerMessageId:result.id,
          workspace:"default",
        });
      }catch(experimentError){
        console.error("[experiment-exposure] failed",experimentError instanceof Error?experimentError.message:"unknown error");
      }
      try{
        await recordOutboundConversationMessage({
          leadId:row.lead_id,
          mailboxId:row.mailbox_id,
          providerMessageId:result.id,
          subject:row.subject,
          bodyText:row.body,
          sentAt:new Date(),
          metadata:{
            legacyOutboxId:row.id,
            legacyCampaignId:row.campaign_id,
            variant:row.variant,
            recipient:row.recipient,
            experimentId:row.experiment_id,
            experimentArmKey:row.experiment_arm_key,
          },
        });
      }catch(conversationError){
        console.error("[conversation-outbound-mirror] failed",conversationError instanceof Error?conversationError.message:"unknown error");
      }
      sentToday.set(row.mailbox_id,mailboxCurrent+1);
      sentThisCycle.set(row.mailbox_id,cycleCurrent+1);
      if(row.campaign_id)campaignToday.set(row.campaign_id,campaignCurrent+1);
      sent++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Versandfehler";
      const nextStatus = row.attempts >= 3 ? "failed" : "queued";
      await query("update er_outbox set status=$2,error=$3,scheduled_at=now()+interval '30 minutes' where id=$1 and status='sending'", [row.id,nextStatus,message]);
      await recordOutboundEventByMode({
        workspace:"default",
        type:nextStatus === "failed" ? "send_failed" : "send_deferred",
        actorType:"workflow",
        leadId:row.lead_id,
        idempotencyKey:`legacy:${nextStatus === "failed" ? "send-failed" : "send-deferred"}:${row.id}:${row.attempts}`,
        payload:{
          legacyOutboxId:row.id,
          legacyCampaignId:row.campaign_id,
          variant:row.variant,
          mailboxId:row.mailbox_id,
          recipient:row.recipient,
          attempt:row.attempts,
          error:message,
        },
      });
      failed++;
    }
  }
  return Response.json({
    ok:true,
    claimed:due.length,
    sent,
    failed,
    skipped,
    limited,
    deliverabilityMode:runtimeConfig.deliverabilityMode,
    deliverabilityLimited,
    deliverabilityWouldLimit,
  });
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
