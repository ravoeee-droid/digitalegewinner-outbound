import { query } from "@/lib/db";
import { cleanPersonName } from "@/lib/outreach-copy";
import { videoToken } from "@/lib/email-tracking";
import { ensureScreenshotTable } from "@/lib/lead-screenshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const FILTERS: Record<string, string> = {
  alle: "true",
  email: "coalesce(ct.email,'')<>''",
  bereit: "coalesce(ct.email,'')<>'' and not l.do_not_contact and l.stage in ('Neu','Research','Bereit') and o.status is null",
  angeschrieben: "o.status in ('sent','stopped')",
  ohne_email: "coalesce(ct.email,'')=''",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filter = FILTERS[url.searchParams.get("filter") || ""] ? String(url.searchParams.get("filter")) : "alle";
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 80);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const segment = url.searchParams.get("segment");
  const segmentSql = segment === "pv" ? " and c.source='ba-pv'" : segment === "pflege" ? " and c.source<>'ba-pv'" : "";

  const from = `
    from sales_leads l
    join sales_companies c on c.id=l.company_id
    left join lateral (
      select name,email from sales_contacts k where k.company_id=c.id and k.workspace=l.workspace
      order by (coalesce(k.email,'')<>'') desc, k.is_primary desc, k.created_at limit 1
    ) ct on true
    left join lateral (
      select status,sent_at from er_outbox x where x.workspace=l.workspace and x.lead_id=l.id order by x.created_at desc limit 1
    ) o on true
    where l.workspace='default' and l.status='active'${segmentSql}`;

  try {
    const [counts] = await query<{ total: number; with_email: number; ready: number; contacted: number }>(`
      select count(*)::int total,
        count(*) filter(where coalesce(ct.email,'')<>'')::int with_email,
        count(*) filter(where ${FILTERS.bereit})::int ready,
        count(*) filter(where ${FILTERS.angeschrieben})::int contacted
      ${from}`);

    await ensureScreenshotTable();
    const params: unknown[] = [];
    let search = "";
    if (q) { params.push(`%${q}%`); search = ` and (c.name ilike $1 or c.city ilike $1 or ct.email ilike $1 or ct.name ilike $1)`; }
    const [{ n: total } = { n: 0 }] = await query<{ n: number }>(`select count(*)::int n ${from} and ${FILTERS[filter]}${search}`, params);

    const rows = await query<{ id: string; company: string; city: string; website: string; contact: string; email: string; phone: string; stage: string; score: number; mail_status: string | null; last_sent: string | null; do_not_contact: boolean; shot: boolean | null; views: number; plays: number; progress: number; watch: number; dwell: number; calendar: number }>(`
      select l.id, c.name company, c.city, coalesce(nullif(c.website,''),c.domain) website, coalesce(ct.name,'') contact, coalesce(ct.email,'') email, c.phone,
        l.stage, coalesce(l.priority_score,0)::int score, o.status mail_status, o.sent_at::text last_sent, l.do_not_contact,
        (s.status='ok') shot, coalesce(ev.views,0)::int views, coalesce(ev.plays,0)::int plays, coalesce(ev.progress,0)::int progress,
        coalesce(ev.watch,0)::int watch, coalesce(ev.dwell,0)::int dwell, coalesce(ev.calendar,0)::int calendar
      ${from.replace("where l.workspace", `left join lead_screenshots s on s.lead_id=l.id::text
    left join lateral (
      select count(*) filter(where type='video_view') views, count(*) filter(where type='video_play') plays,
        max(case when type='video_progress' then (meta->>'v')::int end) progress, max(case when type='video_watch' then (meta->>'v')::int end) watch,
        max(case when type='video_dwell' then (meta->>'v')::int end) dwell, count(*) filter(where type in ('video_booking_click','video_calendar_focus')) calendar
      from er_events e where e.workspace=l.workspace and e.lead_id=l.id::text and e.type like 'video\\_%' and coalesce(e.meta->>'bot','false')='false'
    ) ev on true
    where l.workspace`)} and ${FILTERS[filter]}${search}
      order by l.priority_score desc nulls last, c.name
      limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`, params);

    return Response.json({
      counts, filter, q, page, pageSize: PAGE_SIZE, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      rows: rows.map((row) => ({ ...row, contact: cleanPersonName(row.contact), video_token: row.shot ? videoToken(String(row.id)) : "" })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Leads konnten nicht geladen werden." }, { status: 503 });
  }
}
