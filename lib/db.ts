import { Pool } from "pg";
import { d1Enabled } from "./cloudflare-d1";
import { readD1State, writeD1State } from "./cloudflare-store";

let pool: Pool | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;

function productionConnectionString(raw: string) {
  if (process.env.NODE_ENV !== "production") return raw;
  try {
    const url = new URL(raw);
    const match = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (!match) return raw;
    const projectRef = match[1];
    // Vercel is IPv4-only for this database path, so production must use
    // Supavisor shared pooler. Transaction mode is currently returning EAUTHQUERY\n    // backend-unavailable errors for this project, so use IPv4 session mode by\n    // default; an explicit env override can switch the port later.\n    // This project's Frankfurt pooler is on the
    // aws-0 cluster; an explicit env override still takes precedence.
    url.hostname = process.env.SUPABASE_POOLER_HOST || "aws-0-eu-central-1.pooler.supabase.com";
    url.port = process.env.SUPABASE_POOLER_PORT || "5432";
    url.username = `postgres.${projectRef}`;
    return url.toString();
  } catch {
    return raw;
  }
}

// Zwei Verbindungen möglich: bei Kontingent-/Verbindungsfehlern der ersten wird automatisch auf die zweite gewechselt.
let activeIndex = 0;
function connectionStrings() {
  return [...new Set([process.env.POSTGRES_URL, process.env.DATABASE_URL].filter((value): value is string => Boolean(value)))];
}

function isFailoverError(error: unknown) {
  const err = error as { code?: string; message?: string } | null;
  return err?.code === "53000" || /exceeded the .*quota|compute time quota|data transfer quota|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|Connection terminated|timeout expired/i.test(String(err?.message || ""));
}

async function failover(error: unknown) {
  const all = connectionStrings();
  if (!isFailoverError(error) || activeIndex >= all.length - 1) return false;
  activeIndex += 1;
  const old = pool;
  pool = null;
  initialized = false;
  initPromise = null;
  try { await old?.end(); } catch {}
  console.error(`[db] Wechsel auf Ausweich-Datenbank (${activeIndex + 1}/${all.length}) wegen: ${(error as Error)?.message}`);
  return true;
}

function getPool() {
  const raw = connectionStrings()[activeIndex];
  if (!raw) throw new Error("Keine Postgres-Verbindung konfiguriert.");
  if (!pool) pool = new Pool({
    // Vercel Postgres/Neon is the operational fallback while the Supabase
    // project's own Postgres and Supavisor endpoints are timing out.
    connectionString: productionConnectionString(raw),
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  });
  return pool;
}

export async function ensureSchema() {
  if (initialized) return;
  if (initPromise) return initPromise;
  const db = getPool();
  initPromise = (async () => {
    await db.query(`
    create table if not exists er_state (
      workspace text primary key,
      payload jsonb not null default '{}'::jsonb,
      version integer not null default 1,
      updated_at timestamptz not null default now()
    );
    create table if not exists er_outbox (
      id uuid primary key,
      workspace text not null,
      campaign_id text,
      lead_id text,
      mailbox_id text,
      recipient text not null,
      subject text not null,
      body text not null,
      variant text not null default 'A',
      status text not null default 'queued',
      attempts integer not null default 0,
      scheduled_at timestamptz not null default now(),
      sent_at timestamptz,
      provider_message_id text,
      error text,
      created_at timestamptz not null default now()
    );
    alter table er_outbox add column if not exists variant text not null default 'A';
    alter table er_outbox add column if not exists campaign_version_id uuid;
    alter table er_outbox add column if not exists experiment_id uuid;
    alter table er_outbox add column if not exists experiment_arm_key text;
    create index if not exists er_outbox_due_idx on er_outbox(status, scheduled_at);
    create index if not exists er_outbox_campaign_idx on er_outbox(campaign_id, variant, status);
    create table if not exists er_suppressions (
      workspace text not null,
      email text not null,
      reason text not null,
      created_at timestamptz not null default now(),
      primary key(workspace,email)
    );
    create table if not exists er_events (
      id bigserial primary key,
      workspace text not null,
      lead_id text,
      type text not null,
      meta jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create table if not exists er_secrets (
      workspace text not null,
      key text not null,
      encrypted_value text not null,
      updated_at timestamptz not null default now(),
      primary key(workspace,key)
    );
    `);
    initialized = true;
  })().finally(() => {
    if (!initialized) initPromise = null;
  });
  return initPromise;
}

// Only return requested settings fields, not the full potentially large state JSON.
// Never use partial state in a writeState operation.
export async function readStateFields(fields: Array<"mailboxes" | "campaigns">, workspace = "default") {
  if (d1Enabled()) {
    const row = await readD1State(workspace);
    const payload: Record<string, unknown> = {};
    for (const field of new Set(fields)) {
      if ((field === "mailboxes" || field === "campaigns") && row && Object.hasOwn(row.payload, field)) payload[field] = row.payload[field];
    }
    return { payload };
  }
  await ensureSchema();
  const allowed = [...new Set(fields)].filter(field => ["mailboxes", "campaigns"].includes(field));
  if (!allowed.length) return { payload: {} as Record<string, unknown> };
  const { rows } = await getPool().query<{ payload: Record<string, unknown> }>(
    "select jsonb_object_agg(k, payload -> k) as payload from er_state, unnest($2::text[]) k where workspace=$1 and payload ? k",
    [workspace, allowed],
  );
  return { payload: rows[0]?.payload ?? {} };
}

export async function readState(workspace = "default") {
  if (d1Enabled()) return readD1State(workspace);
  await ensureSchema();
  const { rows } = await getPool().query("select payload, version, updated_at from er_state where workspace=$1", [workspace]);
  return rows[0] ?? null;
}

export async function writeState(payload: unknown, workspace = "default") {
  if (d1Enabled()) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Ungültiger Workspace-Status.");
    return writeD1State(payload as Record<string, unknown>, workspace);
  }
  await ensureSchema();
  const { rows } = await getPool().query(
    `insert into er_state(workspace,payload) values($1,$2::jsonb)
     on conflict(workspace) do update set payload=excluded.payload, version=er_state.version+1, updated_at=now()
     returning payload,version,updated_at`,
    [workspace, JSON.stringify(payload)],
  );
  return rows[0];
}

// Frische Datenbank: fehlende Tabellen werden beim ersten Zugriff aus den Schema-Funktionen der Module angelegt.
let healing: Promise<void> | null = null;
async function healMissingTables() {
  lastHealAt = Date.now();
  if (!healing) {
    healing = (async () => {
      const steps: Array<() => Promise<unknown>> = [
        async () => (await import("./sales-os")).ensureSalesOsSchema(),
        async () => (await import("./outbound-engine")).ensureOutboundEngineSchema(),
        async () => (await import("./revenue-opportunities")).ensureRevenueOpportunitySchema(),
        async () => (await import("./mail-warmup")).ensureWarmupSchema(),
        async () => (await import("./telephony")).ensureTelephonySchema(),
        async () => (await import("./website-projects")).ensureWebsiteProjectsSchema(),
        async () => (await import("./dg-agent-store")).ensureDgAgentSchema(),
        async () => (await import("./v3-apply")).applyV3Schema(),
      ];
      for (const step of steps) {
        try { await step(); } catch (error) { console.error("[db] Schema anlegen fehlgeschlagen:", (error as Error)?.message); }
      }
    })().finally(() => { healing = null; });
  }
  return healing;
}
let insideHeal = false;
let lastHealAt = 0;

// Verständliche deutsche Meldung statt technischem Englisch. Code und Originalfehler bleiben erhalten.
function friendlyDbError(error: unknown) {
  const err = error as { code?: string; message?: string } | null;
  const text = String(err?.message || "");
  let message = "";
  if (err?.code === "53000" || /exceeded the .*quota/i.test(text)) message = "Die Datenbank hat ihr Kontingent erreicht. Bitte Datenbank-Zugang in Vercel prüfen.";
  else if (err?.code === "42P01" || /relation .* does not exist/i.test(text)) message = "Die Datenbank wird gerade eingerichtet. Bitte in einer Minute neu laden.";
  else if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Connection terminated|timeout expired/i.test(text)) message = "Die Datenbank antwortet nicht. Bitte gleich noch einmal versuchen.";
  if (!message) return error;
  return Object.assign(new Error(message), { code: err?.code, cause: error });
}

export async function query<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  return runQuery<T>(text, values, false);
}

async function runQuery<T>(text: string, values: unknown[], healed: boolean): Promise<T[]> {
  try {
    await ensureSchema();
    const result = values.length ? await getPool().query(text, values) : await getPool().query(text);
    if (Array.isArray(result)) return ((result.at(-1)?.rows ?? []) as T[]);
    return result.rows as T[];
  } catch (error) {
    if (await failover(error)) return runQuery<T>(text, values, healed);
    if ((error as { code?: string })?.code === "42P01" && !healed && !insideHeal && Date.now() - lastHealAt > 600_000) {
      insideHeal = true;
      try { await healMissingTables(); } finally { insideHeal = false; }
      return runQuery<T>(text, values, true);
    }
    throw friendlyDbError(error);
  }
}

// Für Altlasten-Tabellen, die auf einer frischen Datenbank bewusst fehlen (z. B. pflege_email_outreach): fehlt die Tabelle, passiert nichts.
export async function queryIfTable<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  try {
    return await query<T>(text, values);
  } catch (error) {
    if ((error as { code?: string })?.code === "42P01") return [];
    throw error;
  }
}
