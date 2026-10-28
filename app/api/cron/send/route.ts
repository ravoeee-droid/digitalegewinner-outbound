import { query, queryIfTable, readStateFields } from "@/lib/db";
import { resolveSlots, withSignatureLink } from "@/lib/outreach-copy";
import { pvPageUrl } from "@/lib/pv-page";
import { sendMail } from "@/lib/mailer";
import { leadSegmentSql } from "@/lib/lead-segment";
import { loadMailboxCredentials, type StoredMailboxCredential } from "@/lib/mailbox-credentials";
import { recordOutboundEventByMode } from "@/lib/outbound-event-ledger";
import { resolveOutboundRuntimeConfig } from "@/lib/outbound-runtime-config";
import { evaluateEmailSendCompliance } from "@/lib/outbound-compliance-runtime";
import { getMailboxHealthMap } from "@/lib/outbound-deliverability";
import { recordOutboundConversationMessage } from "@/lib/outbound-conversation-intelligence";
import { recordExperimentExposureForSend } from "@/lib/outbound-experiment-engine";
import { applyBlocklist } from "@/lib/lead-blocklist";
import { trackedEmailHtml, unsubscribeUrl, videoPageUrl } from "@/lib/email-tracking";
import { sendAlertOnce } from "@/lib/alerts";

export const runtime = "nodejs";
export const maxDuration = 300;

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
const DEFAULT_DAILY_SENDS_PER_MAILBOX=5;
const PFLEGE_CAMPAIGN_DAILY_TARGET=150;
const KNOWN_CAMPAIGN_IDS=new Set(["pflege-starter-v2","pv-starter-v1"]);

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
  return minutes>=8*60&&minutes<=17*60+30;
}

async function run(request: Request) {
  const startedAt = Date.now();
  if (!authorized(request)) return Response.json({ error:"Unauthorized" }, { status:401 });
  if(!insideBusinessSendWindow()){
    return Response.json({ok:true,skipped:true,reason:"outside_berlin_business_window",window:"08:00-17:30 Europe/Berlin"});
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
  const state = (await readStateFields(["mailboxes", "campaigns"]).catch(() => null))?.payload as State | undefined;
  // state.mailboxes only carries the daily-limit/enabled toggle set via the "Domains & Mail" UI
  // (a display label, not a credential) - it must be keyed by the real credential id (credMap's
  // keys, what er_outbox.mailbox_id actually holds), joined by email, not by state.mailboxes' own id.
  const mailboxSettingsByEmail = new Map((state?.mailboxes || []).map((m) => [m.email?.toLowerCase(), m]));
  const mailboxLimits = new Map(
    credentials
      .map((c) => ({ id: c.id, known: mailboxSettingsByEmail.get(c.email?.toLowerCase()) }))
      .filter(({ known }) => known?.enabled ?? true)
      .map(({ id, known }) => [id, Math.max(1, Math.min(100, Number(known?.dailyLimit ?? DEFAULT_DAILY_SENDS_PER_MAILBOX)))] as const),
  );
  const campaignLimits = new Map((state?.campaigns || []).map((c) => [c.id, Math.max(1, Math.min(500, Number(c.dailyLimit || 150)))]));
  const healthMap = runtimeConfig.deliverabilityMode==="off"
    ? new Map()
    : await getMailboxHealthMap("default").catch(()=>new Map());

  await applyBlocklist().catch(() => null);
  // Die früheren Pflege- und PV-Textkampagnen wurden explizit durch Loom-Outreach ersetzt.
  // Die Sperre ist bewusst im Versandworker und nicht nur als UI-Status hinterlegt.
  await query(
    "update er_outbox set status='suppressed',error='Alte Textkampagne durch Loom-Video-Kampagne ersetzt' where workspace='default' and status='queued' and campaign_id in ('pflege-starter-v2','pv-starter-v1')",
  );

  await query("update er_outbox set status='queued',scheduled_at=now()+interval '5 minutes',error='Stale send claim recovered' where workspace='default' and status='sending' and scheduled_at<now()-interval '15 minutes'");

  const sentTodayRows = await query<{mailbox_id:string;count:string}>(
    `select mailbox_id,count(*)::text as count from er_outbox where workspace='default' and status='sent' and (sent_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date group by mailbox_id`
  );
  const sentToday = new Map(sentTodayRows.map((r) => [r.mailbox_id, Number(r.count)]));
  const campaignTodayRows = await query<{campaign_id:string;count:string}>(
    `select campaign_id,count(*)::text as count from er_outbox where workspace='default' and status='sent' and campaign_id is not null and (sent_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date group by campaign_id`
  );
  const campaignToday = new Map(campaignTodayRows.map((r) => [r.campaign_id, Number(r.count)]));

  // Harte Versand-Sperre: Die beiden Geschäftsfeldkampagnen dürfen ausschließlich
  // an passend klassifizierte Leads gehen. Uneindeutige Leads bleiben für Prüfung liegen.
  await query(`update er_outbox o set status='suppressed', error='Geschäftsfeld stimmt nicht zur Kampagne' 
    where o.workspace='default' and o.status='queued' and o.campaign_id in ('pv-starter-v1','pflege-starter-v2','pv-loom-150-v1','pflege-loom-150-v1')
      and not exists (select 1 from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
        where l.id::text=o.lead_id and l.workspace=o.workspace and ${leadSegmentSql("c")} =
          case when o.campaign_id in ('pv-starter-v1','pv-loom-150-v1') then 'pv' else 'pflege' end)`);

  // PV-Mails richten sich an die Geschäftsführung, nicht an Bewerbungs-/Personalpostfächer.
  await query("update er_outbox set status='suppressed',error='Personal-/Bewerbungsadresse (PV)' where workspace='default' and status='queued' and campaign_id in ('pv-starter-v1','pv-loom-150-v1') and recipient ~* '^(bewerbung|bewerbungen|bewerber|karriere|jobs?|hr|personal|recruiting|career|careers|application|applications|stellen|ausbildung)[._-]?[a-z0-9]*@'");
  // DG Loom requires a real company-specific screenshot; a video placeholder alone is insufficient.
  // This is campaign-specific and does not alter other customers' sending behavior.
  await query(`update er_outbox o set status='suppressed',error='Loom-Screenshot fehlt oder ist nicht mehr verfügbar'
    where o.workspace='default' and o.status='queued'
      and o.campaign_id in ('pflege-loom-150-v1','pv-loom-150-v1')
      and not exists(select 1 from lead_screenshots sc where sc.lead_id=o.lead_id and sc.status='ok')`);

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
         -- Safeguard: no new personalized Loom emails until the corresponding native MP4 is live.
         and (o.campaign_id not in ('pflege-loom-150-v1','pv-loom-150-v1')
              or exists (select 1 from loom_video_assets a where a.segment =
                case when o.campaign_id='pv-loom-150-v1' then 'pv' else 'pflege' end
                and a.video_url like 'https://%'))
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
  // Postfächer laufen parallel (jede Mail dauert mehrere Sekunden), Mails desselben Postfachs nacheinander.
  const handleRow = async (row: OutboxRow) => {
    // Zweite Sicherung gegen parallel bereits beanspruchte Alt-E-Mails.
    if(row.campaign_id==="pflege-starter-v2"||row.campaign_id==="pv-starter-v1"){
      await query("update er_outbox set status='suppressed',error='Alte Textkampagne beendet' where id=$1 and status='sending'",[row.id]);
      skipped++;
      return;
    }

    // Zeitbudget: Rest der Mails sofort wieder freigeben, statt vom Plattform-Timeout mitten im Versand abgebrochen zu werden.
    if (Date.now() - startedAt > 200_000) {
      await query("update er_outbox set status='queued',attempts=greatest(attempts-1,0),scheduled_at=now(),error=null where id=$1 and status='sending'", [row.id]);
      skipped++; return;
    }
    if (!mailboxLimits.has(row.mailbox_id)) {
      await query("update er_outbox set status='queued',attempts=greatest(attempts-1,0),scheduled_at=now()+interval '1 hour',error='Postfach deaktiviert oder nicht freigegeben' where id=$1 and status='sending'",[row.id]);
      limited++; return;
    }
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
      failed++; return;
    }
    const configuredMailboxLimit = Math.max(1, mailboxLimits.get(row.mailbox_id) ?? DEFAULT_DAILY_SENDS_PER_MAILBOX);
    const health = healthMap.get(row.mailbox_id) as {
      health_status?:string;
      recommended_daily_limit?:number|null;
      enforced_daily_limit?:number|null;
      observed_at?:Date|string;
      last_reason?:string|null;
    }|undefined;

    // Owner-requested one-day catch-up for the 250 paused Loom messages.
    // This cap is *only* for 28 October 2026; other campaigns and dates retain
    // their existing mailbox settings. All suppression, health and sector gates
    // below remain effective.
    const berlinDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const catchupLoom=berlinDate==="2026-10-28" && (row.campaign_id==="pflege-loom-150-v1"||row.campaign_id==="pv-loom-150-v1");
    let mailboxLimit=catchupLoom?Math.max(configuredMailboxLimit,30):configuredMailboxLimit;
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
        return;
      }
      const healthLimit=health.health_status==="healthy"
        ?Math.max(1,Number(health.enforced_daily_limit??configuredMailboxLimit))
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
      return;
    }
    const campaignLimit = row.campaign_id && !row.campaign_id.startsWith("noshow:") ? (KNOWN_CAMPAIGN_IDS.has(row.campaign_id) ? PFLEGE_CAMPAIGN_DAILY_TARGET : (campaignLimits.get(row.campaign_id) ?? 300)) : undefined;
    const campaignCurrent = row.campaign_id ? campaignToday.get(row.campaign_id) ?? 0 : 0;
    if (mailboxCurrent >= mailboxLimit || (campaignLimit !== undefined && campaignCurrent >= campaignLimit)) {
      await query("update er_outbox set status='queued',attempts=greatest(attempts-1,0),scheduled_at=now()+interval '60 minutes',error=null where id=$1 and status='sending'", [row.id]);
      limited++; return;
    }

    // Every actual email send must have a documented, verified contact permission.
    // Historical owner approval of a batch is not a per-contact legal permission.
    // Never allow an off/shadow runtime setting to bypass this final send-time gate.
    const sendComplianceMode="enforce" as const;
    if(sendComplianceMode!=="off"){
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
            mode:sendComplianceMode,
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

        if(sendComplianceMode==="enforce"&&!compliance.decision.allowed){
          await query(
            "update er_outbox set status='suppressed',error=$2 where id=$1 and status='sending'",
            [row.id,`Compliance gate: ${compliance.decision.reason}`],
          );
          skipped++;
          return;
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
            mode:sendComplianceMode,
            allowed:false,
            reason:"evaluation_error",
            error:message,
            legacyOutboxId:row.id,
            legacyCampaignId:row.campaign_id,
            variant:row.variant,
          },
        });
        if(sendComplianceMode==="enforce"){
          await query(
            "update er_outbox set status='queued',attempts=greatest(attempts-1,0),scheduled_at=now()+interval '60 minutes',error=$2 where id=$1 and status='sending'",
            [row.id,`Compliance evaluator unavailable: ${message}`],
          );
          skipped++;
          return;
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
      // Links in Mails zeigen auf die eigene App-Adresse (nicht auf die interne Vercel-Adresse des Cron-Aufrufs).
      const configured=(process.env.NEXT_PUBLIC_APP_URL||"").trim().replace(/\/+$/,"");
      const origin=/^https:\/\/[^\s/]+$/i.test(configured)?configured:new URL(request.url).origin;
      const optOut=unsubscribeUrl(origin,row.id,row.lead_id);
      const mailBody=resolveSlots(withSignatureLink(row.body)).replaceAll("{{pv_link}}",row.body.includes("{{pv_link}}")?await pvPageUrl():"").replaceAll("{{video_link}}",videoPageUrl(origin,row.lead_id));
      const html=trackedEmailHtml(mailBody,origin,row.id,row.lead_id,optOut);
      const text=`${mailBody}\n\n--\nKein Interesse an weiteren Nachrichten? Hier abmelden: ${optOut}`;
      const result = await sendMail({ ...credential, to:row.recipient, subject:row.subject, text, html, headers:{ "List-Unsubscribe":`<${optOut}>`, "List-Unsubscribe-Post":"List-Unsubscribe=One-Click" } });
      await query("update er_outbox set status='sent',sent_at=now(),provider_message_id=$2,error=null where id=$1 and status='sending'", [row.id,result.id]);
      // Ab hier ist die Mail beim Provider angenommen und in er_outbox als gesendet markiert.
      // Fehler in der Nachbearbeitung dürfen sie weder als "failed" zählen noch die Tageslimits umgehen.
      try{
        await queryIfTable("update pflege_email_outreach set status='sent',updated_at=now() where lower(email)=lower($1) and status='approved'", [row.recipient]);
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
      }catch(postSendError){
        console.error("[send-post-processing] failed",row.id,postSendError instanceof Error?postSendError.message:"unknown error");
      }
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
      if(/auth|login|credential|535|534|550|554|refused|timeout|ECONN/i.test(message))void sendAlertOnce(`send:${row.mailbox_id}`,`⚠️ Versand über ${row.mailbox_id} fehlgeschlagen\n${message.slice(0,300)}`,6);
    }
  };
  const byMailbox = new Map<string, OutboxRow[]>();
  for (const row of due) byMailbox.set(row.mailbox_id, [...(byMailbox.get(row.mailbox_id) || []), row]);
  await Promise.all([...byMailbox.values()].map(async (rows) => { for (const row of rows) await handleRow(row); }));
  console.log("[send]",JSON.stringify({claimed:due.length,sent,failed,skipped,limited,seconds:Math.round((Date.now()-startedAt)/1000)}));
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
