alter table public.sales_leads add column if not exists trigger_score integer not null default 0;
alter table public.sales_leads add column if not exists last_signal_at timestamptz;

create table if not exists public.sales_monitors (
  id text primary key,
  workspace text not null,
  company_id text not null references public.sales_companies(id) on delete cascade,
  active boolean not null default true,
  interval_minutes integer not null default 720,
  next_check_at timestamptz not null default now(),
  last_checked_at timestamptz,
  last_hash text not null default '',
  check_count integer not null default 0,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sales_monitors_company_idx on public.sales_monitors(workspace, company_id);
create index if not exists sales_monitors_due_idx on public.sales_monitors(workspace, active, next_check_at);

create table if not exists public.sales_trigger_snapshots (
  id text primary key,
  workspace text not null,
  company_id text not null references public.sales_companies(id) on delete cascade,
  hash text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists sales_trigger_snapshots_company_idx on public.sales_trigger_snapshots(workspace, company_id, created_at desc);

create table if not exists public.sales_triggers (
  id text primary key,
  workspace text not null,
  company_id text not null references public.sales_companies(id) on delete cascade,
  lead_id text,
  kind text not null,
  weight integer not null default 0,
  title text not null,
  detail text not null,
  fingerprint text not null,
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  detected_at timestamptz not null default now()
);
create index if not exists sales_triggers_company_idx on public.sales_triggers(workspace, company_id, detected_at desc);
create unique index if not exists sales_triggers_fingerprint_idx on public.sales_triggers(workspace, company_id, fingerprint);

create table if not exists public.sales_signals (
  id text primary key,
  workspace text not null,
  lead_id text not null references public.sales_leads(id) on delete cascade,
  company_id text not null references public.sales_companies(id) on delete cascade,
  source_event_id bigint,
  type text not null,
  strength integer not null default 0,
  summary text not null default '',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists sales_signals_source_event_idx
  on public.sales_signals(workspace, source_event_id) where source_event_id is not null;
create index if not exists sales_signals_lead_idx
  on public.sales_signals(workspace, lead_id, created_at desc);

create table if not exists public.sales_next_actions (
  id text primary key,
  workspace text not null,
  lead_id text not null references public.sales_leads(id) on delete cascade,
  company_id text not null references public.sales_companies(id) on delete cascade,
  action_type text not null,
  priority integer not null default 0,
  reason text not null default '',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  due_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sales_next_actions_one_open_idx
  on public.sales_next_actions(workspace, lead_id) where status='open';
create index if not exists sales_next_actions_queue_idx
  on public.sales_next_actions(workspace, status, priority desc, due_at asc);

alter table public.sales_monitors enable row level security;
alter table public.sales_trigger_snapshots enable row level security;
alter table public.sales_triggers enable row level security;
alter table public.sales_signals enable row level security;
alter table public.sales_next_actions enable row level security;

revoke all on table public.sales_monitors from anon, authenticated;
revoke all on table public.sales_trigger_snapshots from anon, authenticated;
revoke all on table public.sales_triggers from anon, authenticated;
revoke all on table public.sales_signals from anon, authenticated;
revoke all on table public.sales_next_actions from anon, authenticated;

drop policy if exists sales_monitors_deny_client on public.sales_monitors;
create policy sales_monitors_deny_client on public.sales_monitors for all to anon, authenticated using (false) with check (false);
drop policy if exists sales_trigger_snapshots_deny_client on public.sales_trigger_snapshots;
create policy sales_trigger_snapshots_deny_client on public.sales_trigger_snapshots for all to anon, authenticated using (false) with check (false);
drop policy if exists sales_triggers_deny_client on public.sales_triggers;
create policy sales_triggers_deny_client on public.sales_triggers for all to anon, authenticated using (false) with check (false);
drop policy if exists sales_signals_deny_client on public.sales_signals;
create policy sales_signals_deny_client on public.sales_signals for all to anon, authenticated using (false) with check (false);
drop policy if exists sales_next_actions_deny_client on public.sales_next_actions;
create policy sales_next_actions_deny_client on public.sales_next_actions for all to anon, authenticated using (false) with check (false);

select cron.unschedule(jobid)
from cron.job
where jobname = 'dg-sales-triggers';

select cron.schedule(
  'dg-sales-triggers',
  '*/5 * * * *',
  $job$select dg_private.invoke_worker('/api/cron/triggers');$job$
);
