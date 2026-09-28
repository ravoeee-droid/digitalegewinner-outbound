-- Keep Pflege 1A queue aligned with the application quality gate.
-- 1A now requires at least two current Pflege job signals and excludes staffing/intermediaries
-- plus excluded welfare umbrella organizations from the call queue.

CREATE OR REPLACE FUNCTION dg_private.build_pflege_morning_queue(target_count integer DEFAULT 120)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d date := (now() at time zone 'Asia/Bangkok')::date;
  n integer := 0;
  daily_n integer := 0;
  recent_n integer := 0;
  strong_n integer := 0;
  unique_employers integer := 0;
  unique_phones integer := 0;
begin
  target_count := greatest(1, least(target_count, 160));
  delete from public.pflege_morning_queue where queue_date=d;

  with daily_candidates as (
    select 0 as source_priority,'daily_strict'::text as source,p.rank as source_rank,p.lead_key,
      coalesce(p.lead->'crm'->>'leadId',p.lead->>'id','') as lead_id,''::text as company_id,
      coalesce(p.lead->>'name','') as company,coalesce(p.lead->>'phone','') as phone,
      dg_private.pflege_phone_key(p.lead->>'phone') as phone_norm,
      coalesce(nullif(p.lead->>'score','')::integer,0) as score,
      (p.lead - 'website') || jsonb_build_object(
        'website',case when dg_private.pflege_is_portal_url(p.lead->>'website') then '' else coalesce(p.lead->>'website','') end,
        'tier','1A','morningSource','daily_strict',
        'qualityGate','current Pflege job evidence + ambulatory/intensive employer evidence + untouched CRM + unique employer + unique normalized phone'
      ) as payload
    from public.pflege_daily_leads p
    where p.lead_date=d
      and p.lead->>'category' in ('ambulatory_care','intensive_care')
      and coalesce(p.lead->>'phone','')<>''
      and coalesce(nullif(p.lead->>'score','')::integer,0)>=78
      and jsonb_array_length(coalesce(p.lead->'jobReferences','[]'::jsonb))>=2
      and exists (
        select 1 from jsonb_array_elements(coalesce(p.lead->'jobReferences','[]'::jsonb)) jr
        where lower(coalesce(jr->>'title','')) ~ '(pflege|altenpfleg|krankenpflege|krankenschwester|pflegefach|pflegehilf|pflegeassist|pflegedienstleit|praxisanleit)'
      )
      and coalesce((p.lead->'crm'->>'doNotContact')::boolean,false)=false
      and coalesce(p.lead->'crm'->>'lastContactAt','')=''
      and lower(coalesce(p.lead->>'name','')) !~ '(pflegeheim|altenheim|seniorenheim|seniorenzentrum|seniorenresidenz|senioren-?park|pflegezentrum|pflegewohn|wohnstift|wohnpark|tagespflege|hospiz|krankenhaus|klinikum|klinik|psychiatr|rehabilitation|reha-|universitätsmedizin|universitaetsmedizin|personalmanagement|personalberatung|personalvermittlung|personaldienst|zeitarbeit|recruiting agentur|recruiting|staffing|recrutio|trova|med-spezialisten|medical specialists|caritas|arbeiterwohlfahrt|johanniter|awo)'
      and (
        lower(coalesce(p.lead->>'name','')) ~ '(pflegedienst|ambulant|sozialstation|diakoniestation|häuslich|haeuslich|krankenpflege|intensivpflege|pflegeteam|pflege mobil|pflegemobil|home care|home health)'
        or exists (
          select 1 from jsonb_array_elements(coalesce(p.lead->'jobReferences','[]'::jsonb)) jr
          where lower(coalesce(jr->>'title','')) ~ '(ambulant|intensiv|außerklin|ausserklin|häuslich|haeuslich|1\s*:?\s*1)'
        )
        or (
          not dg_private.pflege_is_portal_url(p.lead->>'website')
          and lower(coalesce(p.lead->>'website','')) ~ '(pflege|care|sozialstation|diakonie|caritas|johanniter|malteser|drk|brk|awo|vitolus|cosmea|advita|essentis|aidera)'
        )
      )
  ), recent_daily_candidates as (
    select 1 as source_priority,'recent_daily_buffer'::text as source,50000+((d-p.lead_date)*1000)+p.rank as source_rank,
      'recent:'||p.lead_key as lead_key,cur.lead_id,cur.company_id,coalesce(p.lead->>'name','') as company,
      case when cur.phone<>'' then cur.phone else coalesce(p.lead->>'phone','') end as phone,
      dg_private.pflege_phone_key(case when cur.phone<>'' then cur.phone else coalesce(p.lead->>'phone','') end) as phone_norm,
      coalesce(nullif(p.lead->>'score','')::integer,0) as score,
      (p.lead - 'website') || jsonb_build_object(
        'website',case when dg_private.pflege_is_portal_url(p.lead->>'website') then '' else coalesce(p.lead->>'website','') end,
        'tier','1A','phone',case when cur.phone<>'' then cur.phone else coalesce(p.lead->>'phone','') end,
        'crm',jsonb_build_object('leadId',cur.lead_id,'doNotContact',false,'lastContactAt',null),
        'morningSource','recent_daily_buffer',
        'qualityGate','recent Pflege job evidence <= 7 days + ambulatory/intensive employer evidence + untouched CRM + unique employer + normalized phone',
        'bufferLeadDate',p.lead_date
      ) as payload
    from public.pflege_daily_leads p
    join lateral (
      select l.id as lead_id,c.id as company_id,coalesce(ct.phone,c.phone,'') as phone
      from public.sales_companies c join public.sales_leads l on l.company_id=c.id and l.workspace=c.workspace and l.status='active'
      left join public.sales_contacts ct on ct.id=l.contact_id
      where c.workspace='default' and lower(trim(c.name))=lower(trim(p.lead->>'name')) and l.stage in ('Neu','Research','Bereit')
        and l.last_contact_at is null and coalesce(l.do_not_contact,false)=false and coalesce(l.phone_status,'')<>'invalid'
      order by l.updated_at desc limit 1
    ) cur on true
    where p.lead_date between d-7 and d-1
      and p.lead->>'category' in ('ambulatory_care','intensive_care')
      and coalesce(p.lead->>'phone','')<>''
      and coalesce(nullif(p.lead->>'score','')::integer,0)>=78
      and jsonb_array_length(coalesce(p.lead->'jobReferences','[]'::jsonb))>=2
      and exists (
        select 1 from jsonb_array_elements(coalesce(p.lead->'jobReferences','[]'::jsonb)) jr
        where lower(coalesce(jr->>'title','')) ~ '(pflege|altenpfleg|krankenpflege|krankenschwester|pflegefach|pflegehilf|pflegeassist|pflegedienstleit|praxisanleit)'
      )
      and lower(coalesce(p.lead->>'name','')) !~ '(pflegeheim|altenheim|seniorenheim|seniorenzentrum|seniorenresidenz|senioren-?park|pflegezentrum|pflegewohn|wohnstift|wohnpark|tagespflege|hospiz|krankenhaus|klinikum|klinik|psychiatr|rehabilitation|reha-|universitätsmedizin|universitaetsmedizin|personalmanagement|personalberatung|personalvermittlung|personaldienst|zeitarbeit|recruiting agentur|recruiting|staffing|recrutio|trova|med-spezialisten|medical specialists|caritas|arbeiterwohlfahrt|johanniter|awo)'
      and (
        lower(coalesce(p.lead->>'name','')) ~ '(pflegedienst|ambulant|sozialstation|diakoniestation|häuslich|haeuslich|krankenpflege|intensivpflege|pflegeteam|pflege mobil|pflegemobil|home care|home health)'
        or exists (
          select 1 from jsonb_array_elements(coalesce(p.lead->'jobReferences','[]'::jsonb)) jr
          where lower(coalesce(jr->>'title','')) ~ '(ambulant|intensiv|außerklin|ausserklin|häuslich|haeuslich|1\s*:?\s*1)'
        )
        or (
          not dg_private.pflege_is_portal_url(p.lead->>'website')
          and lower(coalesce(p.lead->>'website','')) ~ '(pflege|care|sozialstation|diakonie|caritas|johanniter|malteser|drk|brk|awo|vitolus|cosmea|advita|essentis|aidera)'
        )
      )
  ), sales_candidates as (
    select 2 as source_priority,'crm_verified_hiring'::text as source,
      100000+row_number() over(order by l.priority_score desc,c.name)::integer as source_rank,
      'crm:'||l.id as lead_key,l.id as lead_id,c.id as company_id,c.name as company,coalesce(ct.phone,c.phone,'') as phone,
      dg_private.pflege_phone_key(coalesce(ct.phone,c.phone,'')) as phone_norm,l.priority_score as score,
      jsonb_build_object(
        'id',l.id,'name',c.name,'city',c.city,
        'website',case when dg_private.pflege_is_portal_url(c.website) then '' else c.website end,
        'phone',coalesce(ct.phone,c.phone,''),'email',coalesce(ct.email,''),'contactPerson',coalesce(ct.name,''),
        'category','verified_ambulatory_care','score',l.priority_score,'tier','1A',
        'pitch',case when coalesce(c.metadata->'pflege_daily'->>'pitch',l.notes,'')<>'' then coalesce(c.metadata->'pflege_daily'->>'pitch',l.notes,'') else 'Aktiver Pflege-Personalbedarf ist bestätigt. Bitte den hinterlegten Jobsignal-Kontext für den Gesprächseinstieg nutzen.' end,
        'signals',coalesce(c.metadata->'pflege_daily'->'signals',c.metadata->'daily_qualification'->'jobGrowth','{}'::jsonb),
        'jobReferences',coalesce(c.metadata->'pflege_daily'->'jobReferences','[]'::jsonb),
        'crm',jsonb_build_object('leadId',l.id,'doNotContact',false,'lastContactAt',null),
        'morningSource','crm_verified_hiring',
        'qualityGate','fresh current Pflege job signal + explicit ambulatory/intensive employer evidence + untouched CRM + unique employer + normalized phone'
      ) as payload
    from public.sales_leads l join public.sales_companies c on c.id=l.company_id and c.workspace=l.workspace
    left join public.sales_contacts ct on ct.id=l.contact_id
    where l.workspace='default' and l.status='active' and l.stage in ('Neu','Research','Bereit') and l.last_contact_at is null
      and coalesce(l.do_not_contact,false)=false and coalesce(l.phone_status,'')<>'invalid' and coalesce(ct.phone,c.phone,'')<>''
      and (
        lower(c.name) ~ '(pflegedienst|ambulant|sozialstation|diakoniestation|häuslich|haeuslich|krankenpflege|intensivpflege|pflegeteam|pflege mobil|pflegemobil|home care|home health)'
        or lower(coalesce(c.industry,'')) ~ '(ambulan|intensiv|home care|home health)'
      )
      and lower(c.name) !~ '(pflegeheim|altenheim|seniorenheim|seniorenzentrum|seniorenresidenz|senioren-?park|pflegezentrum|pflegewohn|wohnstift|wohnpark|tagespflege|hospiz|krankenhaus|klinikum|klinik|psychiatr|rehabilitation|reha-|universitätsmedizin|universitaetsmedizin|personalmanagement|personalberatung|personalvermittlung|personaldienst|zeitarbeit|recruiting agentur|recruiting|staffing|recrutio|trova|med-spezialisten|medical specialists|caritas|arbeiterwohlfahrt|johanniter|awo)'
      and greatest(
        coalesce((c.metadata->'daily_qualification'->'jobGrowth'->>'relevantOpenJobs')::integer,0),
        coalesce((c.metadata->'job_growth_seed'->>'relevantOpenJobs')::integer,0),
        coalesce((c.metadata->'pflege_daily'->'signals'->>'jobCount')::integer,0)
      )>=2
      and (
        coalesce(c.metadata->'pflege_daily'->>'date','')=d::text
        or coalesce(nullif(c.metadata->'daily_qualification'->>'checkedAt','')::timestamptz,'epoch'::timestamptz)>=now()-interval '7 days'
        or coalesce(nullif(c.metadata->'job_growth_seed'->>'checkedAt','')::timestamptz,'epoch'::timestamptz)>=now()-interval '7 days'
      )
      and l.priority_score>=78
  ), combined as (
    select * from daily_candidates
    union all select * from recent_daily_candidates
    union all select * from sales_candidates
  ), phone_dedup as (
    select *,row_number() over(partition by phone_norm order by source_priority,score desc,source_rank,company) as phone_rn
    from combined where phone_norm<>''
  ), company_dedup as (
    select *,row_number() over(partition by dg_private.pflege_employer_key(company) order by source_priority,score desc,source_rank) as company_rn
    from phone_dedup where phone_rn=1 and dg_private.pflege_employer_key(company)<>''
  ), ranked as (
    select *,row_number() over(order by source_priority,score desc,source_rank,company)::integer as final_rank
    from company_dedup where company_rn=1
  )
  insert into public.pflege_morning_queue(queue_date,rank,lead_key,source,lead_id,company_id,company,phone,phone_norm,score,payload)
  select d,final_rank,lead_key,source,lead_id,company_id,company,phone,phone_norm,score,payload
  from ranked where final_rank<=target_count order by final_rank;

  select count(*),
         count(*) filter(where source='daily_strict'),
         count(*) filter(where source='recent_daily_buffer'),
         count(*) filter(where source='crm_verified_hiring'),
         count(distinct dg_private.pflege_employer_key(company)),
         count(distinct phone_norm)
    into n,daily_n,recent_n,strong_n,unique_employers,unique_phones
  from public.pflege_morning_queue where queue_date=d;

  return jsonb_build_object(
    'date',d,'target',target_count,'ready',n,
    'unique_employers',unique_employers,'unique_phones',unique_phones,
    'status',case when n>=target_count and unique_employers>=target_count and unique_phones>=target_count then 'green' when n>=100 then 'yellow' else 'red' end,
    'daily_strict',daily_n,'recent_daily_buffer',recent_n,'crm_verified_hiring',strong_n
  );
end;
$function$;

CREATE OR REPLACE FUNCTION dg_private.fill_pflege_morning_queue_quality_fallback(target_count integer DEFAULT 120)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d date := (now() at time zone 'Asia/Bangkok')::date;
  existing_count integer := 0;
  max_rank integer := 0;
  added_count integer := 0;
  unique_employers integer := 0;
  unique_phones integer := 0;
begin
  target_count := greatest(1, least(target_count, 160));

  select count(*), coalesce(max(rank),0)
    into existing_count, max_rank
  from public.pflege_morning_queue
  where queue_date=d;

  if existing_count >= target_count then
    select count(distinct dg_private.pflege_employer_key(company)), count(distinct phone_norm)
      into unique_employers, unique_phones
    from public.pflege_morning_queue
    where queue_date=d;

    return jsonb_build_object(
      'date',d,'target',target_count,'ready',existing_count,'added',0,
      'unique_employers',unique_employers,'unique_phones',unique_phones,
      'status',case when unique_employers>=target_count and unique_phones>=target_count then 'green' else 'yellow' end
    );
  end if;

  with candidates as (
    select
      p.rank as source_rank,
      p.lead_key,
      p.lead,
      dg_private.pflege_phone_key(p.lead->>'phone') as phone_norm,
      dg_private.pflege_employer_key(p.lead->>'name') as employer_key,
      coalesce(nullif(p.lead->>'score','')::integer,0) as score
    from public.pflege_daily_leads p
    where p.lead_date=d
      and p.lead->>'category' in ('ambulatory_care','intensive_care')
      and coalesce(p.lead->>'phone','')<>''
      and coalesce(nullif(p.lead->>'score','')::integer,0)>=78
      and greatest(
        jsonb_array_length(coalesce(p.lead->'jobReferences','[]'::jsonb)),
        coalesce(nullif(p.lead->'signals'->>'jobCount','')::integer,0)
      )>=2
      and coalesce((p.lead->'crm'->>'doNotContact')::boolean,false)=false
      and coalesce(p.lead->'crm'->>'lastContactAt','')=''
      and lower(coalesce(p.lead->>'name','')) !~ '(pflegeheim|altenheim|seniorenheim|seniorenzentrum|seniorenresidenz|senioren-?park|pflegezentrum|pflegewohn|wohnstift|wohnpark|tagespflege|hospiz|krankenhaus|klinikum|klinik|psychiatr|rehabilitation|reha-|universitätsmedizin|universitaetsmedizin|personalmanagement|personalberatung|personalvermittlung|personaldienst|zeitarbeit|recruiting agentur|recruiting|staffing|recrutio|trova|med-spezialisten|medical specialists|caritas|arbeiterwohlfahrt|johanniter|awo)'
      and not exists (
        select 1
        from public.pflege_morning_queue q
        where q.queue_date=d
          and (
            q.phone_norm=dg_private.pflege_phone_key(p.lead->>'phone')
            or dg_private.pflege_employer_key(q.company)=dg_private.pflege_employer_key(p.lead->>'name')
          )
      )
  ), phone_dedup as (
    select *, row_number() over(partition by phone_norm order by score desc, source_rank, employer_key) as phone_rn
    from candidates
    where phone_norm<>'' and employer_key<>''
  ), employer_dedup as (
    select *, row_number() over(partition by employer_key order by score desc, source_rank, phone_norm) as employer_rn
    from phone_dedup
    where phone_rn=1
  ), ranked as (
    select *, row_number() over(order by score desc, source_rank, employer_key)::integer as rn
    from employer_dedup
    where employer_rn=1
  )
  insert into public.pflege_morning_queue(
    queue_date,rank,lead_key,source,lead_id,company_id,company,phone,phone_norm,score,payload
  )
  select
    d,
    max_rank+rn,
    'quality:'||lead_key,
    'daily_quality_fill',
    coalesce(lead->'crm'->>'leadId',lead->>'id',''),
    '',
    coalesce(lead->>'name',''),
    coalesce(lead->>'phone',''),
    phone_norm,
    score,
    (lead - 'website') || jsonb_build_object(
      'website',case when dg_private.pflege_is_portal_url(lead->>'website') then '' else coalesce(lead->>'website','') end,
      'tier','1A',
      'crm',coalesce(lead->'crm','{}'::jsonb) || jsonb_build_object(
        'stage','Bereit','nextAction','Anrufen','doNotContact',false,'lastContactAt',null
      ),
      'morningSource','daily_quality_fill',
      'qualityGate','current Pflege hiring evidence + ambulatory/intensive classifier + facility/staffing exclusions + untouched CRM + unique employer + normalized phone'
    )
  from ranked
  where rn<=target_count-existing_count
  order by rn;

  get diagnostics added_count=row_count;
  existing_count := existing_count + added_count;

  select count(distinct dg_private.pflege_employer_key(company)), count(distinct phone_norm)
    into unique_employers, unique_phones
  from public.pflege_morning_queue
  where queue_date=d;

  return jsonb_build_object(
    'date',d,'target',target_count,'ready',existing_count,'added',added_count,
    'unique_employers',unique_employers,'unique_phones',unique_phones,
    'status',case when existing_count>=target_count and unique_employers>=target_count and unique_phones>=target_count then 'green' when existing_count>=100 then 'yellow' else 'red' end
  );
end;
$function$;
