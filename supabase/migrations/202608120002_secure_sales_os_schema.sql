create table if not exists public.sales_workspaces (
  id text primary key,
  name text not null,
  vertical text not null default 'general',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_companies (
  id text primary key,
  workspace text not null,
  name text not null,
  domain text not null default '',
  website text not null default '',
  city text not null default '',
  industry text not null default '',
  phone text not null default '',
  source text not null default 'manual',
  source_id text not null default '',
  lat double precision,
  lng double precision,
  research_status text not null default 'pending',
  latest_score integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_companies_workspace_idx on public.sales_companies(workspace, latest_score desc);
create unique index if not exists sales_companies_source_idx on public.sales_companies(workspace, source, source_id) where source_id <> '';
create unique index if not exists sales_companies_domain_idx on public.sales_companies(workspace, domain) where domain <> '';

create table if not exists public.sales_contacts (
  id text primary key,
  workspace text not null,
  company_id text not null references public.sales_companies(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  linkedin text not null default '',
  instagram text not null default '',
  is_primary boolean not null default false,
  source text not null default 'public-website',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_contacts_company_idx on public.sales_contacts(workspace, company_id);

create table if not exists public.sales_leads (
  id text primary key,
  workspace text not null,
  company_id text not null references public.sales_companies(id) on delete cascade,
  contact_id text references public.sales_contacts(id) on delete set null,
  stage text not null default 'Neu',
  status text not null default 'active',
  deal_value numeric(12,2) not null default 0,
  intent_score integer not null default 0,
  fit_score integer not null default 0,
  opportunity_score integer not null default 0,
  priority_score integer not null default 0,
  owner text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sales_leads_company_idx on public.sales_leads(workspace, company_id) where status='active';
create index if not exists sales_leads_priority_idx on public.sales_leads(workspace, priority_score desc, updated_at desc);

create table if not exists public.sales_activities (
  id bigserial primary key,
  workspace text not null,
  lead_id text,
  company_id text,
  type text not null,
  summary text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sales_activities_lead_idx on public.sales_activities(workspace, lead_id, created_at desc);

create table if not exists public.sales_research_runs (
  id text primary key,
  workspace text not null,
  company_id text not null references public.sales_companies(id) on delete cascade,
  status text not null default 'complete',
  website_score integer not null default 0,
  contact_score integer not null default 0,
  fit_score integer not null default 0,
  opportunity_score integer not null default 0,
  priority_score integer not null default 0,
  signals jsonb not null default '[]'::jsonb,
  audit jsonb not null default '{}'::jsonb,
  contact jsonb not null default '{}'::jsonb,
  summary text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists sales_research_company_idx on public.sales_research_runs(workspace, company_id, created_at desc);

insert into public.sales_workspaces(id,name,vertical) values('default','Digitale Gewinner','general')
on conflict(id) do update set name=excluded.name, updated_at=now();

alter table public.sales_workspaces enable row level security;
alter table public.sales_companies enable row level security;
alter table public.sales_contacts enable row level security;
alter table public.sales_leads enable row level security;
alter table public.sales_activities enable row level security;
alter table public.sales_research_runs enable row level security;

revoke all on table public.sales_workspaces from anon, authenticated;
revoke all on table public.sales_companies from anon, authenticated;
revoke all on table public.sales_contacts from anon, authenticated;
revoke all on table public.sales_leads from anon, authenticated;
revoke all on table public.sales_activities from anon, authenticated;
revoke all on table public.sales_research_runs from anon, authenticated;
revoke usage, select on sequence public.sales_activities_id_seq from anon, authenticated;

drop policy if exists sales_workspaces_deny_client on public.sales_workspaces;
create policy sales_workspaces_deny_client on public.sales_workspaces for all to anon, authenticated using (false) with check (false);
drop policy if exists sales_companies_deny_client on public.sales_companies;
create policy sales_companies_deny_client on public.sales_companies for all to anon, authenticated using (false) with check (false);
drop policy if exists sales_contacts_deny_client on public.sales_contacts;
create policy sales_contacts_deny_client on public.sales_contacts for all to anon, authenticated using (false) with check (false);
drop policy if exists sales_leads_deny_client on public.sales_leads;
create policy sales_leads_deny_client on public.sales_leads for all to anon, authenticated using (false) with check (false);
drop policy if exists sales_activities_deny_client on public.sales_activities;
create policy sales_activities_deny_client on public.sales_activities for all to anon, authenticated using (false) with check (false);
drop policy if exists sales_research_runs_deny_client on public.sales_research_runs;
create policy sales_research_runs_deny_client on public.sales_research_runs for all to anon, authenticated using (false) with check (false);
