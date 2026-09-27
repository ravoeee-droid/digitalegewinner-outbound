-- Schedule the protected durable workflow worker through the existing
-- pg_cron -> dg_private.invoke_worker -> Vercel transport.
-- Safe to apply only after /api/cron/workflows is deployed.

alter table public.outbound_workflow_signals
  alter column max_attempts set default 288;

update public.outbound_workflow_signals
set max_attempts=greatest(max_attempts,288)
where processed_at is null;

do $
declare
  existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job where jobname='dg-outbound-workflows'
  loop
    perform cron.unschedule(existing_job);
  end loop;

  perform cron.schedule(
    'dg-outbound-workflows',
    '*/5 * * * *',
    $job$select dg_private.invoke_worker('/api/cron/workflows');$job$
  );
end
$$;
