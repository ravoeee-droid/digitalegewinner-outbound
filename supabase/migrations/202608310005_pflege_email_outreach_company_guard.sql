drop index if exists public.pflege_email_outreach_company_key_idx;
create index if not exists pflege_email_outreach_company_key_lookup_idx
  on public.pflege_email_outreach(company_key)
  where company_key<>'';

create or replace function public.set_pflege_email_outreach_company_key()
returns trigger
language plpgsql
set search_path=''
as $fn$
declare
  normalized text;
begin
  normalized := lower(trim(coalesce(new.lead->>'name','')));
  new.company_key := normalized;

  if tg_op='INSERT' and normalized<>'' and exists (
    select 1 from public.pflege_email_outreach q where q.company_key=normalized
  ) then
    return null;
  end if;

  return new;
end;
$fn$;

revoke all on function public.set_pflege_email_outreach_company_key() from public, anon, authenticated;
