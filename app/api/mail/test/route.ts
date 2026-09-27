import { loadMailboxCredentials } from "@/lib/mailbox-credentials";
import { sendMail } from "@/lib/mailer";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const recipient = "digitalegewinner@gmail.com";
  const mailboxId = "mb-netcup-raphael";

  const existing = await query<{ id: string }>(
    "select id from er_events where workspace='default' and type='test_email' and meta->>'recipient'=$1 and meta->>'mailboxId'=$2 and created_at > now()-interval '1 day' limit 1",
    [recipient, mailboxId],
  );
  if (existing.length) return Response.json({ ok: true, alreadySent: true });

  const credentials = await loadMailboxCredentials();
  const mailbox = credentials.find((item) => item.id === mailboxId);
  if (!mailbox) return Response.json({ error: "Test-Mailbox nicht gefunden." }, { status: 404 });

  const subject = "Digitale Gewinner Outbound – Testmail";
  const text = `Hi Raphael,

das ist die Testmail aus dem Digitale-Gewinner-Outbound-System.

Absender: ${mailbox.email}
SMTP-Versand: erfolgreich
Mailbox-Rotation: bereit

Wenn diese Mail sauber ankommt, ist der Versandweg für dieses Postfach aktiv.

Viele Grüße
Digitale Gewinner`;

  const sent = await sendMail({ ...mailbox, to: recipient, subject, text });
  await query(
    "insert into er_events(workspace,lead_id,type,meta) values('default',null,'test_email',$1::jsonb)",
    [JSON.stringify({ recipient, mailboxId, sender: mailbox.email, providerMessageId: sent.id })],
  );

  return Response.json({ ok: true, sent: true, from: mailbox.email, to: recipient, id: sent.id });
}
