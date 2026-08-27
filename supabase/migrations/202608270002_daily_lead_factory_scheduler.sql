create schema if not exists dg_private;
revoke all on schema dg_private from public, anon, authenticated;

create table if not exists dg_private.lead_factory_control (
  id boolean primary key default true check (id = true),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into dg_private.lead_factory_control(id, enabled)
values (true, true)
on conflict (id) do update set enabled = true, updated_at = now();

alter table dg_private.lead_factory_control enable row level security;
revoke all on dg_private.lead_factory_control from public, anon, authenticated;

create or replace function dg_private.invoke_lead_factory()
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  is_enabled boolean;
  app_url text;
  auth_secret text;
  request_id bigint;
begin
  select enabled into is_enabled
  from dg_private.lead_factory_control
  where id = true;

  if coalesce(is_enabled, false) is not true then
    return null;
  end if;

  select decrypted_secret into app_url
  from vault.decrypted_secrets
  where name = 'dg_app_url'
  order by created_at desc
  limit 1;

  select decrypted_secret into auth_secret
  from vault.decrypted_secrets
  where name = 'dg_cron_secret'
  order by created_at desc
  limit 1;

  if app_url is null or auth_secret is null then
    raise exception 'DG lead factory Vault configuration missing';
  end if;

  select net.http_post(
    url := rtrim(app_url, '/') || '/api/cron/lead-factory',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || auth_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) into request_id;

  return request_id;
end;
$fn$;

revoke all on function dg_private.invoke_lead_factory() from public, anon, authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'dg-lead-factory';

select cron.schedule(
  'dg-lead-factory',
  '*/10 2-18 * * *',
  $job$select dg_private.invoke_lead_factory();$job$
);
