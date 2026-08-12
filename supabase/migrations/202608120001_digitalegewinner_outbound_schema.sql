create table if not exists public.er_state (
  workspace text primary key,
  payload jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.er_outbox (
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

alter table public.er_outbox add column if not exists variant text not null default 'A';
create index if not exists er_outbox_due_idx on public.er_outbox(status, scheduled_at);
create index if not exists er_outbox_campaign_idx on public.er_outbox(campaign_id, variant, status);

create table if not exists public.er_suppressions (
  workspace text not null,
  email text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  primary key(workspace,email)
);

create table if not exists public.er_events (
  id bigserial primary key,
  workspace text not null,
  lead_id text,
  type text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.er_secrets (
  workspace text not null,
  key text not null,
  encrypted_value text not null,
  updated_at timestamptz not null default now(),
  primary key(workspace,key)
);

alter table public.er_state enable row level security;
alter table public.er_outbox enable row level security;
alter table public.er_suppressions enable row level security;
alter table public.er_events enable row level security;
alter table public.er_secrets enable row level security;

revoke all on table public.er_state from anon, authenticated;
revoke all on table public.er_outbox from anon, authenticated;
revoke all on table public.er_suppressions from anon, authenticated;
revoke all on table public.er_events from anon, authenticated;
revoke all on table public.er_secrets from anon, authenticated;

revoke usage, select on sequence public.er_events_id_seq from anon, authenticated;

drop policy if exists er_state_deny_client on public.er_state;
create policy er_state_deny_client on public.er_state for all to anon, authenticated using (false) with check (false);

drop policy if exists er_outbox_deny_client on public.er_outbox;
create policy er_outbox_deny_client on public.er_outbox for all to anon, authenticated using (false) with check (false);

drop policy if exists er_suppressions_deny_client on public.er_suppressions;
create policy er_suppressions_deny_client on public.er_suppressions for all to anon, authenticated using (false) with check (false);

drop policy if exists er_events_deny_client on public.er_events;
create policy er_events_deny_client on public.er_events for all to anon, authenticated using (false) with check (false);

drop policy if exists er_secrets_deny_client on public.er_secrets;
create policy er_secrets_deny_client on public.er_secrets for all to anon, authenticated using (false) with check (false);
