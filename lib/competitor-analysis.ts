// Wettbewerbsanalyse für einen Lead: Betriebe im Umkreis (aus unseren Listen und dem CRM), Website-Auswertung, Google-Bewertungen, Stärken/Schwächen und Chancen.
// Es werden nur messbare, öffentlich sichtbare Angaben verwendet; keine erfundenen Aussagen über Wettbewerber.
import pflegeSites from "@/data/pflege-sites.json";
import pvPool from "@/data/pv-pool.json";
import { query } from "@/lib/db";
import { runWebsiteAudit, type WebsiteAuditResult } from "@/lib/website-audit";

export type Segment = "pflege" | "pv";
type Candidate = { name: string; website: string; city: string; state: string; rating: number; reviews: number; lat?: number; lng?: number };
export type Business = {
  name: string; website: string; city: string; distanceKm: number | null; rating: number; reviews: number;
  scores: { overall: number; conversion: number; seo: number; technical: number; trust: number } | null;
  hasCareer: boolean | null; strengths: string[]; weaknesses: string[]; audit: WebsiteAuditResult | null;
};
export type Analysis = {
  segment: Segment; generatedAt: string; own: Business; competitors: Business[]; radiusKm: number;
  opportunities: Array<{ title: string; text: string }>; coverageNote: string;
};

const host = (url: string) => { try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const fmt = (value: number) => value.toFixed(1).replace(".", ",");

async function geocode(city: string, state = ""): Promise<{ lat: number; lng: number } | null> {
  const key = `${city}|${state}`.toLowerCase();
  await query("create table if not exists geo_cache (key text primary key, lat double precision, lng double precision)").catch(() => null);
  const [hit] = await query<{ lat: number | null; lng: number | null }>("select lat,lng from geo_cache where key=$1", [key]).catch(() => []);
  if (hit) return hit.lat === null || hit.lng === null ? null : { lat: hit.lat, lng: hit.lng };
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&q=${encodeURIComponent(`${city}, ${state}`.replace(/, $/, ""))}`, { headers: { "User-Agent": "DigitaleGewinner/1.0 (digitalegewinner.de)" }, signal: AbortSignal.timeout(6000) });
    const data = (await response.json()) as Array<{ lat: string; lon: string }>;
    const point = data[0] ? { lat: Number(data[0].lat), lng: Number(data[0].lon) } : null;
    await query("insert into geo_cache(key,lat,lng) values($1,$2,$3) on conflict (key) do nothing", [key, point?.lat ?? null, point?.lng ?? null]).catch(() => null);
    return point;
  } catch { return null; }
}

function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

async function candidatePool(segment: Segment, excludeHost: string): Promise<Candidate[]> {
  const pool = new Map<string, Candidate>();
  if (segment === "pflege") {
    for (const row of pflegeSites as Array<{ n: string; w: string; c: string; s: string; r?: number; v?: number; la?: number; lo?: number }>) {
      const h = host(row.w);
      if (h && h !== excludeHost) pool.set(h, { name: row.n, website: row.w, city: row.c, state: row.s, rating: row.r || 0, reviews: row.v || 0, lat: row.la, lng: row.lo });
    }
  } else {
    for (const row of pvPool as Array<{ n: string; w: string; c: string; s: string; r?: number; v?: number }>) {
      const h = host(row.w);
      if (h && h !== excludeHost) pool.set(h, { name: row.n, website: row.w, city: row.c, state: row.s, rating: row.r || 0, reviews: row.v || 0 });
    }
  }
  const rows = await query<{ name: string; website: string; city: string; state: string }>(
    `select c.name, coalesce(nullif(c.website,''),c.domain) website, coalesce(c.city,'') city, coalesce(c.metadata->>'state','') state
     from sales_companies c where c.workspace='default' and ${segment === "pv" ? "c.source='ba-pv'" : "c.source<>'ba-pv' and c.industry='Pflege'"}
       and coalesce(nullif(c.website,''),c.domain)<>'' and coalesce(c.city,'')<>'' limit 1500`,
  ).catch(() => []);
  for (const row of rows) {
    const h = host(row.website);
    if (h && h !== excludeHost && !pool.has(h)) pool.set(h, { name: row.name, website: row.website, city: row.city, state: row.state, rating: 0, reviews: 0 });
  }
  const blocked = await query<{ pattern: string }>("select pattern from lead_blocklist").catch(() => []);
  return [...pool.values()].filter((c) => !blocked.some((b) => c.name.toLowerCase().includes(b.pattern.toLowerCase()) || host(c.website).includes(b.pattern.toLowerCase())));
}

async function careerPage(website: string) {
  try {
    const response = await fetch(website, { signal: AbortSignal.timeout(7000), headers: { "User-Agent": "Mozilla/5.0 DigitaleGewinnerAnalyse/1.0" }, redirect: "follow" });
    const html = (await response.text()).slice(0, 400_000);
    return /href=["'][^"']*(karriere|jobs?|stellenangebote|stellen|bewerb)[^"']*["']/i.test(html);
  } catch { return null; }
}

function signals(biz: Business, segment: Segment) {
  const strengths: string[] = [], weaknesses: string[] = [];
  const a = biz.audit, s = biz.scores;
  if (biz.rating >= 4.7 && biz.reviews >= 30) strengths.push(`Sehr gute Google-Bewertung (${fmt(biz.rating)} Sterne, ${biz.reviews} Bewertungen)`);
  else if (biz.rating > 0 && biz.rating < 4.3) weaknesses.push(`Google-Bewertung unter 4,3 (${fmt(biz.rating)} Sterne)`);
  if (biz.rating > 0 && biz.reviews < 10) weaknesses.push(`Wenige Google-Bewertungen (${biz.reviews})`);
  if (a && s) {
    if (s.conversion >= 75) strengths.push("Klarer Weg zu Anfrage und Kontakt auf der Website");
    else if (s.conversion < 50) weaknesses.push("Auf der Startseite wurde kaum ein klarer Anfrageweg erkannt");
    if (a.metrics.hasTestimonials || a.metrics.hasCaseStudies) strengths.push("Bewertungen oder Referenzen sind auf der Website sichtbar");
    else weaknesses.push("Auf der Startseite wurden keine Bewertungen oder Referenzen erkannt");
    if (a.metrics.hasWhatsapp) strengths.push("WhatsApp als schneller Kontaktweg");
    if (!a.metrics.hasViewport) weaknesses.push("Keine Smartphone-Optimierung der Website erkannt");
    if (s.technical >= 85) strengths.push("Technisch saubere Website");
    else if (a.responseMs > 2500) weaknesses.push("Website antwortete bei der Messung langsam");
    if (a.metrics.formCount === 0 && a.metrics.ctaCount < 3) weaknesses.push(segment === "pflege" ? "Kein Bewerbungs- oder Kontaktformular auf der Startseite erkannt" : "Kein Anfrageformular auf der Startseite erkannt");
  }
  if (segment === "pflege" && biz.hasCareer === true) strengths.push("Eigene Karriere- bzw. Stellenseite vorhanden");
  if (segment === "pflege" && biz.hasCareer === false) weaknesses.push("Keine Karriere- bzw. Stellenseite erkannt");
  return { strengths: strengths.slice(0, 4), weaknesses: weaknesses.slice(0, 4) };
}

async function evaluate(candidate: Candidate, segment: Segment, distanceKm: number | null): Promise<Business> {
  const audit = await runWebsiteAudit(candidate.website, candidate.name).catch(() => null);
  const hasCareer = segment === "pflege" ? await careerPage(audit?.finalUrl || candidate.website) : null;
  const biz: Business = {
    name: candidate.name, website: audit?.finalUrl || candidate.website, city: candidate.city, distanceKm,
    rating: candidate.rating, reviews: candidate.reviews, hasCareer, audit,
    scores: audit ? { overall: audit.scores.overall, conversion: audit.scores.conversion, seo: audit.scores.seo, technical: audit.scores.technical, trust: audit.scores.trust } : null,
    strengths: [], weaknesses: [],
  };
  Object.assign(biz, signals(biz, segment));
  return biz;
}

export async function buildAnalysis(leadId: string): Promise<Analysis | null> {
  const [lead] = await query<{ name: string; website: string; city: string; source: string; industry: string; state: string }>(
    `select c.name, coalesce(nullif(c.website,''),c.domain) website, coalesce(c.city,'') city, coalesce(c.source,'') source, coalesce(c.industry,'') industry, coalesce(c.metadata->>'state','') state
     from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace where l.id::text=$1 limit 1`, [leadId],
  ).catch(() => []);
  if (!lead || !lead.website) return null;
  const segment: Segment = lead.source === "ba-pv" ? "pv" : "pflege";
  const ownHost = host(lead.website);
  const origin = lead.city ? await geocode(lead.city, lead.state) : null;
  const pool = await candidatePool(segment, ownHost);

  const cityCoords = new Map<string, { lat: number; lng: number } | null>();
  const located: Array<{ c: Candidate; km: number | null }> = [];
  for (const candidate of pool) {
    let point = candidate.lat !== undefined && candidate.lng !== undefined ? { lat: candidate.lat, lng: candidate.lng } : null;
    if (!point && origin && candidate.city && cityCoords.size < 40) {
      const key = `${candidate.city}|${candidate.state}`;
      if (!cityCoords.has(key)) cityCoords.set(key, await geocode(candidate.city, candidate.state));
      point = cityCoords.get(key) || null;
    } else if (!point && origin && candidate.city) point = cityCoords.get(`${candidate.city}|${candidate.state}`) || null;
    const km = origin && point ? distance(origin, point) : null;
    const sameCity = lead.city && candidate.city.toLowerCase() === lead.city.toLowerCase();
    located.push({ c: candidate, km: sameCity && km === null ? 0 : km });
  }
  const radiusKm = 40;
  const near = located.filter((x) => x.km !== null && x.km <= radiusKm).sort((a, b) => (a.km as number) - (b.km as number)).slice(0, 9);
  const [own, ...rest] = await Promise.all([
    evaluate({ name: lead.name, website: lead.website, city: lead.city, state: lead.state, rating: (pool.find(() => false)?.rating) || 0, reviews: 0 }, segment, 0),
    ...near.map((x) => evaluate(x.c, segment, x.km)),
  ]);
  const competitors = rest.filter((b) => b.audit).slice(0, 5);

  const n = competitors.length;
  const share = (test: (b: Business) => boolean) => competitors.filter(test).length;
  const opportunities: Analysis["opportunities"] = [];
  if (n > 0) {
    if (segment === "pflege") {
      const noCareer = share((b) => b.hasCareer === false);
      if (noCareer > 0 && (own.hasCareer === false || noCareer * 2 >= n)) opportunities.push({ title: "Karriereseite als Hebel", text: `${noCareer} von ${n} untersuchten Betrieben im Umkreis haben keine erkannte Karriere- oder Stellenseite. Wer Bewerber auf einer klaren, schnellen Seite abholt, ist für Fachkräfte leichter zu finden.${own.hasCareer === false ? " Das gilt auch für Ihre Website." : ""}` });
    }
    const noProof = share((b) => !(b.audit?.metrics.hasTestimonials || b.audit?.metrics.hasCaseStudies));
    if (noProof > 0) opportunities.push({ title: "Vertrauen sichtbar machen", text: `Bei ${noProof} von ${n} Betrieben wurden auf der Startseite keine Bewertungen oder Referenzen erkannt.${own.audit && !(own.audit.metrics.hasTestimonials || own.audit.metrics.hasCaseStudies) ? " Auch bei Ihnen sind sie bisher nicht sichtbar." : " Bei Ihnen sind sie vorhanden, ein klarer Vorteil."}` });
    const noWa = share((b) => !b.audit?.metrics.hasWhatsapp);
    if (noWa > 0) opportunities.push({ title: "Schneller Kontaktweg", text: `${noWa} von ${n} Betrieben bieten keinen WhatsApp-Kontakt auf der Website an. Ein direkter, niedrigschwelliger Kontaktweg senkt die Hürde für Anfragen${segment === "pflege" ? " und Bewerbungen" : ""}.` });
    const avgConv = Math.round(competitors.reduce((sum, b) => sum + (b.scores?.conversion || 0), 0) / n);
    if (own.scores && own.scores.conversion < avgConv) opportunities.push({ title: "Anfrageweg verbessern", text: `Der Anfrage-Score Ihrer Website liegt mit ${own.scores.conversion} unter dem Durchschnitt der Betriebe im Umkreis (${avgConv}). Hier ist der schnellste Gewinn möglich.` });
    const topRated = [...competitors].filter((b) => b.reviews >= 30).sort((a, b) => b.rating - a.rating)[0];
    if (topRated && topRated.rating >= 4.7) opportunities.push({ title: "Bewertungen aufbauen", text: `${topRated.name} hat ${topRated.reviews} Google-Bewertungen mit durchschnittlich ${fmt(topRated.rating)} Sternen. Regelmäßig gesammelte Bewertungen sind im Umkreis ein starkes Vertrauenssignal.` });
  }
  const coverageNote = n >= 3
    ? `Verglichen wurden ${n} Betriebe im Umkreis von ca. ${radiusKm} km.`
    : `Im Umkreis von ca. ${radiusKm} km lagen uns nur ${n} vergleichbare Betriebe mit erreichbarer Website vor. Im Gespräch erweitern wir den Vergleich.`;
  return { segment, generatedAt: new Date().toISOString(), own, competitors, radiusKm, opportunities: opportunities.slice(0, 4), coverageNote };
}
