import { Pool } from "pg";

let pool: Pool | null = null;
let initialized = false;

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL fehlt.");
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined, max: 5 });
  return pool;
}

export async function ensureSchema() {
  if (initialized) return;
  const db = getPool();
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
