-- vercel.json can only carry 2 crons on the Hobby plan (account-wide limit),
-- so mailbox warmup lost its Vercel Cron slot to /api/cron/send and
-- /api/cron/replies, the two that actually determine whether outbound works
-- at all. Schedule it here instead, reusing the existing dg_private.invoke_worker
-- helper (see 202608120004_prepare_outbound_scheduler.sql) the same way
-- dg-outbound-send/dg-outbound-replies already do.

select cron.unschedule(jobid)
from cron.job
where jobname = 'dg-outbound-warmup';

select cron.schedule(
  'dg-outbound-warmup',
  '0 6 * * *',
  $job$select dg_private.invoke_worker('/api/cron/warmup');$job$
);
