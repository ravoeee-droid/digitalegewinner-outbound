import { z } from "zod";
import { loadMailboxCredentials } from "@/lib/mailbox-credentials";
import { listImapMessages, type ImapMailboxCredential } from "@/lib/imap-client";
import { sendMail } from "@/lib/mailer";

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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const mailboxId = String(url.searchParams.get("mailboxId") || "").trim();
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || 30)));
    const credentials = await loadMailboxCredentials();
    const compatible = credentials.filter((item) => item.provider === "smtp") as ImapMailboxCredential[];
    const selected = compatible.find((item) => item.id === mailboxId) || compatible[0];
    if (!selected) return Response.json({ error: "Noch kein Netcup-Postfach verbunden.", setupRequired: true }, { status: 404 });
    if (!selected.imapHost) return Response.json({ error: "Für dieses Postfach fehlen IMAP-Daten.", setupRequired: true }, { status: 400 });

    const messages = await listImapMessages(selected, limit);
    return Response.json({ mailbox: safeMailbox(selected), messages, count: messages.length });
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
    return Response.json({ ok: true, id: sent.id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "E-Mail konnte nicht versendet werden." }, { status: 400 });
  }
}
