alter table public.pflege_email_runtime_control
  add column if not exists cursor integer not null default 0,
  add column if not exists cursor_day date,
  add column if not exists last_run_at timestamptz,
  add column if not exists last_error text not null default '';

grant select, update on public.pflege_email_runtime_control to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname='dg-pflege-email-outreach';

select cron.schedule(
  'dg-pflege-email-outreach',
  '*/5 2-7 * * *',
  $job$select dg_private.invoke_pflege_email_outreach();$job$
);
