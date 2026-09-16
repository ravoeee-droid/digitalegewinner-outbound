import { query, readState } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { loadMailboxCredentials, type StoredMailboxCredential } from "@/lib/mailbox-credentials";

export const runtime = "nodejs";
export const maxDuration = 60;

type OutboxRow = { id:string; lead_id:string; campaign_id:string|null; mailbox_id:string; recipient:string; subject:string; body:string; attempts:number };
type Credential = StoredMailboxCredential;
type State = { mailboxes?: Array<{id:string;email?:string;enabled:boolean;dailyLimit:number}>; campaigns?: Array<{id:string;status?:string;dailyLimit?:number}> };

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}

async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error:"Unauthorized" }, { status:401 });
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
      .map(({ id, known }) => [id, Math.max(1, Math.min(100, Number(known?.dailyLimit || 5)))] as const),
  );
  const campaignLimits = new Map((state?.campaigns || []).map((c) => [c.id, Math.max(1, Math.min(500, Number(c.dailyLimit || 150)))]));

  await query("update er_outbox set status='queued',scheduled_at=now()+interval '5 minutes',error='Stale send claim recovered' where workspace='default' and status='sending' and scheduled_at<now()-interval '15 minutes'");

  const sentTodayRows = await query<{mailbox_id:string;count:string}>(
    `select mailbox_id,count(*)::text as count from er_outbox where workspace='default' and status='sent' and sent_at>=date_trunc('day',now()) group by mailbox_id`
  );
  const sentToday = new Map(sentTodayRows.map((r) => [r.mailbox_id, Number(r.count)]));
  const campaignTodayRows = await query<{campaign_id:string;count:string}>(
    `select campaign_id,count(*)::text as count from er_outbox where workspace='default' and status='sent' and campaign_id is not null and sent_at>=date_trunc('day',now()) group by campaign_id`
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
     returning o.id,o.lead_id,o.campaign_id,o.mailbox_id,o.recipient,o.subject,o.body,o.attempts`
  );

  let sent=0, failed=0, limited=0;
  const skipped=0;
  for (const row of due) {
    const credential = credMap.get(row.mailbox_id);
    if (!credential) {
      await query("update er_outbox set status='failed',error='Keine Zugangsdaten für Mailbox-ID' where id=$1 and status='sending'", [row.id]);
      failed++; continue;
    }
    const mailboxLimit = mailboxLimits.get(row.mailbox_id) ?? 30;
    const mailboxCurrent = sentToday.get(row.mailbox_id) ?? 0;
    const campaignLimit = row.campaign_id && !row.campaign_id.startsWith("noshow:") ? (campaignLimits.get(row.campaign_id) ?? 150) : undefined;
    const campaignCurrent = row.campaign_id ? campaignToday.get(row.campaign_id) ?? 0 : 0;
    if (mailboxCurrent >= mailboxLimit || (campaignLimit !== undefined && campaignCurrent >= campaignLimit)) {
      await query("update er_outbox set status='queued',attempts=greatest(attempts-1,0),scheduled_at=now()+interval '60 minutes',error=null where id=$1 and status='sending'", [row.id]);
      limited++; continue;
    }
    try {
      const result = await sendMail({ ...credential, to:row.recipient, subject:row.subject, text:row.body });
      await query("update er_outbox set status='sent',sent_at=now(),provider_message_id=$2,error=null where id=$1 and status='sending'", [row.id,result.id]);
      await query("insert into er_events(workspace,lead_id,type,meta) values('default',$1,'email_sent',$2::jsonb)", [row.lead_id,JSON.stringify({ outboxId:row.id, mailboxId:row.mailbox_id, campaignId:row.campaign_id })]);
      sentToday.set(row.mailbox_id,mailboxCurrent+1);
      if(row.campaign_id)campaignToday.set(row.campaign_id,campaignCurrent+1);
      sent++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Versandfehler";
      const nextStatus = row.attempts >= 3 ? "failed" : "queued";
      await query("update er_outbox set status=$2,error=$3,scheduled_at=now()+interval '30 minutes' where id=$1 and status='sending'", [row.id,nextStatus,message]);
      failed++;
    }
  }
  return Response.json({ ok:true, claimed:due.length, sent, failed, skipped, limited });
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
