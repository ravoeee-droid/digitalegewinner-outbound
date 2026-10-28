import { query, readStateFields } from "@/lib/db";
import { dbExpiry } from "@/lib/db-expiry";

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

    const campaigns = await query<{ id: string; sent_today: number; sent7: number; queued: number; leads: number; replies: number }>(`
      select o.campaign_id id,
        count(*) filter(where o.status='sent' and (o.sent_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date)::int sent_today,
        count(*) filter(where o.status='sent' and o.sent_at>=now()-interval '7 days')::int sent7,
        count(*) filter(where o.status='queued')::int queued,
        count(distinct o.lead_id)::int leads,
        (select count(distinct e.lead_id)::int from er_events e where e.workspace='default' and e.type in ('reply','positive_reply') and e.lead_id in (select lead_id from er_outbox x where x.campaign_id=o.campaign_id))::int replies
      from er_outbox o where o.workspace='default' and o.campaign_id in ('pflege-loom-150-v1','pv-loom-150-v1') group by o.campaign_id`).catch(() => []);
    const variants = await query<{ campaign_id: string; variant: string; leads: number; replies: number }>(`
      select o.campaign_id, o.variant, count(distinct o.lead_id)::int leads,
        count(distinct o.lead_id) filter(where exists(select 1 from er_events e where e.workspace='default' and e.lead_id=o.lead_id and e.type in ('reply','positive_reply')))::int replies
      from er_outbox o where o.workspace='default' and o.campaign_id in ('pflege-loom-150-v1','pv-loom-150-v1') and o.status='sent' group by 1,2 order by 1,2`).catch(() => []);
    const video = await query<{ type: string; leads: number }>(`
      select type, count(distinct lead_id)::int leads from er_events
      where workspace='default' and (type like 'video\\_%' or type='site_view') and coalesce(meta->>'bot','false')='false'
        and (type<>'video_progress' or coalesce((meta->>'v')::int,0)>=50)
      group by type`).catch(() => []);
    const checks = await buildChecks(queue);
    const source = await query<{ status: string; reason: string; n: number; started: string }>(`
      select j.status, coalesce(nullif(j.error,''),'') reason, count(*)::int n, max(r.started_at)::text started
      from pflege_source_jobs j join pflege_source_sync_runs r on r.id=j.run_id
      where j.run_id=(select id from pflege_source_sync_runs order by started_at desc limit 1)
      group by 1,2 order by n desc`).catch(() => []);

    return Response.json({
      days, daily, mailboxes, queue, steps, recent, checks, source, campaigns, variants, video, dbExpiry: dbExpiry(),
      goalPerDay: Number(process.env.APPOINTMENT_GOAL_PER_DAY) || 4,
      dailyTarget: Number(process.env.PFLEGE_CAMPAIGN_DAILY_TARGET) || 300,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Dashboard konnte nicht geladen werden." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

type Check = { id: string; label: string; status: "ok" | "warn" | "fail"; detail: string; href: string };

// Start-Checkliste: prüft live, ob alles für den automatischen Versand bereit ist.
async function buildChecks(queue: { queued: number } | undefined): Promise<Check[]> {
  const checks: Check[] = [];
  let state: { mailboxes?: Array<{ enabled?: boolean }>; campaigns?: Array<{ status?: string; dailyLimit?: number }> } = {};
  try { state = ((await readStateFields(["mailboxes", "campaigns"])).payload || {}) as typeof state; } catch {}

  const boxes = (state.mailboxes || []).filter((box) => box.enabled !== false).length;
  checks.push({ id: "postfaecher", label: "Postfächer verbunden", status: boxes >= 10 ? "ok" : boxes > 0 ? "warn" : "fail", detail: boxes >= 10 ? `${boxes} aktiv` : boxes > 0 ? `${boxes} von 10 aktiv` : "Noch kein Postfach aktiv", href: "/mail" });

  let leads = 0;
  try {
    const [row] = await query<{ n: number }>(`select count(distinct l.id)::int n from sales_leads l join sales_contacts ct on ct.company_id=l.company_id and ct.workspace=l.workspace where l.workspace='default' and l.status='active' and l.stage in ('Neu','Research','Bereit') and coalesce(ct.email,'')<>'' and not l.do_not_contact`);
    leads = row?.n || 0;
  } catch {}
  checks.push({ id: "leads", label: "Leads mit E-Mail-Adresse", status: leads >= 300 ? "ok" : leads > 0 ? "warn" : "fail", detail: leads >= 300 ? `${leads} bereit` : leads > 0 ? `${leads} bereit, 300 pro Tag nötig` : "Keine Leads bereit. Im Menü unter Leads nachfüllen.", href: "/pflege?view=finder" });

  // Die Kampagnen laufen über die Versand-Warteschlange (Pflege + PV, je 150 pro Tag); aktiv = hat Mails wartend oder in den letzten 2 Tagen gesendet.
  let activeCampaigns = 0;
  try {
    const [row] = await query<{ n: number }>("select count(distinct campaign_id)::int n from er_outbox where workspace='default' and campaign_id is not null and (status='queued' or (status='sent' and sent_at>now()-interval '2 days'))");
    activeCampaigns = row?.n || 0;
  } catch {}
  const limit = activeCampaigns * 150;
  checks.push({ id: "kampagne", label: "Kampagne aktiv", status: activeCampaigns === 0 ? "fail" : limit >= 300 ? "ok" : "warn", detail: activeCampaigns === 0 ? "Keine aktive Kampagne" : `${activeCampaigns} Kampagnen, bis zu ${limit} Mails pro Tag`, href: "/pflege?view=campaigns" });

  const queued = queue?.queued ?? 0;
  checks.push({ id: "warteschlange", label: "Mails in der Warteschlange", status: queued > 0 ? "ok" : "warn", detail: queued > 0 ? `${queued} warten auf Versand` : "Leer. Wird nachts oder zum nächsten Termin-Lauf gefüllt.", href: "/outreach" });

  try {
    const [last] = await query<{ at: string | null }>("select max(sent_at)::text at from er_outbox where workspace='default' and status='sent'");
    const hours = last?.at ? (Date.now() - new Date(last.at).getTime()) / 3600000 : null;
    checks.push({ id: "versand", label: "Versand läuft", status: hours === null ? "warn" : hours < 72 ? "ok" : "warn", detail: hours === null ? "Noch nichts gesendet" : hours < 1 ? "Vor weniger als einer Stunde gesendet" : `Zuletzt vor ${Math.round(hours)} Stunden gesendet`, href: "/mail" });
  } catch {}

  const telegram = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  checks.push({ id: "telegram", label: "Telegram-Meldungen", status: telegram ? "ok" : "warn", detail: telegram ? "Bot und Chat hinterlegt" : "Bot oder Chat fehlt in Vercel", href: "/pflege?view=system" });
  return checks;
}
