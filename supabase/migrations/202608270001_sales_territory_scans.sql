create table if not exists public.sales_territory_scans (
  id bigserial primary key,
  workspace text not null,
  state text not null,
  state_code text not null default '',
  sector text not null,
  term text not null,
  query_key text not null,
  status text not null default 'pending',
  pages_scanned integer not null default 0,
  found_count integer not null default 0,
  last_page_token text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sales_territory_scans_key_idx
  on public.sales_territory_scans(workspace, query_key);
create index if not exists sales_territory_scans_state_idx
  on public.sales_territory_scans(workspace, state, status);

alter table public.sales_territory_scans enable row level security;
revoke all on table public.sales_territory_scans from anon, authenticated;
grant select, insert, update, delete on table public.sales_territory_scans to service_role;
