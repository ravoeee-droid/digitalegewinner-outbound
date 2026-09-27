-- DG Outbound OS V3 — M6 Experiment Engine
-- Additive experimentation, exposure tracking and safety stops.

alter table public.outbound_experiments
  add column if not exists legacy_campaign_id text,
  add column if not exists content_hash text,
  add column if not exists control_arm_key text,
  add column if not exists safety_stop_enabled boolean not null default true,
  add column if not exists paused_at timestamptz,
  add column if not exists pause_reason text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.outbound_experiment_arms
  add column if not exists status text not null default 'active'
    check (status in ('active','paused'));

alter table public.er_outbox
  add column if not exists campaign_version_id uuid,
  add column if not exists experiment_id uuid,
  add column if not exists experiment_arm_key text;

create index if not exists er_outbox_experiment_idx
  on public.er_outbox(workspace,experiment_id,experiment_arm_key,status);

create index if not exists outbound_experiments_legacy_campaign_idx
  on public.outbound_experiments(workspace,legacy_campaign_id,status,version desc)
  where legacy_campaign_id is not null;

create table if not exists public.outbound_experiment_exposures (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  experiment_id uuid not null references public.outbound_experiments(id) on delete restrict,
  assignment_id uuid references public.outbound_experiment_assignments(id) on delete set null,
  campaign_version_id uuid references public.outbound_campaign_versions(id) on delete set null,
  subject_type text not null check (subject_type in ('company','contact','lead')),
  subject_id text not null,
  company_id text,
  lead_id text not null,
  arm_key text not null,
  legacy_campaign_id text,
  legacy_outbox_id uuid,
  provider_message_id text,
  exposed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (experiment_id,subject_type,subject_id),
  foreign key (experiment_id,arm_key)
    references public.outbound_experiment_arms(experiment_id,arm_key)
    on delete restrict
);

create index if not exists outbound_experiment_exposures_arm_idx
  on public.outbound_experiment_exposures(experiment_id,arm_key,exposed_at);

create index if not exists outbound_experiment_exposures_lead_idx
  on public.outbound_experiment_exposures(workspace,lead_id,exposed_at desc);

create table if not exists public.outbound_experiment_evaluations (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  experiment_id uuid not null references public.outbound_experiments(id) on delete cascade,
  status text not null
    check (status in (
      'insufficient_data',
      'monitoring',
      'srm_warning',
      'guardrail_risk',
      'evidence_signal',
      'no_clear_signal'
    )),
  total_exposed integer not null default 0,
  srm_p_value numeric(12,10),
  primary_metric text not null,
  primary_results jsonb not null default '{}'::jsonb,
  guardrail_results jsonb not null default '{}'::jsonb,
  recommendation jsonb not null default '{}'::jsonb,
  safety_action text,
  fingerprint text not null,
  evaluated_at timestamptz not null default now(),
  unique (experiment_id,fingerprint)
);

create index if not exists outbound_experiment_evaluations_latest_idx
  on public.outbound_experiment_evaluations(experiment_id,evaluated_at desc);

drop trigger if exists outbound_experiments_touch on public.outbound_experiments;
create trigger outbound_experiments_touch
before update on public.outbound_experiments
for each row execute function public.outbound_touch_updated_at();

alter table public.outbound_experiment_exposures enable row level security;
alter table public.outbound_experiment_evaluations enable row level security;

revoke all on table public.outbound_experiment_exposures from anon, authenticated;
revoke all on table public.outbound_experiment_evaluations from anon, authenticated;

drop policy if exists outbound_experiment_exposures_deny_client on public.outbound_experiment_exposures;
create policy outbound_experiment_exposures_deny_client
  on public.outbound_experiment_exposures for all to anon, authenticated
  using (false) with check (false);

drop policy if exists outbound_experiment_evaluations_deny_client on public.outbound_experiment_evaluations;
create policy outbound_experiment_evaluations_deny_client
  on public.outbound_experiment_evaluations for all to anon, authenticated
  using (false) with check (false);

alter table public.outbound_agent_decisions
  drop constraint if exists outbound_agent_decisions_action_class_check;

alter table public.outbound_agent_decisions
  add constraint outbound_agent_decisions_action_class_check
  check (action_class in (
    'observe',
    'draft',
    'suppress',
    'stop_sequence',
    'reduce_sender_capacity',
    'pause_sender',
    'pause_experiment_safety',
    'classify_reply',
    'send_safe_reply',
    'allocate_experiment_traffic',
    'publish_experiment',
    'change_claim',
    'change_permission_basis',
    'legal_response'
  ));
