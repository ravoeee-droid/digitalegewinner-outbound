import { query } from "@/lib/db";
import { cleanPersonName } from "@/lib/outreach-copy";

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
    where l.workspace='default' and l.status='active'`;

  try {
    const [counts] = await query<{ total: number; with_email: number; ready: number; contacted: number }>(`
      select count(*)::int total,
        count(*) filter(where coalesce(ct.email,'')<>'')::int with_email,
        count(*) filter(where ${FILTERS.bereit})::int ready,
        count(*) filter(where ${FILTERS.angeschrieben})::int contacted
      ${from}`);

    const params: unknown[] = [];
    let search = "";
    if (q) { params.push(`%${q}%`); search = ` and (c.name ilike $1 or c.city ilike $1 or ct.email ilike $1 or ct.name ilike $1)`; }
    const [{ n: total } = { n: 0 }] = await query<{ n: number }>(`select count(*)::int n ${from} and ${FILTERS[filter]}${search}`, params);

    const rows = await query<{ id: string; company: string; city: string; website: string; contact: string; email: string; phone: string; stage: string; score: number; mail_status: string | null; last_sent: string | null; do_not_contact: boolean }>(`
      select l.id, c.name company, c.city, coalesce(nullif(c.website,''),c.domain) website, coalesce(ct.name,'') contact, coalesce(ct.email,'') email, c.phone,
        l.stage, coalesce(l.priority_score,0)::int score, o.status mail_status, o.sent_at::text last_sent, l.do_not_contact
      ${from} and ${FILTERS[filter]}${search}
      order by l.priority_score desc nulls last, c.name
      limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`, params);

    return Response.json({
      counts, filter, q, page, pageSize: PAGE_SIZE, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      rows: rows.map((row) => ({ ...row, contact: cleanPersonName(row.contact) })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Leads konnten nicht geladen werden." }, { status: 503 });
  }
}
