-- DG Outbound OS V3 foundation
-- Additive only: no legacy table is renamed, dropped or rewritten.
-- This migration is intentionally safe to stage before cutover from er_*.

create table if not exists public.outbound_campaign_versions (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  campaign_key text not null,
  version integer not null check (version > 0),
  status text not null default 'draft'
    check (status in ('draft','review','approved','running','paused','completed','archived')),
  name text not null,
  audience_definition jsonb not null default '{}'::jsonb,
  offer_definition jsonb not null default '{}'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  content_hash text,
  created_by text not null,
  approved_by text,
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace, campaign_key, version)
);

create table if not exists public.outbound_experiments (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  campaign_version_id uuid not null references public.outbound_campaign_versions(id) on delete restrict,
  experiment_key text not null,
  version integer not null check (version > 0),
  status text not null default 'draft'
    check (status in ('draft','review','running','paused','completed','archived')),
  hypothesis text not null,
  primary_metric text not null
    check (primary_metric in (
      'reply_rate',
      'positive_reply_rate',
      'qualified_meeting_rate',
      'meeting_held_rate',
      'opportunity_rate',
      'won_rate',
      'revenue_per_100_companies',
      'bounce_rate',
      'complaint_rate',
      'unsubscribe_rate'
    )),
  guardrail_metrics text[] not null default array['bounce_rate','complaint_rate','unsubscribe_rate']::text[],
  randomization_unit text not null default 'company'
    check (randomization_unit in ('company','contact','lead')),
  target_population jsonb not null default '{}'::jsonb,
  minimum_sample_per_arm integer not null default 50 check (minimum_sample_per_arm >= 10),
  practical_effect_threshold numeric(8,6) not null default 0.01
    check (practical_effect_threshold >= 0 and practical_effect_threshold <= 1),
  stop_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace, experiment_key, version)
);

create table if not exists public.outbound_experiment_arms (
  experiment_id uuid not null references public.outbound_experiments(id) on delete cascade,
  arm_key text not null,
  label text not null,
  weight numeric(8,6) not null check (weight > 0 and weight <= 1),
  strategy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (experiment_id, arm_key)
);

create table if not exists public.outbound_experiment_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  experiment_id uuid not null references public.outbound_experiments(id) on delete restrict,
  subject_type text not null check (subject_type in ('company','contact','lead')),
  subject_id text not null,
  arm_key text not null,
  assignment_hash text,
  assigned_at timestamptz not null default now(),
  unique (experiment_id, subject_type, subject_id),
  foreign key (experiment_id, arm_key)
    references public.outbound_experiment_arms(experiment_id, arm_key)
    on delete restrict
);

create table if not exists public.outbound_contact_permissions (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  company_id text,
  contact_id text,
  channel text not null
    check (channel in ('email','phone','whatsapp','linkedin','sms','other')),
  jurisdiction text not null,
  basis text not null
    check (basis in (
      'explicit_consent',
      'existing_customer_exception',
      'human_verified_business_expectation',
      'inbound_request',
      'contractual_necessity',
      'unknown',
      'denied'
    )),
  status text not null
    check (status in ('verified','unverified','denied','revoked','expired')),
  policy_version text not null,
  source text,
  evidence jsonb not null default '{}'::jsonb,
  verified_by text,
  verified_at timestamptz,
  valid_from timestamptz,
  valid_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (company_id is not null or contact_id is not null)
);

create table if not exists public.outbound_events (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  event_type text not null,
  actor_type text not null
    check (actor_type in ('system','human','agent','provider','workflow')),
  actor_id text,
  company_id text,
  contact_id text,
  lead_id text,
  campaign_version_id uuid references public.outbound_campaign_versions(id) on delete set null,
  experiment_id uuid references public.outbound_experiments(id) on delete set null,
  experiment_arm_key text,
  message_id text,
  correlation_id text,
  causation_id text,
  idempotency_key text,
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.outbound_agent_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  agent_key text not null,
  action_class text not null
    check (action_class in (
      'observe',
      'draft',
      'suppress',
      'stop_sequence',
      'reduce_sender_capacity',
      'pause_sender',
      'classify_reply',
      'send_safe_reply',
      'allocate_experiment_traffic',
      'publish_experiment',
      'change_claim',
      'change_permission_basis',
      'legal_response'
    )),
  autonomy_level integer not null check (autonomy_level between 0 and 5),
  subject_type text not null,
  subject_id text not null,
  recommendation jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  confidence numeric(8,6) not null check (confidence >= 0 and confidence <= 1),
  policy_version text not null,
  requires_approval boolean not null default true,
  status text not null default 'proposed'
    check (status in ('proposed','approved','rejected','executed','failed','expired')),
  approved_by text,
  approved_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outbound_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  decision_id uuid not null references public.outbound_agent_decisions(id) on delete cascade,
  status text not null check (status in ('approved','rejected')),
  decided_by text not null,
  reason text,
  decided_at timestamptz not null default now()
);

create table if not exists public.outbound_sender_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  target_type text not null check (target_type in ('mailbox','domain')),
  target_id text not null,
  health_status text not null check (health_status in ('healthy','watch','degraded','paused')),
  metrics jsonb not null default '{}'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  observed_at timestamptz not null default now()
);

create index if not exists outbound_campaign_versions_key_idx
  on public.outbound_campaign_versions(workspace, campaign_key, version desc);

create index if not exists outbound_experiments_campaign_idx
  on public.outbound_experiments(campaign_version_id, status);

create index if not exists outbound_assignments_subject_idx
  on public.outbound_experiment_assignments(workspace, subject_type, subject_id);

create index if not exists outbound_permissions_lookup_idx
  on public.outbound_contact_permissions(workspace, contact_id, company_id, channel, status);

create index if not exists outbound_events_time_idx
  on public.outbound_events(workspace, occurred_at desc);

create index if not exists outbound_events_company_idx
  on public.outbound_events(workspace, company_id, occurred_at desc);

create index if not exists outbound_events_lead_idx
  on public.outbound_events(workspace, lead_id, occurred_at desc);

create index if not exists outbound_events_experiment_idx
  on public.outbound_events(experiment_id, experiment_arm_key, occurred_at desc);

create unique index if not exists outbound_events_idempotency_uidx
  on public.outbound_events(workspace, idempotency_key)
  where idempotency_key is not null;

create index if not exists outbound_agent_decisions_subject_idx
  on public.outbound_agent_decisions(workspace, subject_type, subject_id, created_at desc);

create index if not exists outbound_sender_health_latest_idx
  on public.outbound_sender_health_snapshots(workspace, target_type, target_id, observed_at desc);

create or replace function public.outbound_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists outbound_campaign_versions_touch on public.outbound_campaign_versions;
create trigger outbound_campaign_versions_touch
before update on public.outbound_campaign_versions
for each row execute function public.outbound_touch_updated_at();

drop trigger if exists outbound_permissions_touch on public.outbound_contact_permissions;
create trigger outbound_permissions_touch
before update on public.outbound_contact_permissions
for each row execute function public.outbound_touch_updated_at();

drop trigger if exists outbound_agent_decisions_touch on public.outbound_agent_decisions;
create trigger outbound_agent_decisions_touch
before update on public.outbound_agent_decisions
for each row execute function public.outbound_touch_updated_at();

create or replace function public.outbound_prevent_published_campaign_content_edit()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('approved','running','paused','completed','archived') and (
    old.campaign_key is distinct from new.campaign_key
    or old.version is distinct from new.version
    or old.name is distinct from new.name
    or old.audience_definition is distinct from new.audience_definition
    or old.offer_definition is distinct from new.offer_definition
    or old.steps is distinct from new.steps
    or old.content_hash is distinct from new.content_hash
  ) then
    raise exception 'Published campaign versions are immutable; create a new version instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists outbound_campaign_versions_immutable on public.outbound_campaign_versions;
create trigger outbound_campaign_versions_immutable
before update on public.outbound_campaign_versions
for each row execute function public.outbound_prevent_published_campaign_content_edit();

alter table public.outbound_campaign_versions enable row level security;
alter table public.outbound_experiments enable row level security;
alter table public.outbound_experiment_arms enable row level security;
alter table public.outbound_experiment_assignments enable row level security;
alter table public.outbound_contact_permissions enable row level security;
alter table public.outbound_events enable row level security;
alter table public.outbound_agent_decisions enable row level security;
alter table public.outbound_approvals enable row level security;
alter table public.outbound_sender_health_snapshots enable row level security;

revoke all on table public.outbound_campaign_versions from anon, authenticated;
revoke all on table public.outbound_experiments from anon, authenticated;
revoke all on table public.outbound_experiment_arms from anon, authenticated;
revoke all on table public.outbound_experiment_assignments from anon, authenticated;
revoke all on table public.outbound_contact_permissions from anon, authenticated;
revoke all on table public.outbound_events from anon, authenticated;
revoke all on table public.outbound_agent_decisions from anon, authenticated;
revoke all on table public.outbound_approvals from anon, authenticated;
revoke all on table public.outbound_sender_health_snapshots from anon, authenticated;

drop policy if exists outbound_campaign_versions_deny_client on public.outbound_campaign_versions;
create policy outbound_campaign_versions_deny_client on public.outbound_campaign_versions
for all to anon, authenticated using (false) with check (false);

drop policy if exists outbound_experiments_deny_client on public.outbound_experiments;
create policy outbound_experiments_deny_client on public.outbound_experiments
for all to anon, authenticated using (false) with check (false);

drop policy if exists outbound_experiment_arms_deny_client on public.outbound_experiment_arms;
create policy outbound_experiment_arms_deny_client on public.outbound_experiment_arms
for all to anon, authenticated using (false) with check (false);

drop policy if exists outbound_experiment_assignments_deny_client on public.outbound_experiment_assignments;
create policy outbound_experiment_assignments_deny_client on public.outbound_experiment_assignments
for all to anon, authenticated using (false) with check (false);

drop policy if exists outbound_contact_permissions_deny_client on public.outbound_contact_permissions;
create policy outbound_contact_permissions_deny_client on public.outbound_contact_permissions
for all to anon, authenticated using (false) with check (false);

drop policy if exists outbound_events_deny_client on public.outbound_events;
create policy outbound_events_deny_client on public.outbound_events
for all to anon, authenticated using (false) with check (false);

drop policy if exists outbound_agent_decisions_deny_client on public.outbound_agent_decisions;
create policy outbound_agent_decisions_deny_client on public.outbound_agent_decisions
for all to anon, authenticated using (false) with check (false);

drop policy if exists outbound_approvals_deny_client on public.outbound_approvals;
create policy outbound_approvals_deny_client on public.outbound_approvals
for all to anon, authenticated using (false) with check (false);

drop policy if exists outbound_sender_health_deny_client on public.outbound_sender_health_snapshots;
create policy outbound_sender_health_deny_client on public.outbound_sender_health_snapshots
for all to anon, authenticated using (false) with check (false);
