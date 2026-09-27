-- DG Outbound OS V3 — M8 Copy + AI Evals

create table if not exists public.outbound_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  prompt_key text not null,
  version integer not null,
  status text not null default 'draft'
    check (status in ('draft','active','retired')),
  purpose text not null,
  model text,
  system_prompt text not null,
  user_template text not null,
  response_schema jsonb not null default '{}'::jsonb,
  policy_version text not null,
  content_hash text not null,
  created_by text not null,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace,prompt_key,version),
  unique (workspace,prompt_key,content_hash)
);

create unique index if not exists outbound_prompt_versions_active_uidx
  on public.outbound_prompt_versions(workspace,prompt_key)
  where status='active';

create table if not exists public.outbound_eval_datasets (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  dataset_key text not null,
  version integer not null,
  status text not null default 'active'
    check (status in ('draft','active','retired')),
  description text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (workspace,dataset_key,version)
);

create table if not exists public.outbound_eval_cases (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.outbound_eval_datasets(id) on delete cascade,
  case_key text not null,
  input jsonb not null,
  expected jsonb not null,
  tags text[] not null default '{}',
  weight numeric(8,4) not null default 1 check (weight > 0),
  created_at timestamptz not null default now(),
  unique (dataset_id,case_key)
);

create table if not exists public.outbound_eval_runs (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  dataset_id uuid not null references public.outbound_eval_datasets(id) on delete restrict,
  prompt_version_id uuid references public.outbound_prompt_versions(id) on delete set null,
  status text not null default 'running'
    check (status in ('running','completed','failed')),
  trigger_kind text not null default 'manual'
    check (trigger_kind in ('manual','regression','promotion_gate')),
  model text,
  total_cases integer not null default 0,
  passed_cases integer not null default 0,
  score numeric(10,6),
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.outbound_eval_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.outbound_eval_runs(id) on delete cascade,
  case_id uuid not null references public.outbound_eval_cases(id) on delete cascade,
  passed boolean not null,
  score numeric(10,6) not null,
  output jsonb not null default '{}'::jsonb,
  violations jsonb not null default '[]'::jsonb,
  critic jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id,case_id)
);

create table if not exists public.outbound_copy_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  strategy_hypothesis_id uuid references public.outbound_strategy_hypotheses(id) on delete set null,
  company_id text,
  prompt_version_id uuid references public.outbound_prompt_versions(id) on delete set null,
  channel text not null default 'email' check (channel in ('email')),
  status text not null default 'proposed'
    check (status in ('proposed','passed','failed','approved','rejected','archived')),
  subject text not null,
  body text not null,
  claims jsonb not null default '[]'::jsonb,
  evidence_ids uuid[] not null default '{}',
  quality_score numeric(10,6),
  critic jsonb not null default '{}'::jsonb,
  content_hash text not null,
  generator text not null,
  model text,
  prompt_version text not null,
  created_by text not null,
  reviewed_by text,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outbound_copy_candidates_status_idx
  on public.outbound_copy_candidates(workspace,status,created_at desc);

create index if not exists outbound_copy_candidates_hypothesis_idx
  on public.outbound_copy_candidates(strategy_hypothesis_id,created_at desc);

drop trigger if exists outbound_copy_candidates_touch on public.outbound_copy_candidates;
create trigger outbound_copy_candidates_touch
before update on public.outbound_copy_candidates
for each row execute function public.outbound_touch_updated_at();

alter table public.outbound_prompt_versions enable row level security;
alter table public.outbound_eval_datasets enable row level security;
alter table public.outbound_eval_cases enable row level security;
alter table public.outbound_eval_runs enable row level security;
alter table public.outbound_eval_results enable row level security;
alter table public.outbound_copy_candidates enable row level security;

revoke all on table public.outbound_prompt_versions from anon, authenticated;
revoke all on table public.outbound_eval_datasets from anon, authenticated;
revoke all on table public.outbound_eval_cases from anon, authenticated;
revoke all on table public.outbound_eval_runs from anon, authenticated;
revoke all on table public.outbound_eval_results from anon, authenticated;
revoke all on table public.outbound_copy_candidates from anon, authenticated;

drop policy if exists outbound_prompt_versions_deny_client on public.outbound_prompt_versions;
create policy outbound_prompt_versions_deny_client on public.outbound_prompt_versions
  for all to anon, authenticated using (false) with check (false);
drop policy if exists outbound_eval_datasets_deny_client on public.outbound_eval_datasets;
create policy outbound_eval_datasets_deny_client on public.outbound_eval_datasets
  for all to anon, authenticated using (false) with check (false);
drop policy if exists outbound_eval_cases_deny_client on public.outbound_eval_cases;
create policy outbound_eval_cases_deny_client on public.outbound_eval_cases
  for all to anon, authenticated using (false) with check (false);
drop policy if exists outbound_eval_runs_deny_client on public.outbound_eval_runs;
create policy outbound_eval_runs_deny_client on public.outbound_eval_runs
  for all to anon, authenticated using (false) with check (false);
drop policy if exists outbound_eval_results_deny_client on public.outbound_eval_results;
create policy outbound_eval_results_deny_client on public.outbound_eval_results
  for all to anon, authenticated using (false) with check (false);
drop policy if exists outbound_copy_candidates_deny_client on public.outbound_copy_candidates;
create policy outbound_copy_candidates_deny_client on public.outbound_copy_candidates
  for all to anon, authenticated using (false) with check (false);

with prompt_seed as (
  select
    'default'::text as workspace,
    'cold-email-copy'::text as prompt_key,
    1::int as version,
    'active'::text as status,
    'Evidence-backed B2B cold email draft'::text as purpose,
    null::text as model,
    'Write a concise B2B cold email using only supplied evidence. Never invent facts, results, guarantees, vacancy costs, reach, urgency, or decision-maker details. Every company-specific factual claim must cite evidence IDs in the structured claims field. Keep the email natural and short.'::text as system_prompt,
    'Company: {{company}}\nStrategy: {{strategy}}\nEvidence: {{evidence}}'::text as user_template,
    '{"type":"object","required":["subject","body","claims"],"properties":{"subject":{"type":"string"},"body":{"type":"string"},"claims":{"type":"array"}}}'::jsonb as response_schema,
    'dg-copy-critic-2026-09-27-v1'::text as policy_version
)
insert into public.outbound_prompt_versions(
  workspace,prompt_key,version,status,purpose,model,system_prompt,user_template,response_schema,
  policy_version,content_hash,created_by,approved_by,approved_at
)
select
  workspace,prompt_key,version,status,purpose,model,system_prompt,user_template,response_schema,
  policy_version,encode(digest(system_prompt||E'\n'||user_template,'sha256'),'hex'),'migration','migration',now()
from prompt_seed
on conflict(workspace,prompt_key,version) do nothing;

insert into public.outbound_eval_datasets(workspace,dataset_key,version,status,description,created_by)
values(
  'default','cold-email-critic-regression',1,'active',
  'Static regression cases for evidence, claims, length, guarantee and spam-risk gates.',
  'migration'
)
on conflict(workspace,dataset_key,version) do nothing;

with ds as (
  select id from public.outbound_eval_datasets
  where workspace='default' and dataset_key='cold-email-critic-regression' and version=1
)
insert into public.outbound_eval_cases(dataset_id,case_key,input,expected,tags)
select id,'safe-short-evidence',
  '{"subject":"Kurze Frage zu Ihrer Karriereseite","body":"Hallo Frau Beispiel, auf Ihrer Karriereseite ist aktuell eine offene Stelle zu sehen. Wir bauen Recruiting-Systeme, die den Bewerberweg vereinfachen. Ist das Thema aktuell relevant?","claims":[{"text":"Auf Ihrer Karriereseite ist aktuell eine offene Stelle zu sehen.","evidenceIds":["11111111-1111-1111-1111-111111111111"]}],"evidenceIds":["11111111-1111-1111-1111-111111111111"]}'::jsonb,
  '{"pass":true}'::jsonb,
  array['safe','evidence']
from ds
on conflict(dataset_id,case_key) do nothing;

with ds as (
  select id from public.outbound_eval_datasets
  where workspace='default' and dataset_key='cold-email-critic-regression' and version=1
)
insert into public.outbound_eval_cases(dataset_id,case_key,input,expected,tags)
select id,'unsupported-guarantee',
  '{"subject":"Garantiert besetzen","body":"Wir garantieren Ihnen, dass Sie die Stelle in 30 Tagen für 2.500 € besetzen.","claims":[],"evidenceIds":[]}'::jsonb,
  '{"pass":false}'::jsonb,
  array['unsafe','guarantee','unsupported']
from ds
on conflict(dataset_id,case_key) do nothing;

with ds as (
  select id from public.outbound_eval_datasets
  where workspace='default' and dataset_key='cold-email-critic-regression' and version=1
)
insert into public.outbound_eval_cases(dataset_id,case_key,input,expected,tags)
select id,'unsupported-percentage',
  '{"subject":"80% Ihrer Zielgruppe","body":"Wir erreichen 80% aller Pflegekräfte in Ihrer Region.","claims":[],"evidenceIds":[]}'::jsonb,
  '{"pass":false}'::jsonb,
  array['unsafe','number','unsupported']
from ds
on conflict(dataset_id,case_key) do nothing;

with ds as (
  select id from public.outbound_eval_datasets
  where workspace='default' and dataset_key='cold-email-critic-regression' and version=1
)
insert into public.outbound_eval_cases(dataset_id,case_key,input,expected,tags)
select id,'spam-formatting',
  '{"subject":"JETZT SOFORT!!!","body":"HALLO!!! DAS IST DIE BESTE LÖSUNG!!! KLICKEN SIE JETZT!!!","claims":[],"evidenceIds":[]}'::jsonb,
  '{"pass":false}'::jsonb,
  array['unsafe','spam']
from ds
on conflict(dataset_id,case_key) do nothing;
