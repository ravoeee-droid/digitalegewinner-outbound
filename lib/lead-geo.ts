// Hintergrund-Agent: ordnet jedem Lead Bundesland und Landkreis zu (OpenStreetMap-Suche nach Adresse bzw. Ort).
import { query } from "@/lib/db";
import { normalizeGermanState } from "@/lib/germany-pflege-coverage";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

async function lookup(text: string) {
  const url = new URL(NOMINATIM);
  url.searchParams.set("q", text);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "de");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: { "user-agent": "DigitaleGewinner-CRM/1.0 (kontakt@digitalegewinner.de)", "accept-language": "de" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const [hit] = (await response.json()) as { address?: Record<string, string> }[];
  const address = hit?.address;
  if (!address) return null;
  const state = normalizeGermanState(address.state || "");
  // Stadtstaaten und kreisfreie Städte haben keinen Landkreis: dann gilt die Stadt selbst.
  const county = address.county || address.city || address.town || address.municipality || address.state_district || "";
  return state || county ? { state, county } : null;
}

export async function enrichGeoOnce({ limit = 25, budgetMs = 40_000 }: { limit?: number; budgetMs?: number } = {}) {
  const startedAt = Date.now();
  let checked = 0, mapped = 0;
  const rows = await query<{ id: string; city: string; address: string; plz: string; state: string }>(
    `select c.id, coalesce(c.city,'') city, coalesce(c.metadata->>'address','') address, coalesce(c.metadata->>'postal_code','') plz, coalesce(c.metadata->>'state','') state
     from sales_companies c join sales_leads l on l.company_id=c.id and l.workspace=c.workspace
     where c.workspace='default' and l.status='active' and c.metadata->>'geo_at' is null and (coalesce(c.city,'')<>'' or coalesce(c.metadata->>'address','')<>'')
     order by l.priority_score desc nulls last limit $1`,
    [limit],
  ).catch(() => []);
  for (const row of rows) {
    if (Date.now() - startedAt > budgetMs) break;
    checked++;
    let geo: { state: string; county: string } | null = null;
    try {
      geo = await lookup(row.address || `${row.plz} ${row.city}`.trim());
      if (!geo?.county && row.city) geo = await lookup(`${row.plz} ${row.city}`.trim());
    } catch { /* Netzfehler: beim nächsten Lauf erneut */ continue; }
    const patch = { geo_at: new Date().toISOString(), ...(geo?.county ? { county: geo.county } : {}), ...(geo?.state && !row.state ? { state: geo.state } : {}) };
    await query("update sales_companies set metadata=coalesce(metadata,'{}'::jsonb)||$2::jsonb where id=$1", [row.id, JSON.stringify(patch)]);
    if (geo) mapped++;
    await new Promise((resolve) => setTimeout(resolve, 1100)); // Nominatim: höchstens eine Anfrage pro Sekunde
  }
  return { geoChecked: checked, geoMapped: mapped };
}
