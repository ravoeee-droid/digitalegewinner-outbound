import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Segment = "pflege" | "pv";
const CAMPAIGNS = ["pflege-loom-150-v1","pv-loom-150-v1"];

// Count UNIQUE recipient leads, never raw page-load events. Exclude scanner
// events from the funnel and score only actions on the personalized video page.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const segment = url.searchParams.get("segment");
  if (segment !== "all" && segment !== "pflege" && segment !== "pv") {
    return Response.json({error:"Invalid segment"},{status:400});
  }
  try {
    const selected = segment === "all" ? CAMPAIGNS : [segment === "pv" ? CAMPAIGNS[1] : CAMPAIGNS[0]];
    const sent = await query<{segment:Segment;sent_today:number;sent7:number;queued:number;failed:number;next_at:string|null;opened:number;clicked:number;page_viewed:number;started:number;quarter:number;half:number;three_quarters:number;completed:number;booking:number;replied:number;meetings:number}>(`
      with campaigns as (
        select unnest($1::text[]) as campaign_id
      ), groupings as (
        select c.campaign_id,case when c.campaign_id='pv-loom-150-v1' then 'pv' else 'pflege' end as segment
        from campaigns c
      ), cohort as (
        select o.lead_id,o.campaign_id,g.segment,
          bool_or(o.status='sent') sent_any,
          min(o.sent_at) filter(where o.status='sent') first_sent_at,
          bool_or(o.status='sent' and (o.sent_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date) sent_today,
          bool_or(o.status='sent' and o.sent_at>=now()-interval '7 days') sent7,
          bool_or(o.status='queued') queued,
          bool_or(o.status='failed') failed,
          min(o.scheduled_at) filter(where o.status='queued') next_at
        from er_outbox o join groupings g on g.campaign_id=o.campaign_id
        where o.workspace='default'
        group by 1,2,3
      ), events as (
        select c.lead_id,c.segment,
          bool_or(e.type='email_open' and coalesce((e.meta->>'bot')::boolean,false)=false) opened,
          bool_or(e.type='email_click' and coalesce((e.meta->>'bot')::boolean,false)=false) clicked,
          bool_or(e.type='video_view' and coalesce((e.meta->>'bot')::boolean,false)=false) page_viewed,
          bool_or(e.type='video_play' and coalesce((e.meta->>'bot')::boolean,false)=false) started,
          bool_or(e.type='video_progress' and coalesce((e.meta->>'bot')::boolean,false)=false and coalesce((e.meta->>'v')::int,0)>=25) quarter,
          bool_or(e.type='video_progress' and coalesce((e.meta->>'bot')::boolean,false)=false and coalesce((e.meta->>'v')::int,0)>=50) half,
          bool_or(e.type='video_progress' and coalesce((e.meta->>'bot')::boolean,false)=false and coalesce((e.meta->>'v')::int,0)>=75) three_quarters,
          bool_or(e.type in ('video_watch') and coalesce((e.meta->>'bot')::boolean,false)=false) completed,
          bool_or(e.type in ('video_booking_click','video_calendar_focus','video_whatsapp_click') and coalesce((e.meta->>'bot')::boolean,false)=false) booking,
          bool_or(e.type in ('reply','positive_reply')) replied,
          bool_or(e.type in ('appointment','appointment_attended')) meetings
        from cohort c left join er_events e on e.workspace='default' and e.lead_id=c.lead_id and c.first_sent_at is not null and e.created_at>=c.first_sent_at
        group by c.lead_id,c.segment
      )
      select c.segment,
        count(*) filter(where c.sent_today)::int sent_today,
        count(*) filter(where c.sent7)::int sent7,
        count(*) filter(where c.queued)::int queued,
        count(*) filter(where c.failed)::int failed,
        min(c.next_at)::text next_at,
        count(*) filter(where c.sent_any and e.opened)::int opened,
        count(*) filter(where c.sent_any and e.clicked)::int clicked,
        count(*) filter(where c.sent_any and e.page_viewed)::int page_viewed,
        count(*) filter(where c.sent_any and e.started)::int started,
        count(*) filter(where c.sent_any and e.quarter)::int quarter,
        count(*) filter(where c.sent_any and e.half)::int half,
        count(*) filter(where c.sent_any and e.three_quarters)::int three_quarters,
        count(*) filter(where c.sent_any and e.completed)::int completed,
        count(*) filter(where c.sent_any and e.booking)::int booking,
        count(*) filter(where c.sent_any and e.replied)::int replied,
        count(*) filter(where c.sent_any and e.meetings)::int meetings
      from cohort c left join events e on e.lead_id=c.lead_id and e.segment=c.segment
       where not exists(select 1 from outbound_tracking_exclusions x where x.workspace='default' and x.lead_id=c.lead_id)
      group by c.segment order by c.segment
    `,[selected]);

    const hot = await query<{lead_id:string;segment:Segment;company:string;city:string|null;phone:string|null;score:number;plays:number;progress:number;booking:boolean;replied:boolean;last_signal:string}>(`
      with sent_cohort as (
        select o.lead_id,case when o.campaign_id='pv-loom-150-v1' then 'pv' else 'pflege' end segment,min(o.sent_at) first_sent_at
        from er_outbox o where o.workspace='default' and o.campaign_id=any($1::text[]) and o.status='sent'
        and not exists(select 1 from outbound_tracking_exclusions x where x.workspace='default' and x.lead_id=o.lead_id)
        group by o.lead_id,case when o.campaign_id='pv-loom-150-v1' then 'pv' else 'pflege' end
      ), signals as (
        select s.lead_id,s.segment,
          count(*) filter(where e.type='video_play' and coalesce((e.meta->>'bot')::boolean,false)=false)::int plays,
          max(coalesce((e.meta->>'v')::int,0)) filter(where e.type='video_progress' and coalesce((e.meta->>'bot')::boolean,false)=false)::int progress,
          bool_or(e.type in ('video_booking_click','video_calendar_focus','video_whatsapp_click') and coalesce((e.meta->>'bot')::boolean,false)=false) booking,
          bool_or(e.type in ('reply','positive_reply')) replied,
          bool_or(e.type='positive_reply') positive,
          bool_or(e.type in ('appointment','appointment_attended')) meeting,
          bool_or(e.type='video_view' and coalesce((e.meta->>'bot')::boolean,false)=false) viewed,
          bool_or(e.type='email_click' and coalesce((e.meta->>'bot')::boolean,false)=false) clicked,
          max(e.created_at) filter(where e.type in ('video_play','video_progress','video_booking_click','video_calendar_focus','video_whatsapp_click','reply','positive_reply'))::text last_signal
        from sent_cohort s
        left join er_events e on e.workspace='default' and e.lead_id=s.lead_id and e.created_at>=s.first_sent_at and e.created_at>=now()-interval '30 days'
        group by s.lead_id,s.segment
      )
      select sig.lead_id,sig.segment,coalesce(c.name,'Unbekannter Betrieb') company,c.city,c.phone,
        (case when sig.positive then 80 when sig.replied then 45 else 0 end
         +case when sig.booking then 65 else 0 end
         +case when sig.meeting then 85 else 0 end
         +case when coalesce(sig.progress,0)>=75 then 35 when coalesce(sig.progress,0)>=50 then 25 when coalesce(sig.progress,0)>=25 then 12 else 0 end
         +case when sig.plays>0 then 20 else 0 end
         +case when sig.clicked then 5 else 0 end)::int score,
        sig.plays,coalesce(sig.progress,0)::int progress,sig.booking,sig.replied,
        coalesce(sig.last_signal,'') last_signal
      from signals sig
      join sales_leads l on l.id::text=sig.lead_id and l.workspace='default' and not l.do_not_contact
      join sales_companies c on c.id=l.company_id and c.workspace='default'
      where (sig.plays>0 or sig.booking or sig.replied or sig.meeting)
        and l.stage not in ('Gewonnen','Verloren')
        and not exists(select 1 from er_suppressions sp where sp.workspace='default' and exists(
           select 1 from er_outbox o2 where o2.lead_id=sig.lead_id and lower(o2.recipient)=lower(sp.email)))
      order by score desc,sig.last_signal desc nulls last
      limit 20
    `,[selected]);

    const totals = sent.reduce((sum,row)=>({
      sent_today:sum.sent_today+row.sent_today,sent7:sum.sent7+row.sent7,queued:sum.queued+row.queued,
      failed:sum.failed+row.failed,opened:sum.opened+row.opened,clicked:sum.clicked+row.clicked,
      page_viewed:sum.page_viewed+row.page_viewed,started:sum.started+row.started,quarter:sum.quarter+row.quarter,
      half:sum.half+row.half,three_quarters:sum.three_quarters+row.three_quarters,
      completed:sum.completed+row.completed,booking:sum.booking+row.booking,replied:sum.replied+row.replied,
      meetings:sum.meetings+row.meetings
    }),{sent_today:0,sent7:0,queued:0,failed:0,opened:0,clicked:0,page_viewed:0,started:0,quarter:0,half:0,three_quarters:0,completed:0,booking:0,replied:0,meetings:0});
    return Response.json({segment,goal:segment==='all'?300:150,totals,segments:sent,hot,as_of:new Date().toISOString()}, {headers:{"cache-control":"no-store"}});
  } catch(error) {
    console.error("[outbound-cockpit]",error);
    return Response.json({error:"Performance-Cockpit konnte nicht geladen werden."},{status:503,headers:{"cache-control":"no-store"}});
  }
}
