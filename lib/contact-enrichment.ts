import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type ContactEnrichment = {
  email: string;
  emails: string[];
  phone: string;
  phones: string[];
  linkedin: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  youtube: string;
  xing: string;
  contactPage: string;
  careersPage: string;
  jobsPage: string;
  teamPage: string;
  pagesScanned: number;
  atsProviders: string[];
  trackingTools: string[];
  recruitingSignals: string[];
  source: "public-website";
};

const MAX_BYTES = 1_500_000;
const MAX_PAGES = 7;
const MAX_REDIRECTS = 4;

function privateIp(ip: string) {
  const value = ip.toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (isIP(ip) === 6) return value === "::1" || value === "::" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd");
  return true;
}
function siteHost(host: string) { return host.toLowerCase().replace(/^www\./, ""); }
function sameSite(a: string, b: string) { return siteHost(a) === siteHost(b); }
async function safeUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Ungültige Website-URL.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Interne Hosts sind nicht erlaubt.");
  if (isIP(host) && privateIp(host)) throw new Error("Private Zieladresse ist nicht erlaubt.");
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => privateIp(entry.address))) throw new Error("Website ist nicht öffentlich erreichbar.");
}
function normalize(raw: string) { const value = raw.trim(); if (!value) throw new Error("Website fehlt."); return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); }
function decode(value: string) { return value.replace(/&amp;/gi, "&").replace(/&#64;|&#x40;/gi, "@").replace(/&nbsp;/gi, " ").replace(/\s+/g, " "); }
function clean(value: string) { return decode(value.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }
function unique(values: string[]) { return [...new Set(values.filter(Boolean))]; }
function emailScore(email: string) {
  const local = email.split("@")[0].toLowerCase();
  const preferred = ["personal", "bewerbung", "karriere", "jobs", "hr", "recruiting", "info", "kontakt", "contact", "office", "leitung", "pdl", "team", "service"];
  const bad = ["noreply", "no-reply", "privacy", "datenschutz", "abuse", "webmaster"];
  if (bad.some((x) => local.includes(x))) return -20;
  const preferredIndex = preferred.findIndex((x) => local === x || local.startsWith(`${x}.`) || local.startsWith(`${x}-`));
  return preferredIndex >= 0 ? 70 - preferredIndex : 10;
}

const ATS: Array<[RegExp, string]> = [
  [/personio\.(?:de|com)|jobs\.personio/i, "Personio"],
  [/softgarden/i, "softgarden"],
  [/onlyfy|prescreen/i, "onlyfy"],
  [/rexx-systems|rexx\.hr/i, "rexx"],
  [/concludis/i, "Concludis"],
  [/coveto/i, "coveto"],
  [/dvinci/i, "d.vinci"],
  [/smartrecruiters/i, "SmartRecruiters"],
  [/workable\.com/i, "Workable"],
  [/join\.com/i, "JOIN"],
  [/jacando/i, "jacando"],
  [/indeed\.(?:com|de)/i, "Indeed"],
  [/arbeitsagentur\.de\/jobsuche/i, "Bundesagentur für Arbeit"],
  [/hokify/i, "hokify"],
];
const TRACKING: Array<[RegExp, string]> = [
  [/googletagmanager|gtag\(|google-analytics|analytics\.google/i, "Google Analytics / GTM"],
  [/connect\.facebook\.net|fbevents\.js|fbq\(/i, "Meta Pixel"],
  [/analytics\.tiktok|ttq\./i, "TikTok Pixel"],
  [/snap\.licdn\.com|linkedin\.com\/insight/i, "LinkedIn Insight"],
  [/clarity\.ms/i, "Microsoft Clarity"],
];

type Extracted = {
  emails: string[];
  phones: string[];
  linkedin: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  youtube: string;
  xing: string;
  contactLinks: string[];
  careerLinks: string[];
  jobsLinks: string[];
  teamLinks: string[];
  atsProviders: string[];
  trackingTools: string[];
  recruitingSignals: string[];
};

function extract(html: string, base: URL): Extracted {
  const decoded = decode(html);
  const body = clean(html);
  const mailtos = [...decoded.matchAll(/href\s*=\s*["']mailto:([^"'?\s>]+)/gi)].map((m) => m[1].trim().toLowerCase());
  const plain = [...decoded.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}\b/gi)].map((m) => m[0].toLowerCase());
  const emails = unique([...mailtos, ...plain]).filter((email) => !email.endsWith("@example.com") && !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(email));
  const telLinks = [...decoded.matchAll(/href\s*=\s*["']tel:([^"']+)/gi)].map((m) => m[1].replace(/[^+\d]/g, ""));
  const phones = unique(telLinks.filter((phone) => phone.replace(/\D/g, "").length >= 7));

  let linkedin = "", instagram = "", facebook = "", tiktok = "", youtube = "", xing = "";
  const contactLinks: string[] = [], careerLinks: string[] = [], jobsLinks: string[] = [], teamLinks: string[] = [];
  for (const match of decoded.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1];
    const label = clean(match[2]);
    try {
      const absolute = new URL(href, base);
      const value = absolute.toString();
      if (!linkedin && /linkedin\.com\//i.test(value)) linkedin = value;
      if (!instagram && /instagram\.com\//i.test(value)) instagram = value;
      if (!facebook && /facebook\.com\//i.test(value)) facebook = value;
      if (!tiktok && /tiktok\.com\//i.test(value)) tiktok = value;
      if (!youtube && /youtube\.com\//i.test(value)) youtube = value;
      if (!xing && /xing\.com\//i.test(value)) xing = value;
      if (!sameSite(absolute.hostname, base.hostname) || !["http:", "https:"].includes(absolute.protocol)) continue;
      const haystack = `${absolute.pathname} ${label}`;
      if (/kontakt|contact|impressum|imprint/i.test(haystack)) contactLinks.push(value);
      if (/karriere|career|arbeiten bei|arbeitgeber|mitarbeiter|team/i.test(haystack)) careerLinks.push(value);
      if (/jobs?|stellen|stellenangebote|bewerb|vacanc|offene stellen/i.test(haystack)) jobsLinks.push(value);
      if (/team|über uns|about|geschäftsführung|leitung|ansprechpartner/i.test(haystack)) teamLinks.push(value);
    } catch {}
  }

  const atsProviders = ATS.filter(([pattern]) => pattern.test(decoded)).map(([, name]) => name);
  const trackingTools = TRACKING.filter(([pattern]) => pattern.test(decoded)).map(([, name]) => name);
  const recruitingSignals: string[] = [];
  if (/pflegefachkraft|pflegefachkräfte|examiniert|altenpfleger|gesundheits- und krankenpfleg|pflegehelfer/i.test(body)) recruitingSignals.push("Pflege-Recruiting-Inhalt erkannt");
  if (/karriere|stellenangebot|offene stellen|wir suchen|jetzt bewerben|bewerben sie sich|komm ins team/i.test(body)) recruitingSignals.push("Aktive Karriere-/Bewerberansprache erkannt");
  if (/benefits|vorteile|arbeitgeber|mitarbeiterbenefits|betriebliche altersvorsorge|jobrad|fortbildung|weiterbildung/i.test(body)) recruitingSignals.push("Employer-Branding-/Benefit-Inhalte erkannt");
  if (/quereinsteiger|ausbildung|azubi|praktikum/i.test(body)) recruitingSignals.push("Ausbildungs-/Quereinsteiger-Ansprache erkannt");
  if (careerLinks.length) recruitingSignals.push("Karrierebereich verlinkt");
  if (jobsLinks.length) recruitingSignals.push("Stellen-/Bewerbungsseite verlinkt");
  if (atsProviders.length) recruitingSignals.push(`ATS erkannt: ${atsProviders.join(", ")}`);
  if (linkedin || instagram || facebook || tiktok || youtube || xing) recruitingSignals.push("Social-Media-Präsenz erkannt");

  return {
    emails,
    phones,
    linkedin,
    instagram,
    facebook,
    tiktok,
    youtube,
    xing,
    contactLinks: unique(contactLinks),
    careerLinks: unique(careerLinks),
    jobsLinks: unique(jobsLinks),
    teamLinks: unique(teamLinks),
    atsProviders: unique(atsProviders),
    trackingTools: unique(trackingTools),
    recruitingSignals: unique(recruitingSignals),
  };
}

async function getHtml(input: URL) {
  let url = new URL(input);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    await safeUrl(url);
    const response = await fetch(url, {
      redirect: "manual",
      cache: "no-store",
      headers: { "user-agent": "DigitaleGewinner-ContactEnrichment/2.0", accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(9000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Weiterleitung ohne Ziel.");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error(`Website HTTP ${response.status}`);
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) throw new Error("Keine HTML-Seite.");
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) throw new Error("Website zu groß.");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) throw new Error("Website zu groß.");
    return { html: new TextDecoder().decode(bytes), url };
  }
  throw new Error("Zu viele Weiterleitungen.");
}

export async function enrichPublicContact(rawUrl: string): Promise<ContactEnrichment> {
  const start = normalize(rawUrl);
  const first = await getHtml(start);
  const root = first.url;
  const queue = [root.toString()];
  const prefetched = new Map([[root.toString(), first.html]]);
  const visited = new Set<string>();
  let emails: string[] = [], phones: string[] = [];
  let linkedin = "", instagram = "", facebook = "", tiktok = "", youtube = "", xing = "";
  let contactPage = "", careersPage = "", jobsPage = "", teamPage = "";
  let atsProviders: string[] = [], trackingTools: string[] = [], recruitingSignals: string[] = [];

  while (queue.length && visited.size < MAX_PAGES) {
    const raw = queue.shift()!;
    if (visited.has(raw)) continue;
    visited.add(raw);
    try {
      const url = new URL(raw);
      if (!sameSite(url.hostname, root.hostname)) continue;
      const pageHtml = prefetched.get(raw);
      const page = pageHtml !== undefined ? { html: pageHtml, url } : await getHtml(url);
      if (!sameSite(page.url.hostname, root.hostname)) continue;
      const found = extract(page.html, page.url);
      emails = unique([...emails, ...found.emails]);
      phones = unique([...phones, ...found.phones]);
      linkedin = linkedin || found.linkedin;
      instagram = instagram || found.instagram;
      facebook = facebook || found.facebook;
      tiktok = tiktok || found.tiktok;
      youtube = youtube || found.youtube;
      xing = xing || found.xing;
      atsProviders = unique([...atsProviders, ...found.atsProviders]);
      trackingTools = unique([...trackingTools, ...found.trackingTools]);
      recruitingSignals = unique([...recruitingSignals, ...found.recruitingSignals]);
      contactPage = contactPage || found.contactLinks[0] || "";
      careersPage = careersPage || found.careerLinks[0] || "";
      jobsPage = jobsPage || found.jobsLinks[0] || "";
      teamPage = teamPage || found.teamLinks[0] || "";
      const prioritized = [...found.jobsLinks, ...found.careerLinks, ...found.teamLinks, ...found.contactLinks];
      for (const link of prioritized) {
        if (!visited.has(link) && !queue.includes(link) && queue.length + visited.size < MAX_PAGES + 4) queue.push(link);
      }
    } catch {}
  }

  emails.sort((a, b) => emailScore(b) - emailScore(a));
  return {
    email: emails[0] || "",
    emails: emails.slice(0, 12),
    phone: phones[0] || "",
    phones: phones.slice(0, 12),
    linkedin,
    instagram,
    facebook,
    tiktok,
    youtube,
    xing,
    contactPage,
    careersPage,
    jobsPage,
    teamPage,
    pagesScanned: visited.size,
    atsProviders,
    trackingTools,
    recruitingSignals,
    source: "public-website",
  };
}
