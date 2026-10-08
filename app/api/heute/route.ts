import { z } from "zod";
import { cookies } from "next/headers";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import { query, readState, writeState } from "@/lib/db";
import { loadMailboxCredentials } from "@/lib/mailbox-credentials";
import { getMailboxHealthMap } from "@/lib/outbound-deliverability";
import { MAILBOX_DAILY_TARGET, OUTBOUND_TARGETS } from "@/lib/outbound-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoredMailbox = { id?: string; email?: string; enabled?: boolean; dailyLimit?: number };
type State = { mailboxes?: StoredMailbox[] } & Record<string, unknown>;

const BERLIN_TODAY = "(now() at time zone 'Europe/Berlin')::date";

async function currentRole() {
  const store = await cookies();
  return sessionRole(store.get(adminCookieName())?.value);
}

async function callProgress(owner: string) {
  const rows = await query<{ status: string; n: string }>(
    `select status, count(*)::text n
       from sales_outbound_tasks
      where workspace='default' and task_date=${BERLIN_TODAY} and channel='call'
        and coalesce(payload->>'owner','')=$1
      group by status`,
    [owner],
  ).catch(() => []);
  const done = rows.filter((r) => ["done", "sent", "completed"].includes(r.status)).reduce((a, r) => a + Number(r.n), 0);
  const total = rows.reduce((a, r) => a + Number(r.n), 0);
  return { target: OUTBOUND_TARGETS.call, done, open: Math.max(0, total - done), total };
}

async function appointmentsToday() {
  const rows = await query<{ n: string }>(
    `select count(*)::text n from er_events
      where workspace='default' and type='appointment'
        and (created_at at time zone 'Europe/Berlin')::date=${BERLIN_TODAY}`,
  ).catch(() => [{ n: "0" }]);
  return Number(rows[0]?.n || 0);
}

async function emailProgress() {
  const credentials = await loadMailboxCredentials().catch(() => []);
  const state = ((await readState().catch(() => null))?.payload || {}) as State;
  const settings = new Map((state.mailboxes || []).map((m) => [String(m.email || "").toLowerCase(), m]));
  const health = await getMailboxHealthMap("default").catch(() => new Map());
  const sentRows = await query<{ mailbox_id: string; n: string }>(
    `select mailbox_id, count(*)::text n from er_outbox
      where workspace='default' and status='sent' and (sent_at at time zone 'Europe/Berlin')::date=${BERLIN_TODAY}
      group by mailbox_id`,
  ).catch(() => []);
  const sentBy = new Map(sentRows.map((r) => [r.mailbox_id, Number(r.n)]));
  const queuedRows = await query<{ n: string }>(
    "select count(*)::text n from er_outbox where workspace='default' and status='queued'",
  ).catch(() => [{ n: "0" }]);

  // "Domains & Mail" speichert nur Name und Limit (nicht versandfähig). Versandfähig sind nur Postfächer mit
  // Zugangsdaten (Menü "Mail"). Beide Listen werden hier zusammengeführt, damit sichtbar ist, was fehlt.
  const credEmails = new Set(credentials.map((c) => String(c.email || "").toLowerCase()));
  const connected = credentials.map((c) => {
    const known = settings.get(String(c.email || "").toLowerCase());
    const h = health.get(c.id);
    const imap = c as unknown as { imapHost?: string; imapUser?: string; imapPass?: string; smtpHost?: string; smtpPass?: string };
    return {
      id: c.id,
      email: String(c.email || c.id),
      connected: true,
      warmupReady: c.provider === "smtp" && Boolean(imap.imapHost && imap.imapUser && imap.imapPass && imap.smtpHost && imap.smtpPass),
      enabled: known?.enabled ?? true,
      limit: Number(known?.dailyLimit || 0),
      enforced: h?.enforced_daily_limit ?? null,
      status: h?.health_status ?? null,
      sent: sentBy.get(c.id) || 0,
    };
  });
  const listedOnly = (state.mailboxes || [])
    .filter((m) => m.email && !credEmails.has(String(m.email).toLowerCase()))
    .map((m) => ({
      id: String(m.id || m.email),
      email: String(m.email),
      connected: false,
      warmupReady: false,
      enabled: m.enabled ?? true,
      limit: Number(m.dailyLimit || 0),
      enforced: null,
      status: null,
      sent: 0,
    }));
  const mailboxes = [...connected, ...listedOnly];
  const active = connected.filter((m) => m.enabled);
  const sent = mailboxes.reduce((a, m) => a + m.sent, 0);
  // Heutiges Kontingent: je Postfach das kleinste von Limit und (falls vorhanden) erzwungenem Limit.
  const capacity = active.reduce((a, m) => a + Math.min(m.limit || 0, m.enforced ?? Number.POSITIVE_INFINITY), 0);
  return {
    target: OUTBOUND_TARGETS.email,
    perMailboxTarget: MAILBOX_DAILY_TARGET,
    sent,
    queued: Number(queuedRows[0]?.n || 0),
    capacity,
    connectedCount: connected.length,
    listedCount: mailboxes.length,
    mailboxes,
  };
}

export async function GET() {
  try {
    const role = await currentRole();
    if (!role) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const owner = role === "sales" ? "Mattias" : "Raphael";
    if (role === "sales") {
      return Response.json({ role, calls: await callProgress(owner), appointments: await appointmentsToday() });
    }
    const [calls, emails, appointments] = await Promise.all([callProgress(owner), emailProgress(), appointmentsToday()]);
    return Response.json({ role, calls, emails, appointments });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Heute-Ansicht konnte nicht geladen werden." }, { status: 500 });
  }
}

const postSchema = z.object({ action: z.literal("set-mailbox-limits"), limit: z.number().int().min(1).max(100).default(MAILBOX_DAILY_TARGET) });

// Setzt das Tageslimit aller aktiven Postfächer (nur Admin). Zustellbarkeitsregeln können es weiter senken.
export async function POST(request: Request) {
  try {
    const role = await currentRole();
    if (role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
    const { limit } = postSchema.parse(await request.json());
    const credentials = await loadMailboxCredentials().catch(() => []);
    const row = await readState();
    const state = (row?.payload || {}) as State;
    const byEmail = new Map((state.mailboxes || []).map((m) => [String(m.email || "").toLowerCase(), m]));
    const mailboxes: StoredMailbox[] = credentials.map((c) => {
      const known = byEmail.get(String(c.email || "").toLowerCase());
      return { ...(known || {}), id: known?.id || c.id, email: c.email, enabled: known?.enabled ?? true, dailyLimit: known?.enabled === false ? Number(known?.dailyLimit || limit) : limit };
    });
    // Postfächer, die nur im State stehen (ohne Credential), bleiben unverändert erhalten.
    const credEmails = new Set(credentials.map((c) => String(c.email || "").toLowerCase()));
    const untouched = (state.mailboxes || []).filter((m) => !credEmails.has(String(m.email || "").toLowerCase()));
    await writeState({ ...state, mailboxes: [...mailboxes, ...untouched] });
    return Response.json({ ok: true, limit, updated: mailboxes.filter((m) => m.enabled !== false).length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Limits konnten nicht gesetzt werden." }, { status: 400 });
  }
}
