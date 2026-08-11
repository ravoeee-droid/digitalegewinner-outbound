import { query, readState } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { getSecret } from "@/lib/secrets";

export const runtime = "nodejs";
export const maxDuration = 60;

type OutboxRow = { id:string; lead_id:string; mailbox_id:string; recipient:string; subject:string; body:string; attempts:number };
type Credential = { id:string; provider:"gmail"|"microsoft"|"smtp"; email:string; name?:string; accessToken?:string; refreshToken?:string; smtpHost?:string; smtpPort?:number; smtpUser?:string; smtpPass?:string };
type State = { mailboxes?: Array<{id:string;enabled:boolean;dailyLimit:number}> };

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}

async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error:"Unauthorized" }, { status:401 });
  const storedCredentials = await getSecret("mailbox_credentials_json").catch(() => "");
  let credentials: Credential[] = [];
  try { credentials = JSON.parse(process.env.MAILBOX_CREDENTIALS_JSON || storedCredentials || "[]") as Credential[]; }
  catch { return Response.json({ error:"Mailbox Credentials JSON ist ungültig." }, { status:503 }); }
  const credMap = new Map(credentials.map((c) => [c.id,c]));
  const state = (await readState().catch(() => null))?.payload as State | undefined;
  const limits = new Map((state?.mailboxes || []).filter((m) => m.enabled).map((m) => [m.id, Math.max(1, Math.min(100, Number(m.dailyLimit || 30)))]));
  const sentTodayRows = await query<{mailbox_id:string;count:string}>(
    `select mailbox_id,count(*)::text as count from er_outbox where status='sent' and sent_at>=date_trunc('day',now()) group by mailbox_id`
  );
  const sentToday = new Map(sentTodayRows.map((r) => [r.mailbox_id, Number(r.count)]));
  const due = await query<OutboxRow>(
    `select o.id,o.lead_id,o.mailbox_id,o.recipient,o.subject,o.body,o.attempts
     from er_outbox o
     where o.status='queued' and o.scheduled_at<=now()
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
     order by o.scheduled_at asc limit 100`
  );
  let sent=0, failed=0, skipped=0, limited=0;
  for (const row of due) {
    const credential = credMap.get(row.mailbox_id);
    if (!credential) { skipped++; continue; }
    const limit = limits.get(row.mailbox_id) ?? 30;
    const current = sentToday.get(row.mailbox_id) ?? 0;
    if (current >= limit) { limited++; continue; }
    try {
      await query("update er_outbox set status='sending',attempts=attempts+1 where id=$1 and status='queued'", [row.id]);
      const result = await sendMail({ ...credential, to:row.recipient, subject:row.subject, text:row.body });
      await query("update er_outbox set status='sent',sent_at=now(),provider_message_id=$2,error=null where id=$1", [row.id,result.id]);
      await query("insert into er_events(workspace,lead_id,type,meta) values('default',$1,'email_sent',$2::jsonb)", [row.lead_id,JSON.stringify({ outboxId:row.id, mailboxId:row.mailbox_id })]);
      sentToday.set(row.mailbox_id,current+1); sent++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Versandfehler";
      const nextStatus = row.attempts >= 2 ? "failed" : "queued";
      await query("update er_outbox set status=$2,error=$3,scheduled_at=now()+interval '30 minutes' where id=$1", [row.id,nextStatus,message]);
      failed++;
    }
  }
  return Response.json({ ok:true, processed:due.length, sent, failed, skipped, limited });
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
