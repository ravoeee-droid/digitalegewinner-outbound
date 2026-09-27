-- Schedule M5 Conversation Intelligence worker independently of legacy scheduler.

create or replace function dg_private.invoke_conversation_worker()
returns bigint
language plpgsql
security definer
set search_path to ''
as $conversation$
declare
  conversation_mode_value text;
  v3_mode_value text;
  app_url text;
  auth_secret text;
  request_id bigint;
begin
  select conversation_mode,v3_mode
    into conversation_mode_value,v3_mode_value
  from public.outbound_runtime_settings
  where workspace='default'
  limit 1;

  if coalesce(conversation_mode_value,'off')='off'
     or coalesce(v3_mode_value,'off')='off' then
    return null;
  end if;

  select decrypted_secret into app_url
  from vault.decrypted_secrets
  where name='dg_app_url'
  order by created_at desc
  limit 1;

  select decrypted_secret into auth_secret
  from vault.decrypted_secrets
  where name='dg_cron_secret'
  order by created_at desc
  limit 1;

  if app_url is null or auth_secret is null then
    raise exception 'DG conversation scheduler Vault configuration missing';
  end if;

  select net.http_post(
    url := rtrim(app_url,'/') || '/api/cron/conversations',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || auth_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) into request_id;

  return request_id;
end;
$conversation$;

revoke all on function dg_private.invoke_conversation_worker() from public;
revoke all on function dg_private.invoke_conversation_worker() from anon;
revoke all on function dg_private.invoke_conversation_worker() from authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname='dg-outbound-conversations';

select cron.schedule(
  'dg-outbound-conversations',
  '*/2 * * * *',
  'select dg_private.invoke_conversation_worker();'
);
