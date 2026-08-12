drop policy if exists scheduler_control_deny_all on dg_private.scheduler_control;
create policy scheduler_control_deny_all
on dg_private.scheduler_control
for all
to public
using (false)
with check (false);
