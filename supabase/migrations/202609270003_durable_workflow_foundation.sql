-- DG Outbound OS V3 — durable workflow foundation
-- Additive only. Legacy er_outbox remains canonical during shadow mode.

create table if not exists public.outbound_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  workflow_key text not null,
  workflow_version integer not null default 1 check (workflow_version > 0),
  kind text not null,
  status text not null default 'pending'
    check (status in ('pending','running','waiting','paused','completed','failed','cancelled')),
  subject_type text not null
    check (subject_type in ('company','contact','lead','campaign','system')),
  subject_id text not null,
  company_id text,
  contact_id text,
  lead_id text,
  campaign_version_id uuid references public.outbound_campaign_versions(id) on delete set null,
  legacy_campaign_id text,
  experiment_id uuid references public.outbound_experiments(id) on delete set null,
  experiment_arm_key text,
  idempotency_key text not null,
  input jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  terminal_reason text,
  next_wake_at timestamptz,
  attempt integer not null default 0 check (attempt >= 0),
  max_attempts integer not null default 10 check (max_attempts > 0),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace,idempotency_key)
);

create table if not exists public.outbound_workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  run_id uuid not null references public.outbound_workflow_runs(id) on delete cascade,
  step_key text not null,
  step_type text not null,
  sequence_index integer not null default 0 check (sequence_index >= 0),
  status text not null default 'pending'
    check (status in ('pending','waiting','ready','running','completed','failed','cancelled','blocked')),
  idempotency_key text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  wake_at timestamptz,
  attempt integer not null default 0 check (attempt >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  retry_backoff_seconds integer not null default 300 check (retry_backoff_seconds >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  legacy_outbox_id uuid,
  provider_message_id text,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id,step_key),
  unique (workspace,idempotency_key)
);

create table if not exists public.outbound_workflow_signals (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  run_id uuid references public.outbound_workflow_runs(id) on delete cascade,
  signal_type text not null
    check (signal_type in (
      'reply_received',
      'bounce',
      'unsubscribe',
      'meeting_booked',
      'approval_granted',
      'approval_rejected',
      'manual_pause',
      'manual_resume',
      'manual_cancel'
    )),
  subject_type text not null
    check (subject_type in ('company','contact','lead','campaign','workflow')),
  subject_id text not null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  attempt integer not null default 0 check (attempt >= 0),
  max_attempts integer not null default 10 check (max_attempts > 0),
  lease_owner text,
  lease_expires_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  unique (workspace,idempotency_key)
);

create index if not exists outbound_workflow_runs_due_idx
  on public.outbound_workflow_runs(workspace,status,next_wake_at)
  where status in ('pending','running','waiting');

create index if not exists outbound_workflow_runs_lead_idx
  on public.outbound_workflow_runs(workspace,lead_id,created_at desc);

create index if not exists outbound_workflow_runs_campaign_idx
  on public.outbound_workflow_runs(workspace,legacy_campaign_id,created_at desc);

create index if not exists outbound_workflow_runs_lease_idx
  on public.outbound_workflow_runs(lease_expires_at)
  where lease_expires_at is not null;

create index if not exists outbound_workflow_steps_due_idx
  on public.outbound_workflow_steps(workspace,status,wake_at,sequence_index)
  where status in ('pending','waiting','ready','running');

create index if not exists outbound_workflow_steps_run_idx
  on public.outbound_workflow_steps(run_id,sequence_index);

create index if not exists outbound_workflow_steps_legacy_outbox_idx
  on public.outbound_workflow_steps(legacy_outbox_id)
  where legacy_outbox_id is not null;

create index if not exists outbound_workflow_steps_lease_idx
  on public.outbound_workflow_steps(lease_expires_at)
  where lease_expires_at is not null;

create index if not exists outbound_workflow_signals_pending_idx
  on public.outbound_workflow_signals(workspace,processed_at,received_at)
  where processed_at is null;

create index if not exists outbound_workflow_signals_lease_idx
  on public.outbound_workflow_signals(lease_expires_at)
  where processed_at is null and lease_expires_at is not null;

drop trigger if exists outbound_workflow_runs_touch on public.outbound_workflow_runs;
create trigger outbound_workflow_runs_touch
before update on public.outbound_workflow_runs
for each row execute function public.outbound_touch_updated_at();

drop trigger if exists outbound_workflow_steps_touch on public.outbound_workflow_steps;
create trigger outbound_workflow_steps_touch
before update on public.outbound_workflow_steps
for each row execute function public.outbound_touch_updated_at();

alter table public.outbound_workflow_runs enable row level security;
alter table public.outbound_workflow_steps enable row level security;
alter table public.outbound_workflow_signals enable row level security;

revoke all on table public.outbound_workflow_runs from anon, authenticated;
revoke all on table public.outbound_workflow_steps from anon, authenticated;
revoke all on table public.outbound_workflow_signals from anon, authenticated;

drop policy if exists outbound_workflow_runs_deny_client on public.outbound_workflow_runs;
create policy outbound_workflow_runs_deny_client
  on public.outbound_workflow_runs for all to anon, authenticated
  using (false) with check (false);

drop policy if exists outbound_workflow_steps_deny_client on public.outbound_workflow_steps;
create policy outbound_workflow_steps_deny_client
  on public.outbound_workflow_steps for all to anon, authenticated
  using (false) with check (false);

drop policy if exists outbound_workflow_signals_deny_client on public.outbound_workflow_signals;
create policy outbound_workflow_signals_deny_client
  on public.outbound_workflow_signals for all to anon, authenticated
  using (false) with check (false);
