alter table public.pflege_email_outreach
  add column if not exists company_key text not null default '';

update public.pflege_email_outreach
set company_key = lower(trim(coalesce(lead->>'name','')))
where company_key='';

with ranked as (
  select id,
    row_number() over (
      partition by company_key
      order by case when status='historical' then 0 else 1 end, lead_date asc, created_at asc
    ) as rn
  from public.pflege_email_outreach
  where company_key<>''
)
delete from public.pflege_email_outreach q
using ranked r
where q.id=r.id and r.rn>1;

create unique index if not exists pflege_email_outreach_company_key_idx
  on public.pflege_email_outreach(company_key)
  where company_key<>'';

create or replace function public.set_pflege_email_outreach_company_key()
returns trigger
language plpgsql
set search_path=''
as $fn$
begin
  new.company_key := lower(trim(coalesce(new.lead->>'name','')));
  return new;
end;
$fn$;

drop trigger if exists pflege_email_outreach_company_key_trg on public.pflege_email_outreach;
create trigger pflege_email_outreach_company_key_trg
before insert or update of lead on public.pflege_email_outreach
for each row execute function public.set_pflege_email_outreach_company_key();

revoke all on function public.set_pflege_email_outreach_company_key() from public, anon, authenticated;
