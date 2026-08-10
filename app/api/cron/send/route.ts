import { query } from "@/lib/db";
import { sendMail } from "@/lib/mailer";

export const runtime = "nodejs";
export const maxDuration = 60;

type OutboxRow = { id:string; lead_id:string; mailbox_id:string; recipient:string; subject:string; body:string; attempts:number };
type Credential = { id:string; provider:"gmail"|"microsoft"|"smtp"; email:string; name?:string; accessToken?:string; smtpHost?:string; smtpPort?:number; smtpUser?:string; smtpPass?:string };

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (request.headers.get("authorization") || "") === `Bearer ${expected}`;
}

async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error:"Unauthorized" }, { status:401 });
  let credentials: Credential[] = [];
  try { credentials = JSON.parse(process.env.MAILBOX_CREDENTIALS_JSON || "[]") as Credential[]; }
  catch { return Response.json({ error:"MAILBOX_CREDENTIALS_JSON ist ungültig." }, { status:503 }); }
  const credMap = new Map(credentials.map((c) => [c.id,c]));
  const due = await query<OutboxRow>(
    `select o.id,o.lead_id,o.mailbox_id,o.recipient,o.subject,o.body,o.attempts
     from er_outbox o
     where o.status='queued' and o.scheduled_at<=now()
       and not exists(select 1 from er_suppressions s where s.workspace=o.workspace and lower(s.email)=lower(o.recipient))
       and not exists(select 1 from er_events e where e.workspace=o.workspace and e.lead_id=o.lead_id and e.type in ('reply','positive_reply','appointment'))
     order by o.scheduled_at asc limit 50`
  );
  let sent=0, failed=0, skipped=0;
  for (const row of due) {
    const credential = credMap.get(row.mailbox_id);
    if (!credential) { skipped++; continue; }
    try {
      await query("update er_outbox set status='sending',attempts=attempts+1 where id=$1", [row.id]);
      const result = await sendMail({ ...credential, to:row.recipient, subject:row.subject, text:row.body });
      await query("update er_outbox set status='sent',sent_at=now(),provider_message_id=$2,error=null where id=$1", [row.id,result.id]);
      await query("insert into er_events(workspace,lead_id,type,meta) values('default',$1,'email_sent',$2::jsonb)", [row.lead_id,JSON.stringify({ outboxId:row.id, mailboxId:row.mailbox_id })]);
      sent++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Versandfehler";
      const nextStatus = row.attempts >= 2 ? "failed" : "queued";
      await query("update er_outbox set status=$2,error=$3,scheduled_at=now()+interval '30 minutes' where id=$1", [row.id,nextStatus,message]);
      failed++;
    }
  }
  return Response.json({ ok:true, processed:due.length, sent, failed, skipped });
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
