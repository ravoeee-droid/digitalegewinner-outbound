create schema if not exists dg_private;
revoke all on schema dg_private from public, anon, authenticated;

create table if not exists public.pflege_email_outreach (
  id uuid primary key default gen_random_uuid(),
  lead_date date not null,
  rank integer not null default 0,
  lead_key text not null,
  company_id text not null default '',
  email text not null default '',
  subject text not null default '',
  body text not null default '',
  status text not null default 'draft' check (status in ('historical','draft','approved','sent','replied','blocked')),
  lead jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pflege_email_outreach_lead_key_idx
  on public.pflege_email_outreach(lead_key);
create index if not exists pflege_email_outreach_day_idx
  on public.pflege_email_outreach(lead_date, status, rank);
create index if not exists pflege_email_outreach_email_idx
  on public.pflege_email_outreach(lower(email)) where email <> '';

alter table public.pflege_email_outreach enable row level security;
revoke all on public.pflege_email_outreach from public, anon, authenticated;
grant select, insert, update on public.pflege_email_outreach to service_role;

create table if not exists public.pflege_email_runtime_control (
  id boolean primary key default true check (id = true),
  enabled boolean not null default true,
  secret text not null,
  target_count integer not null default 100 check (target_count between 1 and 200),
  updated_at timestamptz not null default now()
);

insert into public.pflege_email_runtime_control(id, enabled, secret, target_count)
values (
  true,
  true,
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  100
)
on conflict (id) do update set enabled = true, target_count = 100, updated_at = now();

alter table public.pflege_email_runtime_control enable row level security;
revoke all on public.pflege_email_runtime_control from public, anon, authenticated;
grant select on public.pflege_email_runtime_control to service_role;

-- Seed the uniqueness ledger with prospects already surfaced before today.
-- They remain hidden from the active queue but can never be recycled as a "new" lead.
insert into public.pflege_email_outreach(
  lead_date, rank, lead_key, email, subject, body, status, lead, created_at, updated_at
)
select
  p.lead_date,
  p.rank,
  p.lead_key,
  coalesce(p.lead->>'email',''),
  '',
  '',
  'historical',
  p.lead,
  coalesce(p.generated_at, now()),
  now()
from public.pflege_daily_leads p
where p.lead_date < (now() at time zone 'Europe/Berlin')::date
on conflict (lead_key) do nothing;

create or replace function public.sync_pflege_email_outreach_to_sales()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  d date := (now() at time zone 'Europe/Berlin')::date;
  inserted_companies integer := 0;
  inserted_contacts integer := 0;
  inserted_leads integer := 0;
begin
  -- Keep the visible queue ordered by actual 1A score, not insertion timing.
  with ranked as (
    select id, row_number() over (
      order by coalesce((lead->>'score')::integer,0) desc,
               coalesce((lead->>'needScore')::integer,0) desc,
               created_at asc
    )::integer as rn
    from public.pflege_email_outreach
    where lead_date=d and status <> 'historical'
  )
  update public.pflege_email_outreach q
  set rank=ranked.rn, updated_at=now()
  from ranked
  where q.id=ranked.id;

  update public.sales_companies c
  set phone = case when c.phone='' then coalesce(q.lead->>'phone','') else c.phone end,
      website = case when c.website='' then coalesce(q.lead->>'website','') else c.website end,
      city = case when c.city='' then coalesce(q.lead->>'city','') else c.city end,
      industry = case when c.industry='' then 'Ambulanter Pflegedienst' else c.industry end,
      latest_score = greatest(c.latest_score, coalesce((q.lead->>'score')::integer,0)),
      research_status = case when c.research_status='pending' then 'qualified' else c.research_status end,
      metadata = coalesce(c.metadata,'{}'::jsonb) || jsonb_build_object(
        'pflege_icp_verified', true,
        'pflege_email_outreach', jsonb_build_object(
          'date', d,
          'rank', q.rank,
          'tier', '1A',
          'email', q.email,
          'subject', q.subject,
          'body', q.body,
          'status', q.status,
          'category', q.lead->>'category',
          'signals', q.lead->'signals'
        )
      ),
      updated_at=now()
  from public.pflege_email_outreach q
  where q.lead_date=d and q.status <> 'historical'
    and c.workspace='default'
    and lower(trim(c.name))=lower(trim(q.lead->>'name'));

  insert into public.sales_companies(
    id,workspace,name,domain,website,city,industry,phone,source,source_id,
    research_status,latest_score,metadata,created_at,updated_at
  )
  select
    coalesce(nullif(q.lead->>'id',''),'pflege-email-' || md5(q.lead_key)),
    'default',q.lead->>'name','',coalesce(q.lead->>'website',''),coalesce(q.lead->>'city',''),
    'Ambulanter Pflegedienst',coalesce(q.lead->>'phone',''),'pflege-email-outreach',q.lead_key,
    'qualified',coalesce((q.lead->>'score')::integer,0),
    jsonb_build_object(
      'pflege_icp_verified',true,
      'pflege_email_outreach',jsonb_build_object(
        'date',d,'rank',q.rank,'tier','1A','email',q.email,'subject',q.subject,'body',q.body,
        'status',q.status,'category',q.lead->>'category','signals',q.lead->'signals'
      )
    ),now(),now()
  from public.pflege_email_outreach q
  where q.lead_date=d and q.status <> 'historical'
    and coalesce(q.lead->>'name','')<>''
    and not exists (
      select 1 from public.sales_companies c
      where c.workspace='default' and lower(trim(c.name))=lower(trim(q.lead->>'name'))
    )
  on conflict (id) do update set
    phone=case when public.sales_companies.phone='' then excluded.phone else public.sales_companies.phone end,
    website=case when public.sales_companies.website='' then excluded.website else public.sales_companies.website end,
    latest_score=greatest(public.sales_companies.latest_score,excluded.latest_score),
    metadata=coalesce(public.sales_companies.metadata,'{}'::jsonb) || excluded.metadata,
    updated_at=now();
  get diagnostics inserted_companies = row_count;

  with mapped as (
    select q.*,
      coalesce(
        (select c.id from public.sales_companies c
         where c.workspace='default' and lower(trim(c.name))=lower(trim(q.lead->>'name'))
         order by c.updated_at desc limit 1),
        coalesce(nullif(q.lead->>'id',''),'pflege-email-' || md5(q.lead_key))
      ) as mapped_company_id
    from public.pflege_email_outreach q
    where q.lead_date=d and q.status <> 'historical'
  )
  insert into public.sales_contacts(
    id,workspace,company_id,name,email,phone,is_primary,source,metadata,created_at,updated_at
  )
  select
    'pflege-email-contact-' || md5(m.mapped_company_id),
    'default',m.mapped_company_id,coalesce(m.lead->>'contactPerson',''),m.email,
    coalesce(m.lead->>'phone',''),true,'pflege-email-outreach',
    jsonb_build_object('date',d,'rank',m.rank,'tier','1A','leadKey',m.lead_key),now(),now()
  from mapped m
  where coalesce(m.mapped_company_id,'')<>'' and m.email<>''
  on conflict (id) do update set
    name=case when excluded.name<>'' then excluded.name else public.sales_contacts.name end,
    email=case when excluded.email<>'' then excluded.email else public.sales_contacts.email end,
    phone=case when excluded.phone<>'' then excluded.phone else public.sales_contacts.phone end,
    is_primary=true,
    metadata=coalesce(public.sales_contacts.metadata,'{}'::jsonb) || excluded.metadata,
    updated_at=now();
  get diagnostics inserted_contacts = row_count;

  with mapped as (
    select q.*,
      coalesce(
        (select c.id from public.sales_companies c
         where c.workspace='default' and lower(trim(c.name))=lower(trim(q.lead->>'name'))
         order by c.updated_at desc limit 1),
        coalesce(nullif(q.lead->>'id',''),'pflege-email-' || md5(q.lead_key))
      ) as mapped_company_id
    from public.pflege_email_outreach q
    where q.lead_date=d and q.status <> 'historical'
  )
  update public.sales_leads sl
  set contact_id=coalesce(sl.contact_id,'pflege-email-contact-' || md5(m.mapped_company_id)),
      intent_score=greatest(sl.intent_score,coalesce((m.lead->>'needScore')::integer,0)),
      fit_score=greatest(sl.fit_score,coalesce((m.lead->>'fitScore')::integer,0)),
      opportunity_score=greatest(sl.opportunity_score,coalesce((m.lead->>'opportunityScore')::integer,0)),
      priority_score=greatest(sl.priority_score,coalesce((m.lead->>'score')::integer,0)),
      next_action=case
        when sl.last_contact_at is null and sl.stage in ('Neu','Research','Bereit') then 'E-Mail prüfen'
        else sl.next_action
      end,
      updated_at=now()
  from mapped m
  where sl.workspace='default' and sl.status='active' and sl.company_id=m.mapped_company_id;

  with mapped as (
    select q.*,
      coalesce(
        (select c.id from public.sales_companies c
         where c.workspace='default' and lower(trim(c.name))=lower(trim(q.lead->>'name'))
         order by c.updated_at desc limit 1),
        coalesce(nullif(q.lead->>'id',''),'pflege-email-' || md5(q.lead_key))
      ) as mapped_company_id
    from public.pflege_email_outreach q
    where q.lead_date=d and q.status <> 'historical'
  )
  insert into public.sales_leads(
    id,workspace,company_id,contact_id,stage,status,intent_score,fit_score,
    opportunity_score,priority_score,notes,next_action,do_not_contact,probability,phone_status,
    created_at,updated_at
  )
  select
    'pflege-email-lead-' || md5(m.mapped_company_id),'default',m.mapped_company_id,
    'pflege-email-contact-' || md5(m.mapped_company_id),'Bereit','active',
    coalesce((m.lead->>'needScore')::integer,0),coalesce((m.lead->>'fitScore')::integer,0),
    coalesce((m.lead->>'opportunityScore')::integer,0),coalesce((m.lead->>'score')::integer,0),
    '1A E-Mail Lead · ' || m.subject,'E-Mail prüfen',false,40,
    case when coalesce(m.lead->>'phone','')<>'' then 'ready' else 'unknown' end,
    now(),now()
  from mapped m
  where coalesce(m.mapped_company_id,'')<>''
    and not exists (
      select 1 from public.sales_leads x
      where x.workspace='default' and x.company_id=m.mapped_company_id and x.status='active'
    )
  on conflict (id) do nothing;
  get diagnostics inserted_leads = row_count;

  update public.pflege_email_outreach q
  set company_id = coalesce(
        (select c.id from public.sales_companies c
         where c.workspace='default' and lower(trim(c.name))=lower(trim(q.lead->>'name'))
         order by c.updated_at desc limit 1),
        q.company_id
      ),
      updated_at=now()
  where q.lead_date=d and q.status <> 'historical';

  return jsonb_build_object(
    'date',d,
    'queue_count',(select count(*) from public.pflege_email_outreach where lead_date=d and status <> 'historical'),
    'inserted_or_updated_companies',inserted_companies,
    'inserted_or_updated_contacts',inserted_contacts,
    'inserted_new_leads',inserted_leads
  );
end;
$fn$;

revoke all on function public.sync_pflege_email_outreach_to_sales() from public, anon, authenticated;
grant execute on function public.sync_pflege_email_outreach_to_sales() to service_role;

create or replace function dg_private.invoke_pflege_email_outreach()
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  is_enabled boolean;
  auth_secret text;
  request_id bigint;
begin
  select enabled, secret into is_enabled, auth_secret
  from public.pflege_email_runtime_control
  where id=true;

  if coalesce(is_enabled,false) is not true or coalesce(auth_secret,'')='' then
    return null;
  end if;

  select net.http_post(
    url := 'https://dessavbytgxyygeohjrn.supabase.co/functions/v1/pflege-email-outreach',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-dg-pflege-secret',auth_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into request_id;

  return request_id;
end;
$fn$;

revoke all on function dg_private.invoke_pflege_email_outreach() from public, anon, authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname='dg-pflege-email-outreach';

select cron.schedule(
  'dg-pflege-email-outreach',
  '*/15 3-7 * * *',
  $job$select dg_private.invoke_pflege_email_outreach();$job$
);
