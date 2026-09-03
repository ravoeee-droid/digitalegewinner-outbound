import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type AuditSeverity = "critical" | "warning" | "opportunity" | "strength";
export type AuditCategory = "SEO" | "Conversion" | "Trust" | "Technical" | "Content";

export type AuditFinding = {
  severity: AuditSeverity;
  category: AuditCategory;
  title: string;
  detail: string;
  impact: string;
  recommendation: string;
};

export type WebsiteAuditResult = {
  version: 1;
  auditedAt: string;
  requestedUrl: string;
  finalUrl: string;
  company: string;
  statusCode: number;
  responseMs: number;
  scores: {
    overall: number;
    seo: number;
    conversion: number;
    trust: number;
    technical: number;
    content: number;
  };
  metrics: {
    htmlKb: number;
    wordCount: number;
    h1Count: number;
    h2Count: number;
    imageCount: number;
    imagesMissingAlt: number;
    lazyImages: number;
    formCount: number;
    ctaCount: number;
    internalLinks: number;
    externalLinks: number;
    socialLinks: number;
    contactMethods: number;
    schemaCount: number;
    hasViewport: boolean;
    hasCanonical: boolean;
    hasOpenGraph: boolean;
    hasNoIndex: boolean;
    hasRobotsTxt: boolean;
    hasSitemap: boolean;
    hasImprint: boolean;
    hasPrivacy: boolean;
    hasTestimonials: boolean;
    hasCaseStudies: boolean;
    hasPhone: boolean;
    hasEmail: boolean;
    hasWhatsapp: boolean;
    copyrightYear: number | null;
    copyrightAgeYears: number | null;
    copyrightIsStale10y: boolean;
  };
  snapshot: {
    title: string;
    description: string;
    canonical: string;
    h1: string[];
    h2: string[];
    ctas: string[];
  };
  findings: AuditFinding[];
  priorities: Array<{
    rank: number;
    title: string;
    why: string;
    action: string;
    expectedImpact: string;
  }>;
  sales: {
    opportunitySummary: string;
    opener: string;
    emailHook: string;
    loomTalkingPoints: string[];
  };
};

const MAX_HTML_BYTES = 2_500_000;
const MAX_REDIRECTS = 4;

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&copy;/gi, "©");
}

function cleanText(value: string) {
  return decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function firstMatch(html: string, expression: RegExp) {
  return cleanText(html.match(expression)?.[1] || "");
}

function allMatches(html: string, expression: RegExp, max = 20) {
  const values: string[] = [];
  for (const match of html.matchAll(expression)) {
    const value = cleanText(match[1] || "");
    if (value && !values.includes(value)) values.push(value);
    if (values.length >= max) break;
  }
  return values;
}

function attr(tag: string, name: string) {
  const quoted = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
  if (quoted !== undefined) return quoted.trim();
  return tag.match(new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i"))?.[1]?.trim() || "";
}

function metaContent(html: string, key: string, useProperty = false) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const marker = attr(tag, useProperty ? "property" : "name").toLowerCase();
    if (marker === key.toLowerCase()) return decodeEntities(attr(tag, "content"));
  }
  return "";
}

function extractCopyrightYear(html: string) {
  const footerMatches = [...html.matchAll(/<footer\b[^>]*>([\s\S]*?)<\/footer>/gi)].map((match) => match[1] || "");
  const source = footerMatches.length ? footerMatches.join(" ") : html.slice(-Math.min(html.length, 20_000));
  const text = cleanText(source);
  const years: number[] = [];
  const patterns = [
    /(?:©|copyright)\s*(?:\(c\)\s*)?((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi,
    /((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?\s*(?:©|copyright)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      const candidate = Number.isFinite(end) && end > 0 ? end : start;
      if (candidate >= 1990 && candidate <= new Date().getUTCFullYear() + 1) years.push(candidate);
    }
  }
  return years.length ? Math.max(...years) : null;
}

function isPrivateIp(ip: string) {
  const normalized = ip.toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (isIP(ip) === 6) {
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:192.168.")
    );
  }
  return true;
}

async function assertPublicUrl(input: URL) {
  if (!["http:", "https:"].includes(input.protocol)) throw new Error("Nur HTTP/HTTPS URLs sind erlaubt.");
  if (input.username || input.password) throw new Error("URLs mit Zugangsdaten sind nicht erlaubt.");
  const host = input.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Interne Hosts sind nicht erlaubt.");
  if (isIP(host) && isPrivateIp(host)) throw new Error("Private IP-Adressen sind nicht erlaubt.");
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) throw new Error("Die Zieladresse ist nicht öffentlich erreichbar.");
}

function normalizeUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Website fehlt.");
  return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
}

async function fetchWebsite(rawUrl: string) {
  let current = normalizeUrl(rawUrl);
  const started = Date.now();
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      redirect: "manual",
      cache: "no-store",
      headers: {
        "user-agent": "DigitaleGewinner-WebsiteRadar/1.0 (+website-audit)",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Weiterleitung ohne Ziel-URL.");
      current = new URL(location, current);
      continue;
    }
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) throw new Error("Die URL liefert keine HTML-Webseite.");
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_HTML_BYTES) throw new Error("Die Startseite ist für den Schnell-Audit zu groß.");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_HTML_BYTES) throw new Error("Die Startseite ist für den Schnell-Audit zu groß.");
    return {
      html: new TextDecoder().decode(buffer),
      finalUrl: current,
      statusCode: response.status,
      responseMs: Date.now() - started,
      bytes: buffer.byteLength,
    };
  }
  throw new Error("Zu viele Weiterleitungen.");
}

async function probe(origin: URL, path: string) {
  try {
    const target = new URL(path, origin);
    await assertPublicUrl(target);
    const response = await fetch(target, {
      redirect: "manual",
      cache: "no-store",
      headers: { "user-agent": "DigitaleGewinner-WebsiteRadar/1.0" },
      signal: AbortSignal.timeout(5_000),
    });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

function scoreAudit(input: {
  statusCode: number;
  responseMs: number;
  finalUrl: URL;
  htmlKb: number;
  title: string;
  description: string;
  h1Count: number;
  h2Count: number;
  wordCount: number;
  hasCanonical: boolean;
  hasViewport: boolean;
  hasOpenGraph: boolean;
  hasNoIndex: boolean;
  schemaCount: number;
  internalLinks: number;
  imageCount: number;
  imagesMissingAlt: number;
  lazyImages: number;
  formCount: number;
  ctaCount: number;
  contactMethods: number;
  socialLinks: number;
  hasImprint: boolean;
  hasPrivacy: boolean;
  hasTestimonials: boolean;
  hasCaseStudies: boolean;
}) {
  let seo = 0;
  if (input.title.length >= 20 && input.title.length <= 65) seo += 16;
  else if (input.title) seo += 8;
  if (input.description.length >= 80 && input.description.length <= 170) seo += 16;
  else if (input.description) seo += 8;
  if (input.h1Count === 1) seo += 16;
  else if (input.h1Count > 0) seo += 7;
  if (input.h2Count >= 2) seo += 8;
  if (input.hasCanonical) seo += 9;
  if (input.hasOpenGraph) seo += 8;
  if (!input.hasNoIndex) seo += 10;
  if (input.schemaCount > 0) seo += 8;
  if (input.internalLinks >= 5) seo += 5;
  if (input.wordCount >= 350) seo += 4;

  let conversion = 0;
  if (input.ctaCount >= 3) conversion += 24;
  else if (input.ctaCount >= 1) conversion += 14;
  if (input.formCount >= 1) conversion += 20;
  if (input.contactMethods >= 3) conversion += 20;
  else if (input.contactMethods >= 1) conversion += 10;
  if (input.hasTestimonials) conversion += 16;
  if (input.hasCaseStudies) conversion += 12;
  if (input.wordCount >= 300) conversion += 8;

  let trust = 0;
  if (input.hasImprint) trust += 18;
  if (input.hasPrivacy) trust += 12;
  if (input.hasTestimonials) trust += 24;
  if (input.hasCaseStudies) trust += 18;
  if (input.schemaCount > 0) trust += 8;
  if (input.contactMethods >= 2) trust += 10;
  if (input.socialLinks >= 1) trust += 10;

  let technical = 0;
  if (input.finalUrl.protocol === "https:") technical += 18;
  if (input.statusCode >= 200 && input.statusCode < 300) technical += 18;
  if (input.hasViewport) technical += 16;
  if (input.responseMs <= 800) technical += 20;
  else if (input.responseMs <= 1600) technical += 14;
  else if (input.responseMs <= 3000) technical += 7;
  if (input.htmlKb <= 900) technical += 12;
  else if (input.htmlKb <= 1600) technical += 6;
  const imageAltRatio = input.imageCount ? 1 - input.imagesMissingAlt / input.imageCount : 1;
  technical += Math.round(imageAltRatio * 8);
  const lazyRatio = input.imageCount ? input.lazyImages / input.imageCount : 1;
  technical += Math.round(Math.min(1, lazyRatio * 1.5) * 8);

  let content = 0;
  if (input.wordCount >= 700) content += 30;
  else if (input.wordCount >= 400) content += 24;
  else if (input.wordCount >= 200) content += 14;
  if (input.h1Count === 1) content += 18;
  if (input.h2Count >= 4) content += 22;
  else if (input.h2Count >= 2) content += 14;
  if (input.hasTestimonials) content += 12;
  if (input.hasCaseStudies) content += 10;
  if (input.ctaCount >= 2) content += 8;

  const scores = {
    seo: clamp(seo),
    conversion: clamp(conversion),
    trust: clamp(trust),
    technical: clamp(technical),
    content: clamp(content),
    overall: 0,
  };
  scores.overall = clamp(scores.seo * 0.22 + scores.conversion * 0.24 + scores.trust * 0.2 + scores.technical * 0.2 + scores.content * 0.14);
  return scores;
}

export async function runWebsiteAudit(rawUrl: string, companyInput = ""): Promise<WebsiteAuditResult> {
  const fetched = await fetchWebsite(rawUrl);
  const { html, finalUrl, statusCode, responseMs, bytes } = fetched;
  const htmlLower = html.toLowerCase();
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = metaContent(html, "description");
  const canonicalTag = (html.match(/<link\b[^>]*rel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>/i) || [""])[0];
  const canonical = attr(canonicalTag, "href");
  const h1 = allMatches(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, 8);
  const h2 = allMatches(html, /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, 12);
  const bodyText = cleanText(html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " "));
  const wordCount = bodyText ? bodyText.split(/\s+/).filter((word) => word.length > 1).length : 0;
  const copyrightYear = extractCopyrightYear(html);
  const currentYear = new Date().getUTCFullYear();
  const copyrightAgeYears = copyrightYear ? Math.max(0, currentYear - copyrightYear) : null;
  const copyrightIsStale10y = copyrightAgeYears !== null && copyrightAgeYears >= 10;
  const imageTags = html.match(/<img\b[^>]*>/gi) || [];
  const imagesMissingAlt = imageTags.filter((tag) => !attr(tag, "alt")).length;
  const lazyImages = imageTags.filter((tag) => /loading\s*=\s*["']lazy["']/i.test(tag)).length;
  const formCount = (html.match(/<form\b/gi) || []).length;
  const schemaCount = (html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>/gi) || []).length;
  const viewport = metaContent(html, "viewport");
  const robots = metaContent(html, "robots");
  const hasOpenGraph = Boolean(metaContent(html, "og:title", true) || metaContent(html, "og:description", true));

  const linkTags = html.match(/<a\b[^>]*>/gi) || [];
  let internalLinks = 0;
  let externalLinks = 0;
  let socialLinks = 0;
  let hasPhone = false;
  let hasEmail = false;
  let hasWhatsapp = false;
  for (const tag of linkTags) {
    const href = attr(tag, "href");
    if (!href || href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) continue;
    if (href.toLowerCase().startsWith("tel:")) hasPhone = true;
    if (href.toLowerCase().startsWith("mailto:")) hasEmail = true;
    if (/wa\.me|whatsapp\.com/i.test(href)) hasWhatsapp = true;
    if (/linkedin\.com|instagram\.com|facebook\.com|youtube\.com|tiktok\.com|xing\.com/i.test(href)) socialLinks += 1;
    try {
      const link = new URL(href, finalUrl);
      if (["http:", "https:"].includes(link.protocol)) {
        if (link.hostname === finalUrl.hostname) internalLinks += 1;
        else externalLinks += 1;
      }
    } catch {}
  }

  const clickable = allMatches(html, /<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/gi, 120);
  const ctaWords = /(termin|beratung|angebot|analyse|demo|kontakt|anfragen|starten|jetzt|kostenlos|unverbindlich|buchen|request|book|contact|get started|quote|audit)/i;
  const ctas = clickable.filter((value) => ctaWords.test(value)).slice(0, 12);
  const contactMethods = [hasPhone, hasEmail, hasWhatsapp, formCount > 0].filter(Boolean).length;
  const hasImprint = /(impressum|legal notice|anbieterkennzeichnung)/i.test(bodyText);
  const hasPrivacy = /(datenschutz|privacy policy|privacy)/i.test(bodyText);
  const hasTestimonials = /(bewertung|bewertungen|kundenstimme|testimonial|trustpilot|google reviews|sterne|★|erfahrungen unserer kunden)/i.test(bodyText);
  const hasCaseStudies = /(referenzen|projekte|case stud|kundenprojekte|success stor|ergebnisse|arbeiten für)/i.test(bodyText);
  const [hasRobotsTxt, hasSitemap] = await Promise.all([probe(finalUrl, "/robots.txt"), probe(finalUrl, "/sitemap.xml")]);
  const htmlKb = Math.round((bytes / 1024) * 10) / 10;

  const scores = scoreAudit({
    statusCode,
    responseMs,
    finalUrl,
    htmlKb,
    title,
    description,
    h1Count: h1.length,
    h2Count: h2.length,
    wordCount,
    hasCanonical: Boolean(canonical),
    hasViewport: Boolean(viewport),
    hasOpenGraph,
    hasNoIndex: /noindex/i.test(robots),
    schemaCount,
    internalLinks,
    imageCount: imageTags.length,
    imagesMissingAlt,
    lazyImages,
    formCount,
    ctaCount: ctas.length,
    contactMethods,
    socialLinks,
    hasImprint,
    hasPrivacy,
    hasTestimonials,
    hasCaseStudies,
  });

  if (copyrightIsStale10y) {
    scores.trust = clamp(scores.trust - 18);
    scores.content = clamp(scores.content - 8);
    scores.overall = clamp(scores.seo * 0.22 + scores.conversion * 0.24 + scores.trust * 0.2 + scores.technical * 0.2 + scores.content * 0.14);
  }

  const findings: AuditFinding[] = [];
  const add = (finding: AuditFinding) => findings.push(finding);
  if (copyrightIsStale10y && copyrightYear && copyrightAgeYears !== null) add({ severity:"warning",category:"Trust",title:`Copyright-Jahr ${copyrightYear} ist ${copyrightAgeYears} Jahre alt`,detail:`Im Footer wurde als jüngstes Copyright-Jahr ${copyrightYear} erkannt. Das ist ein starkes Alterssignal, beweist aber allein nicht, dass die Website seitdem unverändert ist.`,impact:"Eine sichtbar ungepflegte Jahresangabe kann den Gesamteindruck veraltet wirken lassen und ist ein guter Anlass für eine Website-Modernisierung.",recommendation:"Website-Inhalte, Technik und Conversion-Pfade prüfen und das Copyright nur im Zuge einer tatsächlichen Aktualisierung sauber pflegen." });
  if (statusCode < 200 || statusCode >= 300) add({ severity:"critical",category:"Technical",title:`HTTP-Status ${statusCode}`,detail:"Die Startseite liefert keinen regulären 2xx-Status.",impact:"Crawler, Kampagnen-Traffic und Nutzer können auf Fehler oder Umleitungen treffen.",recommendation:"Statuscode und Redirect-Kette prüfen und eine stabile 200-Zielseite sicherstellen." });
  if (finalUrl.protocol !== "https:") add({ severity:"critical",category:"Technical",title:"Kein HTTPS",detail:"Die Zielseite wird nicht verschlüsselt ausgeliefert.",impact:"Vertrauen, Browser-Sicherheit und Conversion können leiden.",recommendation:"TLS/HTTPS erzwingen und alle internen Links auf HTTPS umstellen." });
  if (responseMs > 2500) add({ severity:"warning",category:"Technical",title:"Langsame Server-Antwort",detail:`Der Radar brauchte etwa ${responseMs} ms bis zur vollständigen HTML-Antwort.`,impact:"Langsame Seiten erhöhen Absprünge und verschlechtern Kampagnen-Effizienz.",recommendation:"Server, Caching und Render-Pfad prüfen; große Blocker priorisieren." });
  if (!viewport) add({ severity:"critical",category:"Technical",title:"Viewport-Meta fehlt",detail:"Kein Mobile-Viewport erkannt.",impact:"Mobile Darstellung und Nutzbarkeit können deutlich beeinträchtigt sein.",recommendation:"Responsive Viewport-Meta ergänzen und mobile Kernpfade testen." });
  if (!title) add({ severity:"critical",category:"SEO",title:"SEO-Titel fehlt",detail:"Auf der Startseite wurde kein Title-Tag erkannt.",impact:"Suchergebnis, Relevanzsignal und Klickrate verlieren Potenzial.",recommendation:"Ein präzises Title-Tag mit Leistung, Nutzen und Marke ergänzen." });
  else if (title.length < 20 || title.length > 65) add({ severity:"warning",category:"SEO",title:"SEO-Titel nicht optimal",detail:`Der Title hat ${title.length} Zeichen.`,impact:"Suchmaschinen können ihn abschneiden oder als zu schwach interpretieren.",recommendation:"Title auf ca. 35–60 Zeichen mit klarer Suchintention fokussieren." });
  if (!description) add({ severity:"warning",category:"SEO",title:"Meta Description fehlt",detail:"Keine Meta Description erkannt.",impact:"Die organische Klickrate wird unnötig dem Suchmaschinen-Snippet überlassen.",recommendation:"Eine nutzenorientierte Description mit klarer Handlungsaufforderung ergänzen." });
  if (h1.length !== 1) add({ severity:h1.length === 0 ? "critical" : "warning",category:"SEO",title:h1.length === 0 ? "H1 fehlt" : "Mehrere H1 erkannt",detail:`Gefundene H1: ${h1.length}.`,impact:"Seitenhierarchie und Hauptbotschaft sind weniger eindeutig.",recommendation:"Eine einzige präzise H1 für Zielgruppe, Leistung und Kernnutzen verwenden." });
  if (!canonical) add({ severity:"opportunity",category:"SEO",title:"Canonical fehlt",detail:"Kein canonical Link erkannt.",impact:"Bei URL-Varianten kann Duplicate-Content unnötig entstehen.",recommendation:"Self-referencing Canonical auf der Hauptseite ergänzen." });
  if (!hasOpenGraph) add({ severity:"opportunity",category:"SEO",title:"OpenGraph unvollständig",detail:"Kein klares OG-Title/Description-Set erkannt.",impact:"Geteilte Links wirken in Social Media und Messengern schwächer.",recommendation:"OpenGraph-Metadaten inklusive Vorschaubild ergänzen." });
  if (/noindex/i.test(robots)) add({ severity:"critical",category:"SEO",title:"Noindex erkannt",detail:"Die Seite signalisiert Suchmaschinen, sie nicht zu indexieren.",impact:"Organische Sichtbarkeit kann vollständig blockiert sein.",recommendation:"Noindex nur behalten, wenn dies bewusst gewollt ist." });
  if (!hasRobotsTxt) add({ severity:"opportunity",category:"SEO",title:"robots.txt nicht erreichbar",detail:"Unter /robots.txt wurde kein erreichbarer 2xx/3xx-Status erkannt.",impact:"Crawler-Steuerung und Sitemap-Hinweise fehlen.",recommendation:"Eine saubere robots.txt bereitstellen und Sitemap referenzieren." });
  if (!hasSitemap) add({ severity:"opportunity",category:"SEO",title:"Sitemap nicht erreichbar",detail:"Unter /sitemap.xml wurde keine erreichbare Sitemap erkannt.",impact:"Neue und tiefe Seiten werden potenziell langsamer entdeckt.",recommendation:"XML-Sitemap bereitstellen und in Search Console hinterlegen." });
  if (schemaCount === 0) add({ severity:"opportunity",category:"SEO",title:"Keine strukturierten Daten",detail:"Kein JSON-LD Schema auf der Startseite erkannt.",impact:"Suchmaschinen erhalten weniger maschinenlesbaren Kontext zur Organisation und Leistung.",recommendation:"Passende Organization/LocalBusiness/Service-Schemata ergänzen." });
  if (ctas.length === 0) add({ severity:"critical",category:"Conversion",title:"Kein klarer CTA erkannt",detail:"Keine eindeutige Termin-, Anfrage- oder Kontakt-Handlung gefunden.",impact:"Interessenten wissen nicht klar, was der nächste Schritt ist.",recommendation:"Primären CTA oberhalb des Folds und wiederholt entlang der Seite platzieren." });
  else if (ctas.length < 3) add({ severity:"warning",category:"Conversion",title:"CTA-Dichte niedrig",detail:`Nur ${ctas.length} klare Handlungsaufforderung(en) erkannt.`,impact:"Lange Seiten verlieren Nutzer, bevor sie konvertieren.",recommendation:"Primären CTA nach relevanten Proof- und Leistungsblöcken wiederholen." });
  if (formCount === 0) add({ severity:"opportunity",category:"Conversion",title:"Kein Formular erkannt",detail:"Auf der Startseite gibt es kein direktes Anfrageformular.",impact:"Ein zusätzlicher Klick zur Kontaktaufnahme erhöht Reibung.",recommendation:"Kurzes Anfrage- oder Qualifizierungsformular integrieren." });
  if (contactMethods < 2) add({ severity:"warning",category:"Conversion",title:"Wenig Kontaktwege",detail:`Nur ${contactMethods} direkter Kontaktweg erkannt.`,impact:"Je nach Gerät und Präferenz verlieren Nutzer unnötig den Kontaktpunkt.",recommendation:"Mindestens zwei klare Wege anbieten, z. B. Termin + Telefon oder Formular + E-Mail." });
  if (!hasTestimonials) add({ severity:"warning",category:"Trust",title:"Social Proof schwach",detail:"Keine klaren Bewertungen oder Kundenstimmen erkannt.",impact:"Bei kaltem Traffic fehlt ein zentraler Vertrauensverstärker.",recommendation:"Konkrete Kundenstimmen, Bewertungen und nachvollziehbare Ergebnisse sichtbar einbauen." });
  if (!hasCaseStudies) add({ severity:"opportunity",category:"Trust",title:"Referenzen/Case Studies fehlen",detail:"Keine eindeutigen Referenzen oder Fallbeispiele erkannt.",impact:"Kompetenz bleibt abstrakt statt belegt.",recommendation:"2–4 relevante Fälle mit Ausgangslage, Lösung und Ergebnis ergänzen." });
  if (!hasImprint || !hasPrivacy) add({ severity:"warning",category:"Trust",title:"Rechtliche Vertrauenssignale unvollständig",detail:`Impressum: ${hasImprint ? "erkannt" : "nicht erkannt"}, Datenschutz: ${hasPrivacy ? "erkannt" : "nicht erkannt"}.`,impact:"Fehlende oder schwer auffindbare Rechtstexte können Vertrauen und Compliance beeinträchtigen.",recommendation:"Impressum und Datenschutz gut erreichbar im Footer verlinken." });
  if (wordCount < 250) add({ severity:"warning",category:"Content",title:"Sehr wenig erklärender Inhalt",detail:`Nur etwa ${wordCount} Wörter auf der Startseite erkannt.`,impact:"Nutzen, Einwände, Suchintention und Differenzierung können zu kurz kommen.",recommendation:"Kernleistung, Zielgruppe, Proof, Prozess und häufige Einwände prägnant ergänzen." });
  if (imageTags.length > 0 && imagesMissingAlt / imageTags.length > 0.35) add({ severity:"opportunity",category:"Technical",title:"Viele Bilder ohne Alt-Text",detail:`${imagesMissingAlt} von ${imageTags.length} Bildern haben keinen erkennbaren Alt-Text.`,impact:"Accessibility und Bildkontext für Suchmaschinen bleiben schwächer.",recommendation:"Inhaltlich relevante Bilder mit präzisen Alt-Texten versehen; rein dekorative Bilder leer markieren." });

  if (scores.conversion >= 80) add({ severity:"strength",category:"Conversion",title:"Starker Conversion-Aufbau",detail:"CTA-, Kontakt- und Proof-Signale sind überdurchschnittlich ausgeprägt.",impact:"Kalter Traffic bekommt mehrere klare Wege zur Anfrage.",recommendation:"Bestehende Struktur beibehalten und nur datenbasiert testen." });
  if (scores.technical >= 85) add({ severity:"strength",category:"Technical",title:"Technische Basis stark",detail:"HTTPS, Status, Mobile-Basis und HTML-Auslieferung wirken solide.",impact:"Gute Grundlage für SEO und bezahlten Traffic.",recommendation:"Als Nächstes echte Core Web Vitals und Nutzerpfade messen." });
  if (scores.trust >= 80) add({ severity:"strength",category:"Trust",title:"Vertrauen gut sichtbar",detail:"Mehrere Trust-Signale sind bereits vorhanden.",impact:"Interessenten bekommen bessere Entscheidungsgrundlagen.",recommendation:"Proof möglichst nah an primären CTAs platzieren." });

  const severityRank: Record<AuditSeverity, number> = { critical: 0, warning: 1, opportunity: 2, strength: 3 };
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  const actionable = findings.filter((finding) => finding.severity !== "strength").slice(0, 5);
  const priorities = actionable.map((finding, index) => ({
    rank: index + 1,
    title: finding.title,
    why: finding.impact,
    action: finding.recommendation,
    expectedImpact: finding.category === "Conversion" ? "Mehr qualifizierte Anfragen" : finding.category === "Trust" ? "Mehr Vertrauen im Erstkontakt" : finding.category === "SEO" ? "Bessere organische Auffindbarkeit" : finding.category === "Technical" ? "Weniger Reibung und Absprünge" : "Klarere Positionierung",
  }));

  const inferredCompany = companyInput.trim() || title.split(/[|–—-]/)[0]?.trim() || finalUrl.hostname.replace(/^www\./, "");
  const first = actionable[0];
  const second = actionable[1];
  const third = actionable[2];
  const opportunitySummary = first
    ? `Der größte aktuell sichtbare Hebel liegt bei „${first.title}“. Zusammen mit ${second ? `„${second.title}“` : "der bestehenden Seitenstruktur"} ergibt sich konkretes Potenzial für mehr qualifizierte Anfragen.`
    : "Die Website hat bereits eine solide Basis. Der nächste Hebel liegt in datenbasierten Conversion-Tests und gezielter Personalisierung.";
  const opener = first
    ? `Ich habe mir ${inferredCompany} kurz angesehen. Mir ist direkt aufgefallen, dass ${first.title.toLowerCase()} – genau dort geht bei kaltem Traffic häufig unnötig Conversion verloren.`
    : `Ich habe mir ${inferredCompany} kurz angesehen. Die Basis ist bereits stark – ich sehe trotzdem ein paar konkrete Hebel, die sich sauber testen lassen.`;
  const emailHook = `Ich habe für ${inferredCompany} einen kurzen Website-Radar gebaut: Score ${scores.overall}/100. ${first ? `Größter Hebel: ${first.title}.` : "Die Basis ist stark; die interessantesten Punkte liegen im Feintuning."}`;
  const loomTalkingPoints = [first, second, third]
    .filter((value): value is AuditFinding => Boolean(value))
    .map((finding) => `${finding.title}: ${finding.detail} → ${finding.recommendation}`);

  return {
    version: 1,
    auditedAt: new Date().toISOString(),
    requestedUrl: rawUrl,
    finalUrl: finalUrl.toString(),
    company: inferredCompany,
    statusCode,
    responseMs,
    scores,
    metrics: {
      htmlKb,
      wordCount,
      h1Count: h1.length,
      h2Count: h2.length,
      imageCount: imageTags.length,
      imagesMissingAlt,
      lazyImages,
      formCount,
      ctaCount: ctas.length,
      internalLinks,
      externalLinks,
      socialLinks,
      contactMethods,
      schemaCount,
      hasViewport: Boolean(viewport),
      hasCanonical: Boolean(canonical),
      hasOpenGraph,
      hasNoIndex: /noindex/i.test(robots),
      hasRobotsTxt,
      hasSitemap,
      hasImprint,
      hasPrivacy,
      hasTestimonials,
      hasCaseStudies,
      hasPhone,
      hasEmail,
      hasWhatsapp,
      copyrightYear,
      copyrightAgeYears,
      copyrightIsStale10y,
    },
    snapshot: { title, description, canonical, h1, h2, ctas },
    findings,
    priorities,
    sales: { opportunitySummary, opener, emailHook, loomTalkingPoints },
  };
}