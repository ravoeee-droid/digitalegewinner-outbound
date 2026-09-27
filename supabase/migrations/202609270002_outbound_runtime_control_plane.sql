-- DG Outbound OS V3 runtime control plane
-- Additive, fail-closed and safe for deployment before code cutover.

create table if not exists public.outbound_runtime_settings (
  workspace text primary key,
  v3_mode text not null default 'off'
    check (v3_mode in ('off','shadow','active')),
  compliance_mode text not null default 'off'
    check (compliance_mode in ('off','shadow','enforce')),
  autonomy_level integer not null default 2
    check (autonomy_level between 0 and 5),
  durable_workflows_mode text not null default 'off'
    check (durable_workflows_mode in ('off','shadow','active')),
  version integer not null default 1 check (version > 0),
  updated_by text not null default 'system',
  updated_at timestamptz not null default now()
);

insert into public.outbound_runtime_settings(
  workspace,
  v3_mode,
  compliance_mode,
  autonomy_level,
  durable_workflows_mode,
  updated_by
)
values ('default','off','off',2,'off','migration')
on conflict (workspace) do nothing;

alter table public.outbound_runtime_settings enable row level security;
revoke all on table public.outbound_runtime_settings from anon, authenticated;

drop policy if exists outbound_runtime_settings_deny_client
  on public.outbound_runtime_settings;
create policy outbound_runtime_settings_deny_client
  on public.outbound_runtime_settings
  for all to anon, authenticated
  using (false)
  with check (false);

create index if not exists outbound_runtime_settings_updated_idx
  on public.outbound_runtime_settings(updated_at desc);
