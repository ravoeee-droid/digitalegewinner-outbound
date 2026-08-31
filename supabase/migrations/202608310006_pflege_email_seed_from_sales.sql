create or replace function public.seed_pflege_email_outreach_from_sales()
returns integer
language plpgsql
security definer
set search_path=''
as $fn$
declare
  d date := (now() at time zone 'Europe/Berlin')::date;
  current_count integer;
  slots integer;
  affected integer := 0;
begin
  select count(*) into current_count
  from public.pflege_email_outreach
  where lead_date=d and status<>'historical';

  slots := greatest(0, 100-current_count);
  if slots=0 then return 0; end if;

  with candidates as (
    select
      c.id company_id,
      c.name,
      c.city,
      c.website,
      coalesce(ct.phone,c.phone,'') phone,
      ct.email,
      coalesce(ct.name,'') contact_name,
      l.priority_score,
      c.metadata->'daily_qualification' dq,
      coalesce(c.metadata->'daily_qualification'->'jobGrowth'->'roles'->0->>'title','Pflegefachkraft') role_title,
      coalesce(c.metadata->'daily_qualification'->'websiteReason'->>0,'Recruiting-Potenzial auf der Website') website_reason,
      coalesce((c.metadata->'daily_qualification'->'jobGrowth'->>'relevantOpenJobs')::integer,0) job_count,
      coalesce(c.metadata->'daily_qualification'->'jobGrowth'->>'latestPublishedAt','') latest_published
    from public.sales_leads l
    join public.sales_companies c on c.id=l.company_id and c.workspace=l.workspace
    join public.sales_contacts ct on ct.id=l.contact_id and ct.workspace=l.workspace
    where l.workspace='default'
      and l.status='active'
      and l.last_contact_at is null
      and not l.do_not_contact
      and c.metadata->'daily_qualification'->>'tier'='A+'
      and coalesce((c.metadata->'daily_qualification'->'jobGrowth'->>'relevantOpenJobs')::integer,0)>0
      and coalesce((c.metadata->'daily_qualification'->>'websiteWeak')::boolean,false)=true
      and coalesce(ct.email,'')<>''
      and lower(ct.email) !~ '(arbeitsagentur\\.de|jobcenter\\.|indeed\\.|stepstone\\.|meinestadt\\.|kimeta\\.|adzuna\\.|talent\\.com|joblift\\.|jobrapido\\.)$'
      and lower(c.name) ~ '(pflegedienst|ambulant|sozialstation|häuslich|haeuslich|krankenpflege|intensivpflege|pflegeteam|pflege von a-z|pflege von a bis z)'
      and lower(c.name) !~ '(pflegeheim|altenheim|seniorenheim|seniorenzentrum|seniorenresidenz|pflegezentrum|pflegewohn|wohnstift|wohnpark|tagespflege|hospiz|krankenhaus|klinik|personaldienst|personalvermittlung|zeitarbeit)'
      and (
        coalesce(c.metadata->'daily_qualification'->'jobGrowth'->>'latestPublishedAt','')=''
        or (c.metadata->'daily_qualification'->'jobGrowth'->>'latestPublishedAt')::date >= d-180
      )
      and not exists (
        select 1 from public.pflege_email_outreach q where q.company_key=lower(trim(c.name))
      )
    order by coalesce((c.metadata->'daily_qualification'->>'priorityScore')::integer,l.priority_score) desc,
             coalesce((c.metadata->'daily_qualification'->'jobGrowth'->>'relevantOpenJobs')::integer,0) desc
    limit slots
  ), prepared as (
    select
      d lead_date,
      current_count + row_number() over (order by coalesce((dq->>'priorityScore')::integer,priority_score) desc,job_count desc)::integer rank,
      'crm-a-plus|' || md5(lower(trim(name))) lead_key,
      email,
      name || ': kurze Idee zu ' || role_title subject,
      (case when contact_name<>'' then 'Guten Tag ' || contact_name || ',' else 'Guten Tag,' end) || E'\n\n' ||
      case when job_count>1 then 'ich habe gesehen, dass Sie aktuell mehrere Pflege-Stellen besetzen – unter anderem ' || role_title || '.'
           else 'ich habe gesehen, dass Sie aktuell ' || role_title || ' suchen.' end || E'\n' ||
      'Beim Blick auf Ihren Online-Auftritt ist mir außerdem aufgefallen: ' || website_reason || '.' || E'\n\n' ||
      'Ich baue für Pflegedienste ein kompaktes Websystem, das Website, Bewerber- und Kundenanfragen, Terminbuchung, Automationen und ein Admin-Dashboard zusammenbringt.' || E'\n\n' ||
      'Normalerweise liegt so ein System bei 5.000 €. Aktuell biete ich es für 750 € einmalig + 79 €/Monat an, monatlich kündbar.' || E'\n\n' ||
      'Ich kann Ihnen für ' || name || ' vorab kostenlos einen individuellen Entwurf erstellen. Wenn er Ihnen nicht gefällt, kostet es nichts. Bei Interesse reicht ein kurzes „Ja“ – dann schicke ich Ihnen den Entwurf innerhalb von 48 Stunden.' || E'\n\nBeste Grüße\nRaphael Hermann' body,
      jsonb_build_object(
        'id',company_id,
        'name',name,
        'city',city,
        'website',website,
        'phone',phone,
        'email',email,
        'contactPerson',contact_name,
        'category',case when lower(name) like '%intensiv%' then 'intensive_care' else 'ambulatory_care' end,
        'score',greatest(priority_score,coalesce((dq->>'priorityScore')::integer,0),80),
        'fitScore',98,
        'opportunityScore',coalesce((dq->>'opportunityScore')::integer,0),
        'needScore',coalesce((dq->>'intentScore')::integer,80),
        'tier','1A',
        'callPriority','1A',
        'confidence',0.94,
        'status','new',
        'sourceType','sales-a-plus-seed',
        'scoringVersion','pflege-email-1a-v2',
        'signals',jsonb_build_object(
          'hiringStatus','confirmed',
          'jobCount',job_count,
          'jobTitles',jsonb_build_array(role_title),
          'websiteAudit',jsonb_build_object('finding',website_reason),
          'points',coalesce(dq->'reasons','[]'::jsonb)
        )
      ) lead
    from candidates
  )
  insert into public.pflege_email_outreach(lead_date,rank,lead_key,email,subject,body,status,lead)
  select lead_date,rank,lead_key,email,subject,body,'draft',lead
  from prepared
  on conflict (lead_key) do nothing;

  get diagnostics affected = row_count;
  return affected;
end;
$fn$;

revoke all on function public.seed_pflege_email_outreach_from_sales() from public, anon, authenticated;
grant execute on function public.seed_pflege_email_outreach_from_sales() to service_role;

create or replace function dg_private.invoke_pflege_email_outreach()
returns bigint
language plpgsql
security definer
set search_path=''
as $fn$
declare
  is_enabled boolean;
  auth_secret text;
  request_id bigint;
begin
  perform public.seed_pflege_email_outreach_from_sales();
  perform public.sync_pflege_email_outreach_to_sales();

  select enabled,secret into is_enabled,auth_secret
  from public.pflege_email_runtime_control where id=true;
  if coalesce(is_enabled,false) is not true or coalesce(auth_secret,'')='' then return null; end if;

  select net.http_post(
    url:='https://dessavbytgxyygeohjrn.supabase.co/functions/v1/pflege-email-outreach',
    headers:=jsonb_build_object('Content-Type','application/json','x-dg-pflege-secret',auth_secret),
    body:='{}'::jsonb,
    timeout_milliseconds:=120000
  ) into request_id;
  return request_id;
end;
$fn$;

revoke all on function dg_private.invoke_pflege_email_outreach() from public, anon, authenticated;
