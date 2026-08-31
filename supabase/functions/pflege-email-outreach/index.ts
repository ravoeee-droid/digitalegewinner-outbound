import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BA_BASE = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service";
const BA_KEY = "jobboerse-jobsuche";
const DEFAULT_TARGET = 100;
const SEARCH_TERMS = [
  "Pflegedienst Pflegefachkraft",
  "ambulante Pflege Pflegefachkraft",
  "Sozialstation Pflegefachkraft",
  "Intensivpflege Pflegefachkraft",
  "häusliche Krankenpflege",
  "ambulanter Pflegedienst",
  "Pflegedienstleitung ambulant",
  "Pflegefachkraft ambulant",
  "mobiler Pflegedienst",
  "außerklinische Intensivpflege",
  "Pflege zuhause Pflegefachkraft",
  "ambulante Krankenpflege",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dg-pflege-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

const STAFFING = /(randstad|adecco|manpower|tempton|persona service|personaservice|pluss|akut|avanti|piening|unique personal|in care|incare|all\.medi|medwing|pacura|felten|sky personal|iperdimed|zeitarbeit|arbeitnehmerüberlass|arbeitnehmeruberlass|personaldienst|personalvermittlung|staffing|leiharbeit|recruiting agentur|personalmanagement|personalservice|personallösung|personalloesung|arbeitgeberüberlass|arbeitsvermittlung)/i;
const BIG_ORG = /(universitätsklin|universitaetsklin|universitätsmedizin|universitaetsmedizin|klinikum|\bklinik\b|krankenhaus|charit[eé]|helios|asklepios|sana klin|korian|alloheim|caritas|diakonie|deutsches rotes kreuz|\bdrk\b|\bbrk\b|arbeiterwohlfahrt|\bawo\b|johanniter|malteser|lebenshilfe|deutsche fachpflege|renafan|advita|aiutanda|compassio|dorea|emeis|pro seniore|kursana|azurit|münchenstift|munchenstift|landkreis|kreisverwaltung|stadtverwaltung|bundeswehr|holding|konzern|bundesweit|zentrale geschäftsführung|zentrale geschaeftsfuehrung)/i;
const INPATIENT = /(pflegeheim|altenheim|seniorenheim|seniorenzentrum|seniorenresidenz|pflegezentrum|pflegewohn|wohnstift|wohnpark|stationäre pflege|stationaere pflege|tagespflege|hospiz)/i;
const AMBULATORY = /(pflegedienst|ambulant|sozialstation|häusliche pflege|haeusliche pflege|häusliche krankenpflege|haeusliche krankenpflege|mobile pflege|mobiler pflege|pflegeteam|pflege zuhause|pflege zu hause|krankenpflege.*zuhause|krankenpflege.*zu hause)/i;
const INTENSIVE = /(intensivpflege|1:1 pflege|außerklinische intensiv|ausserklinische intensiv|beatmungspflege)/i;
const PORTAL = /(arbeitsagentur\.de|jobboerse|jobbörse|indeed\.|stepstone\.|meinestadt\.|kimeta\.|adzuna\.|talent\.com|xing\.com\/jobs|linkedin\.com\/jobs|joblift\.|jobrapido\.|stellenonline\.|yourfirm\.|regio-jobanzeiger)/i;
const BAD_EMAIL_DOMAIN = /(arbeitsagentur\.de|jobcenter\.|indeed\.|stepstone\.|meinestadt\.|kimeta\.|adzuna\.|talent\.com|joblift\.|jobrapido\.)$/i;

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });

function dayBerlin() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function norm(value: unknown) {
  return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function groupKey(name: string) {
  return norm(name).replace(/\b(gmbh|ggmbh|mbh|e\.v\.|ev|ug|ag|kg|gbr)\b/g, "").replace(/[^a-z0-9äöüß]+/g, " ").trim();
}

function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value as Record<string, unknown>)) strings(item, out);
  return out;
}

function first(object: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = object?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function ms(value: unknown) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanPhone(value: string) {
  let cleaned = String(value || "").trim().replace(/[^\d+]/g, "");
  if (cleaned.startsWith("0049")) cleaned = `+49${cleaned.slice(4)}`;
  if (cleaned.startsWith("00") && !cleaned.startsWith("0049")) return "";
  if (cleaned.startsWith("+") && !cleaned.startsWith("+49")) return "";
  const digits = cleaned.replace(/\D/g, "");
  if (cleaned.startsWith("+49")) return digits.length >= 11 && digits.length <= 14 ? `+${digits}` : "";
  return digits.startsWith("0") && digits.length >= 9 && digits.length <= 13 ? digits : "";
}

function phoneFromText(text: string) {
  for (const match of text.matchAll(/(?:Tel\.?|Telefon|Mobil|Handy|Phone|href=["']tel:)\s*[:=]?\s*["']?((?:\+49|0049|0)[\d\s()\/-]{7,20})/gi)) {
    const phone = cleanPhone(match[1]);
    if (phone) return phone;
  }
  return "";
}

function goodEmail(value: string) {
  const email = String(value || "").trim().toLowerCase().replace(/^mailto:/, "").replace(/[>,;.)]+$/g, "");
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return "";
  if (/^(no-?reply|donotreply|noreply)@/i.test(email)) return "";
  const domain = email.split("@")[1] || "";
  if (BAD_EMAIL_DOMAIN.test(domain)) return "";
  return email;
}

function emailFromText(text: string) {
  for (const raw of text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []) {
    const email = goodEmail(raw);
    if (email) return email;
  }
  return "";
}

function personFromText(text: string) {
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const patterns = [
    /(?:Geschäftsführer(?:in)?|Geschaeftsfuehrer(?:in)?|Inhaber(?:in)?|Pflegedienstleitung|PDL|Ansprechpartner(?:in)?|Kontaktperson)\s*:?\s*(?:Herrn?|Frau)?\s*([A-ZÄÖÜ][A-Za-zÄÖÜäöüß'’.-]+\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'’.-]+)/g,
    /(?:Herr|Frau)\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß'’.-]+\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'’.-]+)/g,
  ];
  for (const pattern of patterns) {
    for (const match of plain.matchAll(pattern)) {
      const person = match[1].trim();
      if (person.length >= 5 && person.length <= 60 && !/(Pflege|Team|Bewohner|Menschen|Kontakt|Bewerbung)/i.test(person)) return person;
    }
  }
  return "";
}

function isExcludedCompany(name: string, text = "") {
  const value = `${name} ${text}`;
  return !name || STAFFING.test(value) || BIG_ORG.test(value) || INPATIENT.test(name);
}

function categoryOf(name: string, text: string) {
  const value = `${name} ${text}`;
  if (INTENSIVE.test(value)) return "intensive_care";
  if (AMBULATORY.test(value) && !INPATIENT.test(value)) return "ambulatory_care";
  return "";
}

function stateOf(value: string) {
  const text = norm(value);
  const states: Array<[RegExp, string]> = [
    [/baden.wurttemberg|baden_wuerttemberg/, "Baden-Württemberg"], [/bayern/, "Bayern"], [/berlin/, "Berlin"],
    [/brandenburg/, "Brandenburg"], [/bremen/, "Bremen"], [/hamburg/, "Hamburg"], [/hessen/, "Hessen"],
    [/mecklenburg/, "Mecklenburg-Vorpommern"], [/niedersachsen/, "Niedersachsen"], [/nordrhein|nrw/, "Nordrhein-Westfalen"],
    [/rheinland.pfalz/, "Rheinland-Pfalz"], [/saarland/, "Saarland"], [/sachsen.anhalt/, "Sachsen-Anhalt"],
    [/sachsen/, "Sachsen"], [/schleswig.holstein/, "Schleswig-Holstein"], [/thuringen/, "Thüringen"],
  ];
  for (const [pattern, label] of states) if (pattern.test(text)) return label;
  return "Unbekannt";
}

function locationOf(summary: Record<string, unknown>, detail: Record<string, unknown>) {
  let address: Record<string, unknown> = {};
  const detailLocations = Array.isArray(detail.stellenlokationen) ? detail.stellenlokationen as Record<string, unknown>[] : [];
  const summaryLocations = Array.isArray(summary.stellenlokationen) ? summary.stellenlokationen as Record<string, unknown>[] : [];
  if (detailLocations[0]?.adresse && typeof detailLocations[0].adresse === "object") address = detailLocations[0].adresse as Record<string, unknown>;
  else if (summaryLocations[0]?.adresse && typeof summaryLocations[0].adresse === "object") address = summaryLocations[0].adresse as Record<string, unknown>;
  else if (detail.arbeitgeberAdresse && typeof detail.arbeitgeberAdresse === "object") address = detail.arbeitgeberAdresse as Record<string, unknown>;
  const street = first(address, ["strasseHausnummer", "strasse", "straße", "str"]);
  const house = first(address, ["hausnummer", "hnr"]);
  const postal = String(address.plz || address.postleitzahl || "").trim();
  const city = first(address, ["ort", "stadt", "city"]);
  const region = first(address, ["region", "bundesland"]);
  const full = [street && `${street}${house && !street.includes(house) ? ` ${house}` : ""}`, [postal, city].filter(Boolean).join(" "), region].filter(Boolean).join(", ");
  return { city, address: full, state: stateOf(`${region} ${full}`) };
}

function corporateUrl(value: string) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || PORTAL.test(url.hostname + url.pathname)) return "";
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return "";
  }
}

function websiteFrom(detail: Record<string, unknown>, email: string) {
  for (const value of strings(detail)) {
    if (/^https?:\/\//i.test(value)) {
      const site = corporateUrl(value);
      if (site) return site;
    }
  }
  const domain = email.split("@")[1] || "";
  if (domain && !BAD_EMAIL_DOMAIN.test(domain) && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return `https://${domain}`;
  return "";
}

async function fetchText(url: string, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; DigitaleGewinnerPflegeRadar/2.0)" } });
    if (!response.ok || PORTAL.test(response.url)) return { url: response.url || url, text: "" };
    return { url: response.url, text: (await response.text()).slice(0, 600000) };
  } catch {
    return { url, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

type SiteInspection = { finalUrl: string; email: string; phone: string; person: string; finding: string; opportunity: number; career: boolean; form: boolean };

async function inspectSite(website: string, needEmail: boolean): Promise<SiteInspection> {
  if (!website) return { finalUrl: "", email: "", phone: "", person: "", finding: "Keine eigene Website sicher erkannt", opportunity: 94, career: false, form: false };
  const home = await fetchText(website);
  let combined = home.text;
  let email = emailFromText(home.text);
  let phone = phoneFromText(home.text);
  let person = personFromText(home.text);
  if (needEmail && !email) {
    try {
      const origin = new URL(home.url || website).origin;
      const extra = await Promise.all([fetchText(`${origin}/kontakt`), fetchText(`${origin}/impressum`)]);
      combined += `\n${extra.map((x) => x.text).join("\n")}`;
      email ||= emailFromText(combined);
      phone ||= phoneFromText(combined);
      person ||= personFromText(combined);
    } catch {}
  }
  const career = /(karriere|stellenangebote|jobs|bewerben|offene stellen|komm ins team)/i.test(combined);
  const form = /<form\b/i.test(combined);
  let finding = "Online-Auftritt mit Recruiting-Potenzial";
  let opportunity = 68;
  if (!combined) { finding = "Website nicht zuverlässig erreichbar"; opportunity = 88; }
  else if (!career) { finding = "Kein klarer Karriere-/Bewerberweg erkannt"; opportunity = 92; }
  else if (!form) { finding = "Kein direktes Bewerbungsformular erkannt"; opportunity = 84; }
  return { finalUrl: home.url || website, email, phone, person, finding, opportunity, career, form };
}

function cfg() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) throw new Error("Supabase service environment missing");
  return { url, key };
}

async function db(path: string, init: RequestInit = {}) {
  const { url, key } = cfg();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!response.ok) throw new Error(`DB ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function runtimeControl() {
  const rows = await db("pflege_email_runtime_control?id=eq.true&select=enabled,secret,target_count&limit=1") as Array<{ enabled: boolean; secret: string; target_count: number }>;
  return rows[0] || { enabled: false, secret: "", target_count: DEFAULT_TARGET };
}

async function queueRows(date: string) {
  return await db(`pflege_email_outreach?lead_date=eq.${date}&status=neq.historical&select=id,rank,lead_key,email,lead&order=rank.asc&limit=200`) as Array<{ id: string; rank: number; lead_key: string; email: string; lead: Record<string, unknown> }>;
}

function titleFromLead(lead: Record<string, unknown>) {
  const refs = Array.isArray(lead.jobReferences) ? lead.jobReferences as Array<Record<string, unknown>> : [];
  const signals = lead.signals && typeof lead.signals === "object" ? lead.signals as Record<string, unknown> : {};
  const titles = Array.isArray(signals.jobTitles) ? signals.jobTitles as unknown[] : [];
  return String(refs[0]?.title || titles[0] || "Pflegefachkräfte").trim();
}

function websiteFinding(lead: Record<string, unknown>) {
  const signals = lead.signals && typeof lead.signals === "object" ? lead.signals as Record<string, unknown> : {};
  const audit = signals.websiteAudit && typeof signals.websiteAudit === "object" ? signals.websiteAudit as Record<string, unknown> : {};
  const finding = String(audit.finding || "").trim();
  return finding && !/online-auftritt mit recruiting-potenzial/i.test(finding) ? finding : "";
}

function makeDraft(lead: Record<string, unknown>) {
  const company = String(lead.name || "Ihrem Pflegedienst").trim();
  const person = String(lead.contactPerson || "").trim();
  const title = titleFromLead(lead);
  const finding = websiteFinding(lead);
  const jobCount = Number((lead.signals as Record<string, unknown> | undefined)?.jobCount || 0);
  const subject = `${company}: kurze Idee zu ${title}`.slice(0, 145);
  const greeting = person ? `Guten Tag ${person},` : "Guten Tag,";
  const trigger = jobCount > 1
    ? `ich habe gesehen, dass Sie aktuell mehrere Pflege-Stellen besetzen – unter anderem ${title}.`
    : `ich habe gesehen, dass Sie aktuell ${title} suchen.`;
  const websiteLine = finding ? `\nBeim Blick auf Ihren Online-Auftritt ist mir außerdem aufgefallen: ${finding}.\n` : "\n";
  const body = `${greeting}\n\n${trigger}${websiteLine}\nIch baue für Pflegedienste ein kompaktes Websystem, das Website, Bewerber- und Kundenanfragen, Terminbuchung, Automationen und ein Admin-Dashboard zusammenbringt.\n\nNormalerweise liegt so ein System bei 5.000 €. Aktuell biete ich es für 750 € einmalig + 79 €/Monat an, monatlich kündbar.\n\nIch kann Ihnen für ${company} vorab kostenlos einen individuellen Entwurf erstellen. Wenn er Ihnen nicht gefällt, kostet es nichts. Bei Interesse reicht ein kurzes „Ja“ – dann schicke ich Ihnen den Entwurf innerhalb von 48 Stunden.\n\nBeste Grüße\nRaphael Hermann`;
  return { subject, body };
}

function eligibleDailyLead(lead: Record<string, unknown>) {
  const company = String(lead.name || "");
  const category = String(lead.category || "");
  const email = goodEmail(String(lead.email || ""));
  const crm = lead.crm && typeof lead.crm === "object" ? lead.crm as Record<string, unknown> : {};
  if (crm.doNotContact === true || !email) return false;
  if (!['ambulatory_care', 'intensive_care'].includes(category)) return false;
  if (isExcludedCompany(company, JSON.stringify(lead.signals || {}))) return false;
  if (Number(lead.score || 0) < 78) return false;
  return true;
}

function outreachRow(date: string, rank: number, leadKey: string, lead: Record<string, unknown>) {
  const email = goodEmail(String(lead.email || ""));
  const draft = makeDraft(lead);
  return { lead_date: date, rank, lead_key: leadKey, email, subject: draft.subject, body: draft.body, status: "draft", lead, generated_at: new Date().toISOString() };
}

async function insertRows(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  await db("pflege_email_outreach?on_conflict=lead_key", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(rows.map(({ generated_at: _generatedAt, ...row }) => row)),
  });
}

async function seedFromDaily(date: string, target: number) {
  let queue = await queueRows(date);
  if (queue.length >= target) return { added: 0, ready: queue.length };
  const daily = await db(`pflege_daily_leads?lead_date=eq.${date}&select=rank,lead_key,lead&order=rank.asc&limit=300`) as Array<{ rank: number; lead_key: string; lead: Record<string, unknown> }>;
  const candidates = daily.filter((row) => eligibleDailyLead(row.lead)).sort((a, b) => Number(b.lead.score || 0) - Number(a.lead.score || 0));
  const deficit = target - queue.length;
  const rows = candidates.slice(0, deficit).map((row, index) => outreachRow(date, queue.length + index + 1, row.lead_key, row.lead));
  await insertRows(rows);
  const after = await queueRows(date);
  return { added: Math.max(0, after.length - queue.length), ready: after.length };
}

async function ba(url: string, timeoutMs = 14000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { "X-API-Key": BA_KEY, Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`BA ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function searchSummaries(days: number) {
  const found = new Map<string, Record<string, unknown>>();
  for (const term of SEARCH_TERMS) {
    for (let page = 1; page <= 5; page++) {
      const params = new URLSearchParams({ was: term, page: String(page), size: "100", veroeffentlichtseit: String(days), angebotsart: "1", zeitarbeit: "false" });
      try {
        const payload = await ba(`${BA_BASE}/pc/v6/jobs?${params}`) as Record<string, unknown>;
        const jobs = (Array.isArray(payload.ergebnisliste) ? payload.ergebnisliste : Array.isArray(payload.stellenangebote) ? payload.stellenangebote : []) as Record<string, unknown>[];
        for (const job of jobs) {
          const ref = String(job.referenznummer || job.refnr || "").trim();
          const company = String(job.firma || job.arbeitgeber || "").trim();
          const seed = `${company} ${String(job.stellenangebotsTitel || job.beruf || job.hauptberuf || "")}`;
          if (ref && company && !isExcludedCompany(company, seed) && (AMBULATORY.test(seed) || INTENSIVE.test(seed))) found.set(ref, job);
        }
        if (jobs.length < 80) break;
      } catch {
        break;
      }
    }
  }
  return [...found.entries()].map(([ref, summary]) => ({ ref, summary }));
}

async function detail(ref: string) {
  try {
    return await ba(`${BA_BASE}/pc/v4/jobdetails/${encodeURIComponent(btoa(ref))}`) as Record<string, unknown>;
  } catch {
    return null;
  }
}

type SupplementLead = { leadKey: string; lead: Record<string, unknown> };

async function buildSupplementLead(ref: string, summary: Record<string, unknown>, detailData: Record<string, unknown>): Promise<SupplementLead | null> {
  const company = String(detailData.firma || detailData.arbeitgeber || summary.firma || summary.arbeitgeber || "").trim();
  const fullText = strings(detailData).join("\n");
  if (isExcludedCompany(company, fullText)) return null;
  const category = categoryOf(company, `${String(summary.stellenangebotsTitel || summary.beruf || summary.hauptberuf || "")} ${fullText}`);
  if (!category) return null;
  const loc = locationOf(summary, detailData);
  if (loc.state === "Unbekannt") return null;

  let email = emailFromText(fullText);
  let website = websiteFrom(detailData, email);
  let phone = phoneFromText(fullText);
  let person = personFromText(fullText);
  const inspection = await inspectSite(website, !email);
  email ||= inspection.email;
  phone ||= inspection.phone;
  person ||= inspection.person;
  email = goodEmail(email);
  if (!email) return null;
  if (!website && inspection.finalUrl) website = inspection.finalUrl;

  const title = first(detailData, ["stellenangebotsTitel", "titel", "beruf", "hauptberuf"]) || String(summary.stellenangebotsTitel || summary.beruf || summary.hauptberuf || "Pflegefachkraft");
  const published = first(detailData, ["datumErsteVeroeffentlichung", "aktuelleVeroeffentlichungsdatum", "ersteVeroeffentlichungsdatum", "veroeffentlichungsdatum"]) || String((summary.veroeffentlichungszeitraum as Record<string, unknown> | undefined)?.von || summary.datumErsteVeroeffentlichung || "");
  const updated = first(detailData, ["aenderungsdatum", "modifikationsTimestamp", "lastUpdatedAt", "aktualisierungsdatum"]) || String(summary.aenderungsdatum || summary.modifikationsTimestamp || published);
  const latest = Math.max(ms(updated), ms(published));
  const age = latest ? Math.max(0, Math.floor((Date.now() - latest) / 86400000)) : 30;
  const freshness = age <= 7 ? 100 : age <= 14 ? 95 : age <= 30 ? 88 : 78;
  const fit = category === "intensive_care" ? 100 : 98;
  const need = 94;
  const opportunity = inspection.opportunity;
  const accessibility = Math.min(100, 83 + (email ? 10 : 0) + (phone ? 4 : 0) + (person ? 3 : 0));
  const score = Math.min(99, Math.round(need * 0.32 + fit * 0.27 + accessibility * 0.21 + freshness * 0.1 + opportunity * 0.1));
  if (score < 80) return null;

  const leadKey = `${norm(company)}|${loc.state}`;
  const lead = {
    id: `pflege-email-${hash(groupKey(company))}`,
    name: company,
    address: loc.address,
    federalState: loc.state,
    city: loc.city,
    website: inspection.finalUrl || website,
    phone,
    email,
    contactPerson: person,
    category,
    score,
    fitScore: fit,
    opportunityScore: opportunity,
    needScore: need,
    accessibilityScore: accessibility,
    organizationRisk: "low",
    tier: "1A",
    callPriority: "1A",
    confidence: 0.96,
    recommendedOffer: "Premium-Websystem für Pflegedienste: Website + Bewerber/Kunden-Funnel + Terminbuchung + Automationen + Admin-Dashboard",
    pitch: `Aktive Stelle ${title} bestätigt. ${inspection.finding}.`,
    summary: `Aktiver Pflege-Personalbedarf · öffentliche Geschäfts-E-Mail · ${category === "intensive_care" ? "Intensivpflege" : "ambulanter Pflegedienst"}.`,
    status: "new",
    sourceType: "pflege-email-outreach-v1",
    scoringVersion: "pflege-email-1a-v1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    jobReferences: [{ title, referenceNumber: ref, url: `https://www.arbeitsagentur.de/jobsuche/jobdetail/${ref}`, publishingStartDate: published || null, lastUpdatedAt: updated || published || null }],
    signals: {
      hiringStatus: "confirmed",
      jobCount: 1,
      jobTitles: [title],
      websiteAudit: { ok: Boolean(inspection.finalUrl), career: inspection.career, form: inspection.form, finding: inspection.finding, opportunity: inspection.opportunity },
      points: ["Aktive Pflege-Stelle bestätigt", "Öffentliche Geschäfts-E-Mail verifiziert", inspection.finding, person ? `Ansprechpartner: ${person}` : "Direkter Betriebskontakt"],
    },
  };
  return { leadKey, lead };
}

async function supplement(date: string, target: number) {
  let queue = await queueRows(date);
  let added = 0;
  const localSeen = new Set(queue.map((row) => row.lead_key));
  for (const days of [30, 60, 100]) {
    if (queue.length >= target) break;
    const summaries = await searchSummaries(days);
    summaries.sort((a, b) => {
      const an = String(a.summary.firma || a.summary.arbeitgeber || "");
      const bn = String(b.summary.firma || b.summary.arbeitgeber || "");
      return Number(INTENSIVE.test(bn) || AMBULATORY.test(bn)) - Number(INTENSIVE.test(an) || AMBULATORY.test(an));
    });

    for (let i = 0; i < summaries.length && queue.length < target; i += 18) {
      const batch = summaries.slice(i, i + 18);
      const details = await Promise.all(batch.map((item) => detail(item.ref)));
      const builtResults = await Promise.all(batch.map((item, index) => details[index] ? buildSupplementLead(item.ref, item.summary, details[index] as Record<string, unknown>) : Promise.resolve(null)));
      const fresh: SupplementLead[] = [];
      for (const item of builtResults) {
        if (!item || localSeen.has(item.leadKey)) continue;
        localSeen.add(item.leadKey);
        fresh.push(item);
      }
      if (fresh.length) {
        const deficit = target - queue.length;
        const rows = fresh.slice(0, deficit).map((item, index) => outreachRow(date, queue.length + index + 1, item.leadKey, item.lead));
        const before = queue.length;
        await insertRows(rows);
        queue = await queueRows(date);
        added += Math.max(0, queue.length - before);
      }
    }
  }
  return { ready: queue.length, added };
}

async function syncSales() {
  return await db("rpc/sync_pflege_email_outreach_to_sales", { method: "POST", body: "{}" });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const date = dayBerlin();
  try {
    const control = await runtimeControl();
    const provided = request.headers.get("x-dg-pflege-secret") || "";
    if (!control.enabled) return reply({ ok: false, disabled: true, date }, 503);
    if (!control.secret || provided !== control.secret) return reply({ error: "Unauthorized" }, 401);
    const target = Math.max(1, Math.min(200, Number(control.target_count || DEFAULT_TARGET)));

    const before = await queueRows(date);
    if (before.length >= target) {
      const sync = await syncSales();
      return reply({ ok: true, date, target, ready: before.length, added: 0, source: "cached", sync });
    }

    const seeded = await seedFromDaily(date, target);
    let ready = seeded.ready;
    let supplementResult = { ready, added: 0 };
    if (ready < target) {
      supplementResult = await supplement(date, target);
      ready = supplementResult.ready;
    }
    const sync = await syncSales();
    return reply({
      ok: ready >= target,
      date,
      target,
      ready,
      deficit: Math.max(0, target - ready),
      addedFromDaily: seeded.added,
      addedFromSupplement: supplementResult.added,
      source: ready >= target ? "daily+BA+website" : "partial",
      sync,
    }, ready >= target ? 200 : 206);
  } catch (error) {
    return reply({ ok: false, date, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
