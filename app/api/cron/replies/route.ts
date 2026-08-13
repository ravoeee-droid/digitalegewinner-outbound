import { query, readState, writeState } from "@/lib/db";
import { getMailboxAccessToken } from "@/lib/mailer";
import { loadMailboxCredentials, type StoredMailboxCredential } from "@/lib/mailbox-credentials";
import { processSalesEvent } from "@/lib/sales-trigger-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

type State = { leads?: Array<Record<string, unknown>> };
type Credential = StoredMailboxCredential;

function auth(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && (request.headers.get("authorization") || "") === `Bearer ${secret}`);
}

function fromHeader(value: string) {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] || value).trim().toLowerCase();
}

async function recordReply(messageId: string, from: string, subject: string, mailboxId: string) {
  const existing = await query<{ id: number }>(
    "select id from er_events where workspace='default' and type='reply' and meta->>'providerMessageId'=$1 limit 1",
    [messageId],
  );
  if (existing.length) return false;

  const row = await readState();
  const state = row?.payload as State | undefined;
  const lead = state?.leads?.find((item) => String(item.email || "").toLowerCase() === from);
  if (!lead) return false;
  const leadId = String(lead.id);
  const meta = { providerMessageId: messageId, from, subject, mailboxId };

  const [event] = await query<{ id: number }>(
    "insert into er_events(workspace,lead_id,type,meta) values('default',$1,'reply',$2::jsonb) returning id",
    [leadId, JSON.stringify(meta)],
  );
  await query("update er_outbox set status='stopped' where workspace='default' and lead_id=$1 and status='queued'", [leadId]);

  if (state?.leads) {
    const leads = state.leads.map((item) =>
      String(item.id) === leadId
        ? {
            ...item,
            intentScore: Math.min(100, Number(item.intentScore || 0) + 30),
            stage: String(item.stage) === "Neu" || String(item.stage) === "Kontaktiert" ? "Engaged" : item.stage,
          }
        : item,
    );
    await writeState({ ...state, leads });
  }

  await processSalesEvent({ eventId: event?.id, leadId, type: "reply", meta }, "default").catch(() => null);
  return true;
}

async function syncGmail(credential: Credential) {
  const token = await getMailboxAccessToken(credential);
  const list = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=in%3Ainbox%20newer_than%3A2d", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!list.ok) throw new Error(`Gmail Inbox Sync ${list.status}`);
  const data = await list.json() as { messages?: Array<{ id: string }> };
  let replies = 0;
  for (const message of data.messages || []) {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) continue;
    const msg = await response.json() as { id: string; payload?: { headers?: Array<{ name: string; value: string }> } };
    const headers = msg.payload?.headers || [];
    const from = fromHeader(headers.find((header) => header.name.toLowerCase() === "from")?.value || "");
    if (!from || from === credential.email.toLowerCase()) continue;
    const subject = headers.find((header) => header.name.toLowerCase() === "subject")?.value || "";
    if (await recordReply(msg.id, from, subject, credential.id)) replies++;
  }
  return replies;
}

async function syncMicrosoft(credential: Credential) {
  const token = await getMailboxAccessToken(credential);
  const since = new Date(Date.now() - 2 * 86400000).toISOString();
  const endpoint = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=50&$select=id,subject,from,receivedDateTime&$filter=receivedDateTime%20ge%20${encodeURIComponent(since)}`;
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Microsoft Inbox Sync ${response.status}`);
  const data = await response.json() as { value?: Array<{ id: string; subject?: string; from?: { emailAddress?: { address?: string } } }> };
  let replies = 0;
  for (const message of data.value || []) {
    const from = (message.from?.emailAddress?.address || "").toLowerCase();
    if (!from || from === credential.email.toLowerCase()) continue;
    if (await recordReply(message.id, from, message.subject || "", credential.id)) replies++;
  }
  return replies;
}

async function run(request: Request) {
  if (!auth(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let credentials: Credential[] = [];
  try {
    credentials = await loadMailboxCredentials();
  } catch {
    return Response.json({ error: "Mailbox Credentials JSON ungültig." }, { status: 503 });
  }
  let replies = 0;
  const errors: string[] = [];
  for (const credential of credentials) {
    try {
      if (credential.provider === "gmail") replies += await syncGmail(credential);
      else if (credential.provider === "microsoft") replies += await syncMicrosoft(credential);
    } catch (error) {
      errors.push(`${credential.id}: ${error instanceof Error ? error.message : "Sync Fehler"}`);
    }
  }
  return Response.json({ ok: true, mailboxes: credentials.length, newReplies: replies, errors });
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
