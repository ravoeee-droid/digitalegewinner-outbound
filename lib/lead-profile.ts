// Hintergrund-Agent: liest Startseite, Impressum und Karriereseite und hinterlegt Betriebsgröße, Zahl offener Stellen und Träger-/Kettenhinweise am Lead.
import { query } from "@/lib/db";
import { websiteFor } from "@/lib/lead-screenshot";

const TRAEGER = /(caritas|diakonie|diakonisch|awo\b|arbeiterwohlfahrt|drk\b|deutsches rotes kreuz|johanniter|malteser|volkssolidarit|paritätisch|paritaetisch|korian|orpea|alloheim|pro seniore|kursana|curanum|domicil|fresenius|helios|asklepios|sana kliniken|ameos|gGmbH|e\.\s?V\.|konzern|unternehmensgruppe|trägerverbund)/i;
const JOB_TITLE = /\b[\wäöüÄÖÜß\- ]{4,60}\(\s*[mwdfgx*\/]+(?:\s*[\/,]\s*[mwdfgx*]+)+\s*\)/gi;

async function page(url: string) {
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(3500), headers: { "user-agent": "Mozilla/5.0 (compatible; DGBot/1.0)" } });
    if (!response.ok || !/html|text/i.test(response.headers.get("content-type") || "")) return { html: "", text: "" };
    const html = (await response.text()).slice(0, 400_000);
    return { html, text: html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ") };
  } catch { return { html: "", text: "" }; }
}

export async function profileSite(website: string) {
  let origin = "";
  try { origin = new URL(website).origin; } catch { return null; }
  const home = await page(origin);
  if (!home.text) return null;
  const links = new Set<string>();
  for (const m of home.html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try { const u = new URL(m[1], origin); if (u.origin === origin && /(impressum|karriere|jobs?|stellen|ueber-uns|über-uns|team|standort)/i.test(u.pathname) && !/\.(pdf|jpg|png)$/i.test(u.pathname)) links.add(u.href); } catch { /* ungültiger Link */ }
    if (links.size >= 4) break;
  }
  const texts = [home.text];
  for (const href of links) { const p = await page(href); if (p.text) texts.push(p.text); }
  const all = texts.join(" ");
  let employees = 0;
  for (const m of all.matchAll(/(?:über|mehr als|rund|ca\.?|circa)?\s*(\d{1,4})\s+(?:Mitarbeiter(?:innen)?|Mitarbeitende|Beschäftigte|Pflegekräfte|Pflegefachkräfte|Kolleg(?:en|innen))/gi)) employees = Math.max(employees, Number(m[1]));
  const titles = new Set<string>();
  for (const text of texts.slice(1)) for (const m of text.matchAll(JOB_TITLE)) titles.add(m[0].trim().toLowerCase().slice(-60));
  const sites = new Set<string>();
  for (const m of all.matchAll(/\b(?:Standort|Niederlassung|Sozialstation|Wohnbereich)\s+([A-ZÄÖÜ][\wäöüß-]{2,})/g)) sites.add(m[1].toLowerCase());
  const traeger = all.match(TRAEGER)?.[0]?.toLowerCase().replace(/\s+/g, " ") || "";
  return { employees: employees || null, open_jobs: titles.size || null, locations: sites.size || null, traeger: traeger || null };
}

export async function enrichProfilesOnce({ limit = 12, budgetMs = 25_000 }: { limit?: number; budgetMs?: number } = {}) {
  const startedAt = Date.now();
  let checked = 0, found = 0;
  const rows = await query<{ id: string; website: string; email: string }>(
    `select c.id, coalesce(nullif(c.website,''),c.domain) website, coalesce(k.email,'') email
     from sales_companies c join sales_leads l on l.company_id=c.id and l.workspace=c.workspace
     left join lateral (select email from sales_contacts k where k.company_id=c.id and k.workspace='default' and coalesce(k.email,'')<>'' limit 1) k on true
     where c.workspace='default' and l.status='active' and c.metadata->>'profile_at' is null and (coalesce(c.website,'')<>'' or coalesce(c.domain,'')<>'')
     order by l.priority_score desc nulls last limit $1`,
    [limit],
  ).catch(() => []);
  for (const row of rows) {
    if (Date.now() - startedAt > budgetMs) break;
    checked++;
    const site = websiteFor(row.website, row.email);
    const profile = site ? await profileSite(site) : null;
    const patch = { profile_at: new Date().toISOString(), ...(profile ? { profile } : {}) };
    await query("update sales_companies set metadata=coalesce(metadata,'{}'::jsonb)||$2::jsonb where id=$1", [row.id, JSON.stringify(patch)]).catch(() => undefined);
    if (profile) found++;
  }
  return { profileChecked: checked, profileFound: found };
}
