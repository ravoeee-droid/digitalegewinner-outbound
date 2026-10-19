import { query } from "./db";
import { d1Enabled, d1Batch, d1Query, type D1Value } from "./cloudflare-d1";
import { loadMailboxCredentials, type StoredMailboxCredential } from "./mailbox-credentials";
import { sendMail } from "./mailer";
import { markSeenBySubjectToken, type ImapMailboxCredential } from "./imap-client";

let schemaReady = false;
async function warmupQuery<T = Record<string, unknown>>(postgresSql: string, sqliteSql: string, values: D1Value[] = []) {
  return d1Enabled() ? d1Query<T>(sqliteSql, values) : query<T>(postgresSql, values);
}

export async function ensureWarmupSchema() {
  if (schemaReady) return;
  if(d1Enabled()) {
    await d1Batch([
      {sql:"CREATE TABLE IF NOT EXISTS mail_warmup_events (id INTEGER PRIMARY KEY AUTOINCREMENT,workspace TEXT NOT NULL DEFAULT 'default',sender_mailbox_id TEXT NOT NULL,recipient_mailbox_id TEXT NOT NULL,token TEXT NOT NULL,sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),seen_at TEXT,error TEXT NOT NULL DEFAULT '')"},
      {sql:"CREATE INDEX IF NOT EXISTS mail_warmup_sender_idx ON mail_warmup_events(workspace,sender_mailbox_id,sent_at DESC)"},
    ]);
    schemaReady=true;
    return;
  }
  await query(`
    create table if not exists mail_warmup_events (
      id bigserial primary key,
      workspace text not null default 'default',
      sender_mailbox_id text not null,
      recipient_mailbox_id text not null,
      token text not null,
      sent_at timestamptz not null default now(),
      seen_at timestamptz,
      error text not null default ''
    );
    create index if not exists mail_warmup_sender_idx on mail_warmup_events(workspace, sender_mailbox_id, sent_at desc);
  `);
  schemaReady = true;
}

// Daily send target grows the longer a mailbox has been warming up, then caps.
// New mailboxes send very little at first — that's the whole point of warmup.
const RAMP: Array<{ afterDays: number; perDay: number }> = [
  { afterDays: 0, perDay: 2 },
  { afterDays: 7, perDay: 4 },
  { afterDays: 14, perDay: 6 },
  { afterDays: 21, perDay: 8 },
  { afterDays: 28, perDay: 10 },
];

const SUBJECTS = [
  "Kurze Frage",
  "Kannst du kurz draufschauen",
  "Noch ein Gedanke dazu",
  "Update von eben",
  "Kurzer Check-in",
  "Eine Sache noch",
];

const BODIES = [
  "Hey, kurze Rückfrage zu gestern — hast du das schon gesehen?\n\nMeld dich, wenn du kurz Zeit hast.",
  "Wollte nur kurz nachhaken, ob das bei dir angekommen ist.\n\nDanke dir!",
  "Kurzes Update: läuft soweit, melde mich wenn's was Neues gibt.\n\nBis dann.",
  "Hab gerade nochmal draufgeschaut — passt so für dich?\n\nGrüße",
];

function pick<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomToken() {
  return Math.random().toString(36).slice(2, 8);
}

function isWarmupCapable(item: StoredMailboxCredential) {
  const cred = item as ImapMailboxCredential;
  return item.provider === "smtp" && Boolean(cred.imapHost && cred.imapUser && cred.imapPass && cred.smtpHost && cred.smtpPass);
}

async function dailyTargetFor(workspace: string, mailboxId: string) {
  const [row] = await warmupQuery<{ first_sent: string | null }>(
    `select min(sent_at) as first_sent from mail_warmup_events where workspace=$1 and sender_mailbox_id=$2`,
    "SELECT min(sent_at) AS first_sent FROM mail_warmup_events WHERE workspace=? AND sender_mailbox_id=?",
    [workspace, mailboxId],
  );
  if (!row?.first_sent) return RAMP[0].perDay;
  const days = Math.floor((Date.now() - new Date(row.first_sent).getTime()) / 86_400_000);
  let target = RAMP[0].perDay;
  for (const step of RAMP) if (days >= step.afterDays) target = step.perDay;
  return target;
}

async function sentTodayCount(workspace: string, mailboxId: string) {
  const [row] = await warmupQuery<{ count: string | number }>(
    `select count(*)::text as count from mail_warmup_events
     where workspace=$1 and sender_mailbox_id=$2 and sent_at >= date_trunc('day', now())`,
    "SELECT count(*) AS count FROM mail_warmup_events WHERE workspace=? AND sender_mailbox_id=? AND sent_at >= strftime('%Y-%m-%dT00:00:00.000Z','now')",
    [workspace, mailboxId],
  );
  return Number(row?.count || 0);
}

export async function runWarmupCycle(workspace = "default") {
  await ensureWarmupSchema();
  const credentials = await loadMailboxCredentials();
  const pool = credentials.filter(isWarmupCapable) as (StoredMailboxCredential & ImapMailboxCredential)[];

  if (pool.length < 2) {
    return { ok: true, eligibleMailboxes: pool.length, sent: 0, message: "Mindestens 2 vollständig verbundene Postfächer nötig, um sich gegenseitig warmzulaufen." };
  }

  let sent = 0;
  const results: Array<{ from: string; to: string; ok: boolean; error?: string }> = [];

  for (const sender of pool) {
    const target = await dailyTargetFor(workspace, sender.id);
    const already = await sentTodayCount(workspace, sender.id);
    const remaining = Math.max(0, target - already);
    if (!remaining) continue;

    const partners = pool.filter((item) => item.id !== sender.id);
    for (let index = 0; index < remaining; index += 1) {
      const recipient = partners[(already + index) % partners.length];
      const token = randomToken();
      const subject = `${pick(SUBJECTS)} [wu-${token}]`;
      const body = pick(BODIES);
      try {
        const result = await sendMail({ ...sender, to: recipient.email, subject, text: body });
        await warmupQuery(
          `insert into mail_warmup_events(workspace, sender_mailbox_id, recipient_mailbox_id, token, error)
           values($1,$2,$3,$4,'')`,
          "INSERT INTO mail_warmup_events(workspace,sender_mailbox_id,recipient_mailbox_id,token,error) VALUES(?,?,?,?,'')",
          [workspace, sender.id, recipient.id, token],
        );
        sent += 1;
        results.push({ from: sender.email, to: recipient.email, ok: true });

        // Simulate a human opening it — mark seen on the recipient side shortly after.
        try {
          const seen = await markSeenBySubjectToken(recipient, `[wu-${token}]`);
          if (seen) {
            await warmupQuery(
              `update mail_warmup_events set seen_at=now() where workspace=$1 and token=$2`,
              "UPDATE mail_warmup_events SET seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE workspace=? AND token=?",
              [workspace, token],
            );
          }
        } catch {
          // Marking as read is best-effort; the send itself already counts as warmup traffic.
        }
        void result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Warmup-Versand fehlgeschlagen.";
        await warmupQuery(
          `insert into mail_warmup_events(workspace, sender_mailbox_id, recipient_mailbox_id, token, error)
           values($1,$2,$3,$4,$5)`,
          "INSERT INTO mail_warmup_events(workspace,sender_mailbox_id,recipient_mailbox_id,token,error) VALUES(?,?,?,?,?)",
          [workspace, sender.id, recipient.id, token, message],
        );
        results.push({ from: sender.email, to: recipient.email, ok: false, error: message });
      }
    }
  }

  return { ok: true, eligibleMailboxes: pool.length, sent, results };
}

export async function getWarmupStatus(workspace = "default") {
  await ensureWarmupSchema();
  const credentials = await loadMailboxCredentials();
  const pool = credentials.filter(isWarmupCapable) as (StoredMailboxCredential & ImapMailboxCredential)[];

  const stats = await Promise.all(pool.map(async (mailbox) => {
    const target = await dailyTargetFor(workspace, mailbox.id);
    const today = await sentTodayCount(workspace, mailbox.id);
    const [totals] = await warmupQuery<{ total: string | number; seen: string | number; first_sent: string | null }>(
      `select count(*)::text as total, count(*) filter(where seen_at is not null)::text as seen, min(sent_at) as first_sent
       from mail_warmup_events where workspace=$1 and sender_mailbox_id=$2`,
      "SELECT count(*) AS total,count(*) FILTER(WHERE seen_at IS NOT NULL) AS seen,min(sent_at) AS first_sent FROM mail_warmup_events WHERE workspace=? AND sender_mailbox_id=?",
      [workspace, mailbox.id],
    );
    const days = totals?.first_sent ? Math.floor((Date.now() - new Date(totals.first_sent).getTime()) / 86_400_000) : 0;
    return {
      id: mailbox.id,
      email: mailbox.email,
      warmupDay: days,
      dailyTarget: target,
      sentToday: today,
      totalSent: Number(totals?.total || 0),
      totalSeen: Number(totals?.seen || 0),
    };
  }));

  return { active: pool.length >= 2, eligibleMailboxes: pool.length, mailboxes: stats };
}
