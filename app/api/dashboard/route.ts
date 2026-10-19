import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = "(%s at time zone 'Europe/Berlin')::date";
const today = "(now() at time zone 'Europe/Berlin')::date";

export async function GET(request: Request) {
  const days = Math.min(90, Math.max(7, Number(new URL(request.url).searchParams.get("days")) || 14));
  try {
    const daily = await query<{ day: string; sent: number; opened: number; replied: number; positive: number; meetings: number; bounces: number; unsubscribed: number }>(`
      with days as (select generate_series(${today}-${days - 1}, ${today}, interval '1 day')::date as day),
      sent as (select lead_id, ${DAY.replace("%s", "sent_at")} as day from er_outbox where workspace='default' and status='sent' and sent_at>=now()-interval '${days + 2} days'),
      ev as (select lead_id, type, meta, ${DAY.replace("%s", "created_at")} as day from er_events where workspace='default' and created_at>=now()-interval '${days + 2} days')
      select d.day::text,
        (select count(*)::int from sent s where s.day=d.day) sent,
        (select count(distinct lead_id)::int from ev where day=d.day and type='email_open') opened,
        (select count(distinct lead_id)::int from ev where day=d.day and type in ('reply','positive_reply')) replied,
        (select count(distinct lead_id)::int from ev where day=d.day and type='positive_reply') positive,
        (select count(distinct lead_id)::int from ev where day=d.day and type in ('appointment','appointment_attended')) meetings,
        (select count(*)::int from ev where day=d.day and type='bounce') bounces,
        (select count(*)::int from ev where day=d.day and type='unsubscribed') unsubscribed
      from days d order by d.day`);

    const mailboxes = await query<{ mailbox_id: string; sent_today: number; sent_period: number; failed_period: number; queued: number }>(`
      select coalesce(mailbox_id,'—') mailbox_id,
        count(*) filter(where status='sent' and ${DAY.replace("%s", "sent_at")}=${today})::int sent_today,
        count(*) filter(where status='sent' and sent_at>=now()-interval '${days} days')::int sent_period,
        count(*) filter(where status='failed' and created_at>=now()-interval '${days} days')::int failed_period,
        count(*) filter(where status='queued')::int queued
      from er_outbox where workspace='default' group by 1 order by sent_today desc, sent_period desc limit 30`);

    const [queue] = await query<{ queued: number; due: number; next_at: string | null; failed_open: number }>(`
      select count(*) filter(where status='queued')::int queued,
        count(*) filter(where status='queued' and scheduled_at<=now())::int due,
        min(scheduled_at) filter(where status='queued')::text next_at,
        count(*) filter(where status='failed' and created_at>=now()-interval '3 days')::int failed_open
      from er_outbox where workspace='default'`);

    const steps = await query<{ step: number; sent: number; replied: number }>(`
      with s as (
        select o.lead_id, row_number() over (partition by o.lead_id order by o.sent_at) step
        from er_outbox o where o.workspace='default' and o.status='sent' and o.sent_at>=now()-interval '${days} days'
      )
      select step::int, count(*)::int sent,
        (select count(distinct e.lead_id)::int from er_events e where e.workspace='default' and e.type in ('reply','positive_reply') and e.lead_id in (select lead_id from s s2 where s2.step=s.step)) replied
      from s group by step order by step limit 3`);

    const recent = await query<{ lead_id: string; type: string; company: string | null; at: string }>(`
      select e.lead_id, e.type, c.name company, e.created_at::text "at"
      from er_events e
      left join sales_leads l on l.id::text=e.lead_id
      left join sales_companies c on c.id=l.company_id
      where e.workspace='default' and e.type in ('appointment','appointment_attended','positive_reply','reply')
      order by e.created_at desc limit 12`).catch(() => []);

    return Response.json({
      days, daily, mailboxes, queue, steps, recent,
      goalPerDay: Number(process.env.APPOINTMENT_GOAL_PER_DAY) || 4,
      dailyTarget: Number(process.env.PFLEGE_CAMPAIGN_DAILY_TARGET) || 300,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Dashboard konnte nicht geladen werden." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
