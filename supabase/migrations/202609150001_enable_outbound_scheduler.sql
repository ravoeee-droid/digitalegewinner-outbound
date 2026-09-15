-- The dg-outbound-send / dg-outbound-replies pg_cron jobs (created in
-- 202608120004_prepare_outbound_scheduler.sql) were wired up but left
-- disabled by default, so queued emails and reply checks never actually
-- ran on their 5/10 minute schedule. Turn them on.
update dg_private.scheduler_control set enabled = true, updated_at = now() where id = true;
