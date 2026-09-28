-- M9 revenue attribution sync worker.

create or replace function dg_private.invoke_revenue_attribution_worker()
returns bigint
language plpgsql
security definer
set search_path to ''
as $revenue$
declare
  v3_mode_value text;
  app_url text;
  auth_secret text;
  request_id bigint;
begin
  select v3_mode into v3_mode_value
  from public.outbound_runtime_settings
  where workspace='default'
  limit 1;
  if coalesce(v3_mode_value,'off')='off' then return null; end if;

  select decrypted_secret into app_url from vault.decrypted_secrets
  where name='dg_app_url' order by created_at desc limit 1;
  select decrypted_secret into auth_secret from vault.decrypted_secrets
  where name='dg_cron_secret' order by created_at desc limit 1;
  if app_url is null or auth_secret is null then
    raise exception 'DG revenue scheduler Vault configuration missing';
  end if;

  select net.http_post(
    url := rtrim(app_url,'/') || '/api/cron/revenue-attribution',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || auth_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) into request_id;
  return request_id;
end;
$revenue$;

revoke all on function dg_private.invoke_revenue_attribution_worker() from public;
revoke all on function dg_private.invoke_revenue_attribution_worker() from anon;
revoke all on function dg_private.invoke_revenue_attribution_worker() from authenticated;

select cron.unschedule(jobid) from cron.job where jobname='dg-outbound-revenue-attribution';

select cron.schedule(
  'dg-outbound-revenue-attribution',
  '4,19,34,49 * * * *',
  'select dg_private.invoke_revenue_attribution_worker();'
);
