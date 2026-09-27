-- DG Outbound OS V3 — M7 Research + Strategy Agents

create table if not exists public.outbound_research_runs (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  company_id text not null,
  lead_id text,
  status text not null default 'queued'
    check (status in ('queued','processing','completed','failed','cancelled')),
  strategy_version text not null,
  source_urls jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  confidence numeric(8,6),
  attempt integer not null default 0,
  max_attempts integer not null default 4,
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outbound_research_runs_queue_idx
  on public.outbound_research_runs(workspace,status,queued_at)
  where status in ('queued','processing');

create index if not exists outbound_research_runs_company_idx
  on public.outbound_research_runs(workspace,company_id,created_at desc);

create table if not exists public.outbound_evidence_items (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  research_run_id uuid references public.outbound_research_runs(id) on delete cascade,
  company_id text not null,
  lead_id text,
  evidence_key text not null,
  evidence_type text not null
    check (evidence_type in ('website','career_page','job_signal','crm','public_page','operator','derived')),
  claim text not null,
  value_text text,
  source_url text,
  source_title text,
  observed_at timestamptz not null,
  confidence numeric(8,6) not null check (confidence >= 0 and confidence <= 1),
  content_hash text,
  excerpt text,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists outbound_evidence_items_company_idx
  on public.outbound_evidence_items(workspace,company_id,observed_at desc);

create index if not exists outbound_evidence_items_key_idx
  on public.outbound_evidence_items(workspace,company_id,evidence_key,observed_at desc);

create table if not exists public.outbound_strategy_hypotheses (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  research_run_id uuid references public.outbound_research_runs(id) on delete set null,
  company_id text,
  segment_key text not null,
  hypothesis_key text not null,
  version integer not null default 1,
  status text not null default 'proposed'
    check (status in ('proposed','approved','rejected','archived')),
  hypothesis text not null,
  audience_angle text not null,
  pain_statement text not null,
  value_proposition text not null,
  proof_requirements jsonb not null default '[]'::jsonb,
  evidence_ids uuid[] not null default '{}',
  confidence numeric(8,6) not null check (confidence >= 0 and confidence <= 1),
  generator text not null,
  model text,
  prompt_version text not null,
  created_by text not null,
  reviewed_by text,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace,hypothesis_key,version)
);

create index if not exists outbound_strategy_hypotheses_segment_idx
  on public.outbound_strategy_hypotheses(workspace,segment_key,status,created_at desc);

drop trigger if exists outbound_research_runs_touch on public.outbound_research_runs;
create trigger outbound_research_runs_touch
before update on public.outbound_research_runs
for each row execute function public.outbound_touch_updated_at();

drop trigger if exists outbound_strategy_hypotheses_touch on public.outbound_strategy_hypotheses;
create trigger outbound_strategy_hypotheses_touch
before update on public.outbound_strategy_hypotheses
for each row execute function public.outbound_touch_updated_at();

alter table public.outbound_research_runs enable row level security;
alter table public.outbound_evidence_items enable row level security;
alter table public.outbound_strategy_hypotheses enable row level security;

revoke all on table public.outbound_research_runs from anon, authenticated;
revoke all on table public.outbound_evidence_items from anon, authenticated;
revoke all on table public.outbound_strategy_hypotheses from anon, authenticated;

drop policy if exists outbound_research_runs_deny_client on public.outbound_research_runs;
create policy outbound_research_runs_deny_client
  on public.outbound_research_runs for all to anon, authenticated
  using (false) with check (false);

drop policy if exists outbound_evidence_items_deny_client on public.outbound_evidence_items;
create policy outbound_evidence_items_deny_client
  on public.outbound_evidence_items for all to anon, authenticated
  using (false) with check (false);

drop policy if exists outbound_strategy_hypotheses_deny_client on public.outbound_strategy_hypotheses;
create policy outbound_strategy_hypotheses_deny_client
  on public.outbound_strategy_hypotheses for all to anon, authenticated
  using (false) with check (false);
