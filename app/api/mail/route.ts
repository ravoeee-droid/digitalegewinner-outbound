import { z } from "zod";
import { loadMailboxCredentials } from "@/lib/mailbox-credentials";
import { listImapMessages, type ImapMailboxCredential } from "@/lib/imap-client";
import { sendMail } from "@/lib/mailer";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const sendSchema = z.object({
  mailboxId: z.string().trim().min(1).max(100),
  to: z.string().trim().email().max(254),
  subject: z.string().trim().max(500).default(""),
  text: z.string().min(1).max(250_000),
});

function safeMailbox(item: ImapMailboxCredential) {
  return { id: item.id, email: item.email, name: item.name || "", provider: item.provider };
}

let sentSchemaReady = false;
async function ensureSentMailSchema() {
  if (sentSchemaReady) return;
  await query(`
    create table if not exists mail_sent (
      id bigserial primary key,
      workspace text not null default 'default',
      mailbox_id text not null,
      recipient text not null,
      subject text not null default '',
      body text not null default '',
      provider_message_id text not null default '',
      sent_at timestamptz not null default now()
    );
    create index if not exists mail_sent_mailbox_idx on mail_sent(workspace, mailbox_id, sent_at desc);
  `);
  sentSchemaReady = true;
}

async function loadSentMessages(mailboxId: string, limit: number) {
  await ensureSentMailSchema();
  const rows = await query<{ id: number; recipient: string; subject: string; body: string; sent_at: string }>(
    `select id, recipient, subject, body, sent_at from mail_sent
     where workspace='default' and mailbox_id=$1 order by sent_at desc limit $2`,
    [mailboxId, limit],
  );
  return rows.map((row) => ({
    uid: row.id,
    from: "",
    fromName: "",
    to: row.recipient,
    subject: row.subject || "(ohne Betreff)",
    date: new Date(row.sent_at).toISOString(),
    messageId: "",
    replyTo: "",
    unread: false,
    bodyText: row.body,
  }));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const mailboxId = String(url.searchParams.get("mailboxId") || "").trim();
    const folder = url.searchParams.get("folder") === "sent" ? "sent" : "inbox";
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || 30)));
    const credentials = await loadMailboxCredentials();
    const compatible = credentials.filter((item) => item.provider === "smtp") as ImapMailboxCredential[];
    const selected = compatible.find((item) => item.id === mailboxId) || compatible[0];
    if (!selected) return Response.json({ error: "Noch kein Netcup-Postfach verbunden.", setupRequired: true }, { status: 404 });

    if (folder === "sent") {
      const messages = await loadSentMessages(selected.id, limit);
      return Response.json({ mailbox: safeMailbox(selected), messages, count: messages.length, folder });
    }

    if (!selected.imapHost) return Response.json({ error: "Für dieses Postfach fehlen IMAP-Daten.", setupRequired: true }, { status: 400 });
    const messages = await listImapMessages(selected, limit);
    return Response.json({ mailbox: safeMailbox(selected), messages, count: messages.length, folder });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Postfach konnte nicht geladen werden." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const input = sendSchema.parse(await request.json());
    const credentials = await loadMailboxCredentials();
    const selected = credentials.find((item) => item.id === input.mailboxId);
    if (!selected) return Response.json({ error: "Absender-Postfach wurde nicht gefunden." }, { status: 404 });

    const sent = await sendMail({
      ...selected,
      to: input.to,
      subject: input.subject || "(ohne Betreff)",
      text: input.text,
    });

    await ensureSentMailSchema();
    await query(
      `insert into mail_sent(workspace, mailbox_id, recipient, subject, body, provider_message_id)
       values('default', $1, $2, $3, $4, $5)`,
      [input.mailboxId, input.to, input.subject || "", input.text, sent.id || ""],
    );

    return Response.json({ ok: true, id: sent.id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "E-Mail konnte nicht versendet werden." }, { status: 400 });
  }
}
