import { Pool } from "pg";

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

function getPool() {
  const raw = process.env.POSTGRES_URL || process.env.DATABASE_URL;
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

export async function readState(workspace = "default") {
  await ensureSchema();
  const { rows } = await getPool().query("select payload, version, updated_at from er_state where workspace=$1", [workspace]);
  return rows[0] ?? null;
}

export async function writeState(payload: unknown, workspace = "default") {
  await ensureSchema();
  const { rows } = await getPool().query(
    `insert into er_state(workspace,payload) values($1,$2::jsonb)
     on conflict(workspace) do update set payload=excluded.payload, version=er_state.version+1, updated_at=now()
     returning payload,version,updated_at`,
    [workspace, JSON.stringify(payload)],
  );
  return rows[0];
}

export async function query<T = Record<string, unknown>>(text: string, values: unknown[] = []) {
  await ensureSchema();
  const result = values.length ? await getPool().query(text, values) : await getPool().query(text);
  if (Array.isArray(result)) return ((result.at(-1)?.rows ?? []) as T[]);
  return result.rows as T[];
}
