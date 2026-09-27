import { loadMailboxCredentials } from "@/lib/mailbox-credentials";
import { listImapMessages, type ImapMailboxCredential } from "@/lib/imap-client";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const mailboxId = "mb-netcup-raphael";
  const credentials = await loadMailboxCredentials();
  const mailbox = credentials.find((item) => item.id === mailboxId) as ImapMailboxCredential | undefined;
  if (!mailbox) return Response.json({ error: "Mailbox nicht gefunden" }, { status: 404 });
  const messages = await listImapMessages(mailbox, 30);
  const suspect = messages
    .filter((m) => /mailer-daemon|postmaster/i.test(m.from) || /(delivery|undeliver|returned|nicht zustellbar|unzustellbar|mail system|failure)/i.test(m.subject))
    .slice(0, 10)
    .map((m) => ({ from: m.from, subject: m.subject, date: m.date, body: m.bodyText.slice(0, 1200) }));
  return Response.json({ ok: true, mailbox: mailbox.email, suspect });
}
