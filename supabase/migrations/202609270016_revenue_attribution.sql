-- DG Outbound OS V3 — M9 Revenue Attribution

create table if not exists public.outbound_attribution_facts (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  fact_key text not null,
  fact_type text not null
    check (fact_type in ('meeting_booked','meeting_held','opportunity_created','won','lost','revenue')),
  source_kind text not null
    check (source_kind in ('outbound_event','sales_opportunity','manual','calendar','crm')),
  source_id text not null,
  lead_id text,
  company_id text,
  opportunity_id text,
  occurred_at timestamptz not null,
  amount numeric,
  currency text not null default 'EUR',
  revenue_kind text,
  campaign_version_id uuid references public.outbound_campaign_versions(id) on delete set null,
  experiment_id uuid references public.outbound_experiments(id) on delete set null,
  experiment_arm_key text,
  exposure_id uuid references public.outbound_experiment_exposures(id) on delete set null,
  attribution_model text not null default 'last_company_exposure_before_conversion',
  attribution_confidence numeric(8,6) not null default 0 check (attribution_confidence >= 0 and attribution_confidence <= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace,fact_key)
);

create index if not exists outbound_attribution_facts_campaign_idx
  on public.outbound_attribution_facts(workspace,campaign_version_id,fact_type,occurred_at);

create index if not exists outbound_attribution_facts_experiment_idx
  on public.outbound_attribution_facts(workspace,experiment_id,experiment_arm_key,fact_type,occurred_at);

create index if not exists outbound_attribution_facts_company_idx
  on public.outbound_attribution_facts(workspace,company_id,occurred_at desc);

drop trigger if exists outbound_attribution_facts_touch on public.outbound_attribution_facts;
create trigger outbound_attribution_facts_touch
before update on public.outbound_attribution_facts
for each row execute function public.outbound_touch_updated_at();

alter table public.outbound_attribution_facts enable row level security;
revoke all on table public.outbound_attribution_facts from anon, authenticated;
drop policy if exists outbound_attribution_facts_deny_client on public.outbound_attribution_facts;
create policy outbound_attribution_facts_deny_client
  on public.outbound_attribution_facts for all to anon, authenticated
  using (false) with check (false);
