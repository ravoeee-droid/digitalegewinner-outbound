import { query } from "@/lib/db";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type EmailAnalytics={
  sent_messages:number;sent_leads:number;opened_leads:number;clicked_leads:number;replied_leads:number;positive_leads:number;meetings:number;bounces:number;
  sent_today:number;opened_today:number;clicked_today:number;replied_today:number;meetings_today:number;
};
type Daily={day:string;sent:number;opened:number;clicked:number;replied:number;meetings:number};
type LeadPool={companies:number;leads:number;email_contacts:number;outreach_emails:number;a_plus:number;ready:number;recheck_due:number;new_today:number};

export async function GET(){
  try{
    const [emailAnalytics]=await query<EmailAnalytics>(`
      with sent as (
        select id,lead_id,sent_at from er_outbox where workspace='default' and status='sent'
      ), events as (
        select lead_id,type,meta,created_at from er_events where workspace='default'
      )
      select
        (select count(*)::int from sent) sent_messages,
        (select count(distinct lead_id)::int from sent) sent_leads,
        (select count(distinct lead_id)::int from events where type='email_open') opened_leads,
        (select count(distinct lead_id)::int from events where type='email_click') clicked_leads,
        (select count(distinct lead_id)::int from events where type in ('reply','positive_reply')) replied_leads,
        (select count(distinct lead_id)::int from events where type='positive_reply') positive_leads,
        (select count(distinct lead_id)::int from events where type in ('appointment','appointment_attended')) meetings,
        (select count(*)::int from events where type='bounce' and coalesce(meta->>'outboxId','')<>'') bounces,
        (select count(*)::int from sent where (sent_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date) sent_today,
        (select count(distinct lead_id)::int from events where type='email_open' and (created_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date) opened_today,
        (select count(distinct lead_id)::int from events where type='email_click' and (created_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date) clicked_today,
        (select count(distinct lead_id)::int from events where type in ('reply','positive_reply') and (created_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date) replied_today,
        (select count(distinct lead_id)::int from events where type in ('appointment','appointment_attended') and (created_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date) meetings_today
    `);

    const daily=await query<Daily>(`
      with days as (
        select generate_series((now() at time zone 'Europe/Berlin')::date-13,(now() at time zone 'Europe/Berlin')::date,interval '1 day')::date as day
      ), sent as (
        select lead_id,(sent_at at time zone 'Europe/Berlin')::date as day
        from er_outbox where workspace='default' and status='sent' and sent_at>=now()-interval '15 days'
      ), ev as (
        select lead_id,type,(created_at at time zone 'Europe/Berlin')::date as day
        from er_events where workspace='default' and created_at>=now()-interval '15 days'
      )
      select d.day::text,
        (select count(*)::int from sent s where s.day=d.day) sent,
        (select count(distinct lead_id)::int from ev where day=d.day and type='email_open') opened,
        (select count(distinct lead_id)::int from ev where day=d.day and type='email_click') clicked,
        (select count(distinct lead_id)::int from ev where day=d.day and type in ('reply','positive_reply')) replied,
        (select count(distinct lead_id)::int from ev where day=d.day and type in ('appointment','appointment_attended')) meetings
      from days d order by d.day
    `);

    let leadPool:LeadPool={companies:0,leads:0,email_contacts:0,outreach_emails:0,a_plus:0,ready:0,recheck_due:0,new_today:0};
    try{
      const [pool]=await query<LeadPool>(`
        with pflege_companies as (
          select id,metadata,created_at from sales_companies
          where workspace='default' and (
            coalesce(metadata->>'pflege_icp_verified','false')='true'
            or source like 'pflege%'
            or lower(coalesce(industry,'')) like '%pflege%'
          )
        )
        select
          count(distinct c.id)::int companies,
          count(distinct l.id)::int leads,
          count(distinct lower(ct.email)) filter(where coalesce(ct.email,'')<>'')::int email_contacts,
          (select count(distinct lower(email))::int from pflege_email_outreach where status in ('draft','approved','sent','replied') and coalesce(email,'')<>'') outreach_emails,
          count(distinct l.id) filter(where c.metadata->'daily_qualification'->>'tier'='A+')::int a_plus,
          count(distinct l.id) filter(where l.stage in ('Neu','Research','Bereit') and coalesce(ct.email,'')<>'' and not l.do_not_contact)::int ready,
          count(distinct l.id) filter(where c.metadata->'daily_qualification' is null or coalesce(c.metadata->'daily_qualification'->>'checkedAt','')='' or (c.metadata->'daily_qualification'->>'checkedAt')::timestamptz<now()-interval '7 days')::int recheck_due,
          count(distinct c.id) filter(where c.created_at>=date_trunc('day',now()))::int new_today
        from pflege_companies c
        join sales_leads l on l.company_id=c.id and l.workspace='default' and l.status='active'
        left join sales_contacts ct on ct.company_id=c.id and ct.workspace='default'
      `);
      if(pool)leadPool=pool;
    }catch{}

    return Response.json({
      emailAnalytics:{...(emailAnalytics||{sent_messages:0,sent_leads:0,opened_leads:0,clicked_leads:0,replied_leads:0,positive_leads:0,meetings:0,bounces:0,sent_today:0,opened_today:0,clicked_today:0,replied_today:0,meetings_today:0}),daily},
      leadPool,
    },{headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Analytics konnten nicht geladen werden."},{status:503,headers:{"cache-control":"no-store"}});
  }
}
