// Hintergrund-Agent: sucht per Websuche (Serper, Google-Ergebnisse), ob ein Betrieb auf Jobportalen und der eigenen Seite aktiv Personal sucht.
import { query } from "@/lib/db";

const PORTALS: Array<[RegExp, string]> = [
  [/indeed\./i, "Indeed"], [/stepstone\./i, "StepStone"], [/kimeta\./i, "Kimeta"], [/jobware\./i, "Jobware"], [/meinestadt\./i, "meinestadt.de"],
  [/linkedin\./i, "LinkedIn"], [/xing\./i, "XING"], [/arbeitsagentur\./i, "Arbeitsagentur"], [/jooble\./i, "Jooble"], [/medi-?jobs?\./i, "Medi-Jobs"],
  [/pflegejobs?\./i, "Pflegejobs"], [/ebay-kleinanzeigen|kleinanzeigen\./i, "Kleinanzeigen"], [/stellenanzeigen\./i, "Stellenanzeigen.de"], [/jobrapido\./i, "Jobrapido"],
  [/gesundheitsberufe|get-in-pflege|pflegestellen/i, "Pflege-Portal"],
];

const normName = (value: string) => value.toLowerCase().replace(/\b(gmbh|ggmbh|ug|mbh|e\.?\s?v\.?|kg|ohg|co\.?|und|&)\b/g, " ").replace(/[^a-zäöüß0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export async function searchJobsFor(company: string, city: string, segment: "pflege" | "pv") {
  const key = process.env.SERPER_API_KEY;
  if (!key) return null;
  const role = segment === "pv" ? "Elektriker Monteur Photovoltaik Stellenangebot" : "Pflegefachkraft Stellenangebot";
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "content-type": "application/json" },
    body: JSON.stringify({ q: `"${company}" ${city} ${role}`.trim(), gl: "de", hl: "de", num: 10 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { organic?: { title?: string; snippet?: string; link?: string }[] };
  const name = normName(company);
  const first = name.split(" ").slice(0, 2).join(" ");
  const portals = new Set<string>();
  let own = false, hits = 0;
  for (const item of data.organic || []) {
    const haystack = normName(`${item.title || ""} ${item.snippet || ""}`);
    if (!first || !haystack.includes(first)) continue; // Treffer muss den Betrieb nennen
    if (!/(stelle|job|karriere|bewerb|m\/w\/d|w\/m\/d|suchen|gesucht)/i.test(`${item.title} ${item.snippet} ${item.link}`)) continue;
    hits++;
    const portal = PORTALS.find(([pattern]) => pattern.test(item.link || ""));
    if (portal) portals.add(portal[1]); else own = true;
  }
  return { hits, portals: [...portals], own_site: own };
}

export async function enrichJobSearchOnce({ limit = 20, budgetMs = 20_000 }: { limit?: number; budgetMs?: number } = {}) {
  if (!process.env.SERPER_API_KEY) return { jobsearchChecked: 0, jobsearchActive: 0 };
  const startedAt = Date.now();
  let checked = 0, active = 0;
  const rows = await query<{ id: string; name: string; city: string; source: string }>(
    `select c.id, c.name, coalesce(c.city,'') city, coalesce(c.source,'') source
     from sales_companies c join sales_leads l on l.company_id=c.id and l.workspace=c.workspace
     where c.workspace='default' and l.status='active' and c.metadata->>'jobsearch_at' is null
     order by exists(select 1 from er_outbox o where o.workspace='default' and o.lead_id=l.id::text and o.status not in ('failed','suppressed')) asc, l.priority_score desc nulls last
     limit $1`,
    [limit],
  ).catch(() => []);
  for (const row of rows) {
    if (Date.now() - startedAt > budgetMs) break;
    checked++;
    const result = await searchJobsFor(row.name, row.city, row.source === "ba-pv" ? "pv" : "pflege").catch(() => null);
    if (result === null) continue; // Fehler: beim nächsten Lauf erneut
    await query("update sales_companies set metadata=coalesce(metadata,'{}'::jsonb)||$2::jsonb where id=$1", [row.id, JSON.stringify({ jobsearch_at: new Date().toISOString(), jobsearch: result })]).catch(() => undefined);
    if (result.hits) active++;
  }
  return { jobsearchChecked: checked, jobsearchActive: active };
}
