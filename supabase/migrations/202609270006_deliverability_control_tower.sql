-- DG Outbound OS V3 — Deliverability Control Tower
-- Additive only. Enforcement is gated by outbound_runtime_settings.deliverability_mode.

alter table public.outbound_runtime_settings
  add column if not exists deliverability_mode text not null default 'shadow'
    check (deliverability_mode in ('off','shadow','enforce'));

create table if not exists public.outbound_sender_health_state (
  workspace text not null default 'default',
  target_type text not null check (target_type in ('mailbox','domain')),
  target_id text not null,
  domain text,
  health_status text not null default 'healthy'
    check (health_status in ('healthy','watch','degraded','paused')),
  health_score integer not null default 100 check (health_score between 0 and 100),
  base_daily_limit integer,
  recommended_daily_limit integer,
  enforced_daily_limit integer,
  paused_until timestamptz,
  consecutive_healthy integer not null default 0 check (consecutive_healthy >= 0),
  consecutive_degraded integer not null default 0 check (consecutive_degraded >= 0),
  last_action text,
  last_reason text,
  policy_version text not null,
  metrics jsonb not null default '{}'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  observed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace,target_type,target_id)
);

create index if not exists outbound_sender_health_state_status_idx
  on public.outbound_sender_health_state(workspace,target_type,health_status,updated_at desc);

create index if not exists outbound_sender_health_state_domain_idx
  on public.outbound_sender_health_state(workspace,domain,updated_at desc)
  where domain is not null;

drop trigger if exists outbound_sender_health_state_touch on public.outbound_sender_health_state;
create trigger outbound_sender_health_state_touch
before update on public.outbound_sender_health_state
for each row execute function public.outbound_touch_updated_at();

alter table public.outbound_sender_health_state enable row level security;
revoke all on table public.outbound_sender_health_state from anon, authenticated;

drop policy if exists outbound_sender_health_state_deny_client on public.outbound_sender_health_state;
create policy outbound_sender_health_state_deny_client
  on public.outbound_sender_health_state for all to anon, authenticated
  using (false) with check (false);

create index if not exists outbound_sender_health_snapshots_target_idx
  on public.outbound_sender_health_snapshots(workspace,target_type,target_id,observed_at desc);
