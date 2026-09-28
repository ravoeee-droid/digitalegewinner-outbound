-- DG Outbound OS V3 — M10 Optimization Autopilot

create table if not exists public.outbound_optimization_policies (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  policy_key text not null,
  version integer not null,
  status text not null default 'draft'
    check (status in ('draft','approved','active','paused','retired')),
  description text not null,
  max_weight_shift_per_cycle numeric(8,6) not null default 0.10
    check (max_weight_shift_per_cycle > 0 and max_weight_shift_per_cycle <= 0.25),
  min_control_weight numeric(8,6) not null default 0.20
    check (min_control_weight >= 0 and min_control_weight <= 1),
  min_arm_exposure integer not null default 50 check (min_arm_exposure >= 20),
  cooldown_hours integer not null default 24 check (cooldown_hours >= 1),
  require_evidence_signal boolean not null default true,
  require_clean_guardrails boolean not null default true,
  allow_new_experiment_drafts boolean not null default true,
  allow_traffic_allocation boolean not null default true,
  max_active_experiments integer not null default 10 check (max_active_experiments >= 1),
  policy jsonb not null default '{}'::jsonb,
  approved_by text,
  approved_at timestamptz,
  activated_by text,
  activated_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace,policy_key,version)
);

create unique index if not exists outbound_optimization_policies_active_uidx
  on public.outbound_optimization_policies(workspace,policy_key)
  where status='active';

create table if not exists public.outbound_optimization_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  policy_id uuid references public.outbound_optimization_policies(id) on delete set null,
  experiment_id uuid references public.outbound_experiments(id) on delete cascade,
  proposal_type text not null
    check (proposal_type in ('traffic_allocation','new_experiment')),
  status text not null default 'proposed'
    check (status in ('proposed','approved','rejected','executed','blocked','expired')),
  payload jsonb not null,
  rationale text not null,
  evidence jsonb not null default '[]'::jsonb,
  blocker_reasons jsonb not null default '[]'::jsonb,
  decision_id uuid references public.outbound_agent_decisions(id) on delete set null,
  approved_by text,
  approved_at timestamptz,
  executed_by text,
  executed_at timestamptz,
  execution_result jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outbound_optimization_proposals_status_idx
  on public.outbound_optimization_proposals(workspace,status,proposal_type,created_at desc);

create index if not exists outbound_optimization_proposals_experiment_idx
  on public.outbound_optimization_proposals(experiment_id,created_at desc);

create table if not exists public.outbound_optimization_cycles (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  policy_id uuid references public.outbound_optimization_policies(id) on delete set null,
  status text not null check (status in ('completed','blocked','failed')),
  autonomy_level integer not null,
  examined integer not null default 0,
  proposed integer not null default 0,
  executed integer not null default 0,
  blocked integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

drop trigger if exists outbound_optimization_policies_touch on public.outbound_optimization_policies;
create trigger outbound_optimization_policies_touch
before update on public.outbound_optimization_policies
for each row execute function public.outbound_touch_updated_at();

drop trigger if exists outbound_optimization_proposals_touch on public.outbound_optimization_proposals;
create trigger outbound_optimization_proposals_touch
before update on public.outbound_optimization_proposals
for each row execute function public.outbound_touch_updated_at();

alter table public.outbound_optimization_policies enable row level security;
alter table public.outbound_optimization_proposals enable row level security;
alter table public.outbound_optimization_cycles enable row level security;

revoke all on table public.outbound_optimization_policies from anon, authenticated;
revoke all on table public.outbound_optimization_proposals from anon, authenticated;
revoke all on table public.outbound_optimization_cycles from anon, authenticated;

drop policy if exists outbound_optimization_policies_deny_client on public.outbound_optimization_policies;
create policy outbound_optimization_policies_deny_client on public.outbound_optimization_policies
  for all to anon, authenticated using (false) with check (false);
drop policy if exists outbound_optimization_proposals_deny_client on public.outbound_optimization_proposals;
create policy outbound_optimization_proposals_deny_client on public.outbound_optimization_proposals
  for all to anon, authenticated using (false) with check (false);
drop policy if exists outbound_optimization_cycles_deny_client on public.outbound_optimization_cycles;
create policy outbound_optimization_cycles_deny_client on public.outbound_optimization_cycles
  for all to anon, authenticated using (false) with check (false);

insert into public.outbound_optimization_policies(
  workspace,policy_key,version,status,description,max_weight_shift_per_cycle,min_control_weight,
  min_arm_exposure,cooldown_hours,require_evidence_signal,require_clean_guardrails,
  allow_new_experiment_drafts,allow_traffic_allocation,max_active_experiments,policy,created_by
)
values(
  'default','conservative-l4',1,'draft',
  'Conservative optimization policy. Human approval/activation required before L4 execution.',
  0.10,0.20,50,24,true,true,true,true,10,
  '{"noAutomaticWinner":true,"requireHumanPolicyApproval":true,"trafficChangesAreForwardOnly":true}'::jsonb,
  'migration'
)
on conflict(workspace,policy_key,version) do nothing;
