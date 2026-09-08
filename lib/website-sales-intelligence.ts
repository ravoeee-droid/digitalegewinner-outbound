import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { discoverBusinesses } from "./business-discovery";
import { query } from "./db";
import { ensureSalesOsSchema } from "./sales-os";

type JsonObject = Record<string, unknown>;

export type WebsiteIntentCategory =
  | "no_website"
  | "broken"
  | "parked"
  | "maintenance_long"
  | "maintenance_now"
  | "outdated"
  | "bad_website"
  | "healthy"
  | "unknown";

export type WebsiteSalesIntelligence = {
  version: 1;
  checkedAt: string;
  category: WebsiteIntentCategory;
  strongIntent: boolean;
  confidence: number;
  score: number;
  label: string;
  evidence: string[];
  maintenance: {
    current: boolean;
    confirmedDays: number;
    oldestConfirmedAt: string;
    archiveChecks: number;
  };
  history: {
    unchangedYears: number;
    similarity: number;
    comparedAt: string;
  };
  current: {
    statusCode: number;
    responseMs: number;
    title: string;
  };
};

type Candidate = {
  company_id: string;
  lead_id: string;
  company: string;
  city: string;
  source: string;
  website: string;
  phone: string;
  metadata: JsonObject;
  website_score: number;
  audit: JsonObject;
};

type HtmlSnapshot = {
  html: string;
  url: string;
  statusCode: number;
  responseMs: number;
};

const MAINTENANCE_RE = /(wartungsmodus|wartungsarbeiten|website\s+(?:ist|wird)\s+(?:aktuell\s+)?(?:überarbeitet|ueberarbeitet)|seite\s+(?:ist|befindet\s+sich)\s+im\s+aufbau|website\s+im\s+aufbau|hier\s+entsteht|under\s+construction|maintenance\s+mode|coming\s+soon|bald\s+(?:wieder\s+)?(?:online|verfügbar|verfuegbar)|wir\s+sind\s+bald\s+zurück|wir\s+sind\s+bald\s+zurueck)/i;
const PARKED_RE = /(domain\s+(?:for\s+sale|parking)|diese\s+domain\s+(?:steht\s+zum\s+verkauf|ist\s+registriert)|sedo\s+domain\s+parking|buy\s+this\s+domain|parkingcrew|hugedomains|afternic)/i;
const LEGACY_RE = /(microsoft\s+frontpage|frontpage\s+\d|xhtml\s+1\.0\s+transitional|frameset|adobe\s+golive|netobjects\s+fusion|generator[^>]{0,80}(?:frontpage|dreamweaver\s+(?:mx|cs[1-6]))|jquery[.-](?:1\.[0-9]|2\.0))/i;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: unknown) {
  return value === true || String(value || "").toLowerCase() === "true";
}

function cleanText(html: string) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromHtml(html: string) {
  return cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").slice(0, 220);
}

function h1FromHtml(html: string) {
  return cleanText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "").slice(0, 500);
}

function auditSnapshotText(audit: JsonObject) {
  const snapshot = asObject(audit.snapshot);
  const h1 = Array.isArray(snapshot.h1) ? snapshot.h1.map(String) : [];
  return [snapshot.title, ...h1].filter(Boolean).join(" ");
}

function maintenancePage(html: string) {
  const title = titleFromHtml(html);
  const h1 = h1FromHtml(html);
  if (MAINTENANCE_RE.test(`${title} ${h1}`)) return true;
  const text = cleanText(html);
  const words = text.split(/\s+/).filter(Boolean).length;
  return words > 0 && words <= 220 && MAINTENANCE_RE.test(text.slice(0, 6000));
}

function normalizeWebsite(value = "") {
  const raw = value.trim();
  if (!raw) return "";
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString();
  } catch {
    return raw;
  }
}

function domainFromWebsite(value = "") {
  try {
    return new URL(normalizeWebsite(value)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function companyKey(value = "") {
  return value
    .toLowerCase()
    .replace(/\b(gmbh|ug|haftungsbeschränkt|haftungsbeschraenkt|ag|kg|ohg|e\.?k\.?|mbh|gesellschaft|service|services)\b/g, " ")
    .replace(/[^a-zäöüß0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(a: string, b: string) {
  const aa = companyKey(a);
  const bb = companyKey(b);
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  if (aa.length >= 7 && bb.length >= 7 && (aa.includes(bb) || bb.includes(aa))) return true;
  const aw = new Set(aa.split(" ").filter((word) => word.length >= 4));
  const bw = new Set(bb.split(" ").filter((word) => word.length >= 4));
  if (!aw.size || !bw.size) return false;
  let shared = 0;
  for (const word of aw) if (bw.has(word)) shared += 1;
  return shared / Math.min(aw.size, bw.size) >= 0.75;
}

function isPrivateIp(ip: string) {
  const normalized = ip.toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (isIP(ip) === 6) {
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd");
  }
  return true;
}

async function assertPublicUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Nur öffentliche HTTP/HTTPS-Websites sind erlaubt.");
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Interner Host.");
  if (isIP(host) && isPrivateIp(host)) throw new Error("Private IP.");
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) throw new Error("Nicht öffentliche Zieladresse.");
}

async function fetchHtml(rawUrl: string): Promise<HtmlSnapshot> {
  let current = new URL(normalizeWebsite(rawUrl));
  const started = Date.now();
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      redirect: "manual",
      cache: "no-store",
      headers: {
        "user-agent": "DigitaleGewinner-WebsiteSalesIntelligence/1.2",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect ${response.status} ohne Ziel`);
      current = new URL(location, current);
      continue;
    }
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) throw new Error(`Kein HTML (${response.status})`);
    const html = (await response.text()).slice(0, 2_500_000);
    return { html, url: current.toString(), statusCode: response.status, responseMs: Date.now() - started };
  }
  throw new Error("Zu viele Redirects");
}

function wordSet(text: string) {
  const words = text
    .toLowerCase()
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/[^a-zäöüß0-9]+/gi, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4)
    .slice(0, 1800);
  return new Set(words);
}

function similarity(a: string, b: string) {
  const aa = wordSet(a);
  const bb = wordSet(b);
  if (aa.size < 15 || bb.size < 15) return 0;
  let intersection = 0;
  for (const word of aa) if (bb.has(word)) intersection += 1;
  const union = aa.size + bb.size - intersection;
  return union ? intersection / union : 0;
}

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
}

async function waybackClosest(rawUrl: string, daysAgo: number) {
  const target = normalizeWebsite(rawUrl);
  const endpoint = `https://archive.org/wayback/available?url=${encodeURIComponent(target)}&timestamp=${isoDaysAgo(daysAgo)}`;
  try {
    const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(6_000), headers: { "user-agent": "DigitaleGewinner-WebsiteSalesIntelligence/1.2" } });
    if (!response.ok) return null;
    const json = await response.json() as { archived_snapshots?: { closest?: { available?: boolean; timestamp?: string; url?: string; status?: string } } };
    const closest = json.archived_snapshots?.closest;
    if (!closest?.available || !closest.timestamp || !closest.url) return null;
    const rawArchiveUrl = `https://web.archive.org/web/${closest.timestamp}id_/${target}`;
    const archived = await fetch(rawArchiveUrl, { cache: "no-store", signal: AbortSignal.timeout(8_000), headers: { "user-agent": "DigitaleGewinner-WebsiteSalesIntelligence/1.2" } });
    if (!archived.ok) return null;
    const html = (await archived.text()).slice(0, 2_000_000);
    return { timestamp: closest.timestamp, html };
  } catch {
    return null;
  }
}

function dateFromWaybackTimestamp(value: string) {
  if (!/^\d{8,14}$/.test(value)) return "";
  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  return `${year}-${month}-${day}T00:00:00.000Z`;
}

function noWebsiteSourceVerified(row: Candidate) {
  const discoverySource = String(row.metadata?.discovery_source || "").toLowerCase();
  const source = String(row.source || "").toLowerCase();
  return source.includes("google-places") || discoverySource.includes("google-places") || bool(row.metadata?.no_website_verified);
}

function storedClassification(row: Candidate): WebsiteSalesIntelligence {
  const audit = asObject(row.audit);
  const metrics = asObject(audit.metrics);
  const scores = asObject(audit.scores);
  const snapshotText = auditSnapshotText(audit);
  const checkedAt = new Date().toISOString();
  const website = normalizeWebsite(row.website || "");
  const overall = num(scores.overall, row.website_score);
  const conversion = num(scores.conversion, overall);
  const trust = num(scores.trust, overall);
  const technical = num(scores.technical, overall);
  const content = num(scores.content, overall);
  const statusCode = num(audit.statusCode, 0);
  const copyrightAge = num(metrics.copyrightAgeYears, 0);
  const stale10y = bool(metrics.copyrightIsStale10y) || copyrightAge >= 10;
  const currentMaintenance = MAINTENANCE_RE.test(snapshotText);
  const parked = PARKED_RE.test(snapshotText);
  const lowSubscores = [conversion, trust, technical, content].filter((score) => score > 0 && score < 45).length;
  const noViewport = metrics.hasViewport === false;

  if (!website) {
    const verified = noWebsiteSourceVerified(row);
    return {
      version: 1, checkedAt, category: "no_website", strongIntent: verified, confidence: verified ? 94 : 45, score: verified ? 100 : 35,
      label: verified ? "Keine Website im Unternehmensprofil bestätigt" : "Keine Website in Datenquelle · Gegenprüfung offen",
      evidence: verified ? ["Primärquelle führt keinen eigenen Webauftritt"] : ["Website-Feld fehlt, aber das beweist noch nicht, dass keine Website existiert"],
      maintenance: { current: false, confirmedDays: 0, oldestConfirmedAt: "", archiveChecks: 0 },
      history: { unchangedYears: 0, similarity: 0, comparedAt: "" },
      current: { statusCode: 0, responseMs: 0, title: "" },
    };
  }

  if (parked) {
    return {
      version: 1, checkedAt, category: "parked", strongIntent: true, confidence: 97, score: 98,
      label: "Domain geparkt / keine echte Website", evidence: ["Parking-/Domainverkaufs-Signal erkannt"],
      maintenance: { current: false, confirmedDays: 0, oldestConfirmedAt: "", archiveChecks: 0 },
      history: { unchangedYears: 0, similarity: 0, comparedAt: "" },
      current: { statusCode, responseMs: num(audit.responseMs), title: String(asObject(audit.snapshot).title || "") },
    };
  }

  if (currentMaintenance) {
    return {
      version: 1, checkedAt, category: "maintenance_now", strongIntent: false, confidence: 72, score: 82,
      label: "Aktuell Wartungsmodus / im Aufbau", evidence: ["Wartungs-/Im-Aufbau-Signal in Title/H1 erkannt", "Dauer noch nicht historisch bestätigt"],
      maintenance: { current: true, confirmedDays: 0, oldestConfirmedAt: "", archiveChecks: 0 },
      history: { unchangedYears: 0, similarity: 0, comparedAt: "" },
      current: { statusCode, responseMs: num(audit.responseMs), title: String(asObject(audit.snapshot).title || "") },
    };
  }

  if (statusCode >= 400) {
    return {
      version: 1, checkedAt, category: "broken", strongIntent: true, confidence: 94, score: 96,
      label: `Website technisch kaputt (${statusCode})`, evidence: [`HTTP ${statusCode} im letzten Audit`],
      maintenance: { current: false, confirmedDays: 0, oldestConfirmedAt: "", archiveChecks: 0 },
      history: { unchangedYears: 0, similarity: 0, comparedAt: "" },
      current: { statusCode, responseMs: num(audit.responseMs), title: String(asObject(audit.snapshot).title || "") },
    };
  }

  if (stale10y) {
    return {
      version: 1, checkedAt, category: "outdated", strongIntent: true, confidence: 88, score: 91,
      label: `Sehr alte Website-Signale (${copyrightAge || 10}+ Jahre)`, evidence: [`Copyright-/Alterssignal ${copyrightAge || 10}+ Jahre alt`],
      maintenance: { current: false, confirmedDays: 0, oldestConfirmedAt: "", archiveChecks: 0 },
      history: { unchangedYears: 0, similarity: 0, comparedAt: "" },
      current: { statusCode, responseMs: num(audit.responseMs), title: String(asObject(audit.snapshot).title || "") },
    };
  }

  const strongBad = overall > 0 && (overall <= 45 || (overall <= 58 && lowSubscores >= 2) || (overall <= 62 && noViewport));
  if (strongBad) {
    const evidence = [`Website-Score ${Math.round(overall)}/100`];
    if (lowSubscores >= 2) evidence.push(`${lowSubscores} Kernbereiche unter 45/100`);
    if (noViewport) evidence.push("Mobile Viewport fehlt");
    return {
      version: 1, checkedAt, category: "bad_website", strongIntent: true, confidence: overall <= 45 ? 91 : 82, score: overall <= 45 ? 92 : 84,
      label: "Nachweislich schwache Website", evidence,
      maintenance: { current: false, confirmedDays: 0, oldestConfirmedAt: "", archiveChecks: 0 },
      history: { unchangedYears: 0, similarity: 0, comparedAt: "" },
      current: { statusCode, responseMs: num(audit.responseMs), title: String(asObject(audit.snapshot).title || "") },
    };
  }

  return {
    version: 1, checkedAt, category: overall ? "healthy" : "unknown", strongIntent: false, confidence: overall ? 80 : 40, score: overall ? Math.max(0, 70 - overall) : 20,
    label: overall ? "Kein starker Website-Verkaufsgrund" : "Noch nicht ausreichend geprüft",
    evidence: overall ? [`Website-Score ${Math.round(overall)}/100 reicht allein nicht als Verkaufsgrund`] : ["Kein belastbarer Website-Audit vorhanden"],
    maintenance: { current: false, confirmedDays: 0, oldestConfirmedAt: "", archiveChecks: 0 },
    history: { unchangedYears: 0, similarity: 0, comparedAt: "" },
    current: { statusCode, responseMs: num(audit.responseMs), title: String(asObject(audit.snapshot).title || "") },
  };
}

async function verifyNoWebsite(row: Candidate, base: WebsiteSalesIntelligence): Promise<WebsiteSalesIntelligence> {
  const checkedAt = new Date().toISOString();
  try {
    const discovery = await discoverBusinesses({
      query: `${row.company} ${row.city}`.trim(),
      pageSize: 8,
      locationHint: row.city || undefined,
    });
    const match = discovery.leads
      .filter((item) => namesMatch(row.company, item.company))
      .sort((a, b) => Number(Boolean(b.website)) - Number(Boolean(a.website)))[0];

    if (match?.website) {
      const website = normalizeWebsite(match.website);
      const domain = domainFromWebsite(website);
      await query(
        `update sales_companies set website=$2,domain=case when $3<>'' then $3 else domain end,metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('website_recovered_from',$4),updated_at=now() where id=$1`,
        [row.company_id, website, domain, match.source],
      );
      return {
        ...base,
        checkedAt,
        category: "unknown",
        strongIntent: false,
        confidence: 96,
        score: 10,
        label: "Gegenprüfung hat eine Website gefunden",
        evidence: [`${match.source}: offizieller Webauftritt ${website} gefunden`, "Lead darf nicht als 'Keine Website' verkauft werden"],
      };
    }

    if (match && discovery.source === "google-places") {
      return {
        ...base,
        checkedAt,
        category: "no_website",
        strongIntent: true,
        confidence: 98,
        score: 100,
        label: "Keine Website nach Gegenprüfung bestätigt",
        evidence: ["Google Places Gegenprüfung: passendes Unternehmen gefunden, aber kein Website-Link vorhanden"],
      };
    }

    return {
      ...base,
      checkedAt,
      strongIntent: false,
      confidence: match ? 68 : 50,
      score: 35,
      label: "Keine Website · Gegenprüfung noch nicht belastbar",
      evidence: [match ? `${discovery.source}: passendes Unternehmen ohne Website-Feld, Quelle aber nicht stark genug` : "Kein sicherer Unternehmens-Match in der Gegenprüfung"],
    };
  } catch (error) {
    return {
      ...base,
      checkedAt,
      strongIntent: false,
      confidence: 40,
      score: 30,
      label: "Keine Website · Gegenprüfung fehlgeschlagen",
      evidence: [`Gegenprüfung fehlgeschlagen: ${error instanceof Error ? error.message : "unbekannter Fehler"}`],
    };
  }
}

async function deepClassification(row: Candidate, base: WebsiteSalesIntelligence): Promise<WebsiteSalesIntelligence> {
  if (!row.website || base.category === "no_website") return verifyNoWebsite(row, base);
  const checkedAt = new Date().toISOString();
  let live: HtmlSnapshot;
  try {
    live = await fetchHtml(row.website);
  } catch (error) {
    const previouslyBroken = base.category === "broken" && base.current.statusCode >= 400;
    if (previouslyBroken) {
      return {
        ...base,
        checkedAt,
        strongIntent: true,
        confidence: 92,
        score: 95,
        label: base.label || "Website mehrfach nicht erreichbar",
        evidence: [...base.evidence, `Erneuter Live-Check fehlgeschlagen: ${error instanceof Error ? error.message : "nicht erreichbar"}`].slice(0, 5),
      };
    }
    return {
      ...base,
      checkedAt,
      category: "unknown",
      strongIntent: false,
      confidence: 52,
      score: 35,
      label: "Live-Check einmalig fehlgeschlagen · nicht als kaputt gewertet",
      evidence: [`Ein einzelner technischer Fehler reicht nicht als Verkaufssignal: ${error instanceof Error ? error.message : "Live-Check fehlgeschlagen"}`],
    };
  }

  const liveText = cleanText(live.html);
  const liveTitle = titleFromHtml(live.html);
  const maintenanceNow = maintenancePage(live.html);
  const parkedNow = PARKED_RE.test(`${liveTitle} ${liveText.slice(0, 6000)}`);
  const legacy = LEGACY_RE.test(live.html);

  if (live.statusCode >= 400) {
    return { ...base, checkedAt, category: "broken", strongIntent: true, confidence: 98, score: 99, label: `Website aktuell kaputt (${live.statusCode})`, evidence: [`Live-Check: HTTP ${live.statusCode}`], current: { statusCode: live.statusCode, responseMs: live.responseMs, title: liveTitle } };
  }
  if (parkedNow) {
    return { ...base, checkedAt, category: "parked", strongIntent: true, confidence: 99, score: 99, label: "Domain geparkt / keine echte Website", evidence: ["Live-Check erkennt Domain-Parking oder Verkaufsseite"], current: { statusCode: live.statusCode, responseMs: live.responseMs, title: liveTitle } };
  }

  const evidence = [...base.evidence];
  let confirmedDays = 0;
  let oldestConfirmedAt = "";
  let archiveChecks = 0;
  let unchangedYears = 0;
  let historySimilarity = 0;
  let comparedAt = "";

  const shouldCheckHistory = maintenanceNow || base.category === "outdated" || legacy || base.category === "bad_website";
  if (shouldCheckHistory) {
    const periods = maintenanceNow ? [90, 180, 365, 730] : [365, 730];
    for (const days of periods) {
      const archived = await waybackClosest(row.website, days);
      if (!archived) continue;
      archiveChecks += 1;
      const archivedText = cleanText(archived.html);
      const archivedAt = dateFromWaybackTimestamp(archived.timestamp);
      if (maintenanceNow && maintenancePage(archived.html)) {
        confirmedDays = Math.max(confirmedDays, days);
        oldestConfirmedAt = archivedAt || oldestConfirmedAt;
      }
      if (!maintenanceNow && archivedText) {
        const sim = similarity(liveText, archivedText);
        if (sim > historySimilarity) {
          historySimilarity = sim;
          comparedAt = archivedAt;
        }
        if (sim >= 0.88) unchangedYears = Math.max(unchangedYears, days >= 700 ? 2 : days >= 340 ? 1 : 0);
      }
    }
  }

  if (maintenanceNow) {
    if (confirmedDays >= 90) {
      evidence.length = 0;
      evidence.push("Wartungs-/Im-Aufbau-Seite aktuell bestätigt");
      evidence.push(`Historischer Snapshot zeigt denselben Zustand vor mindestens ${confirmedDays} Tagen`);
      return {
        ...base, checkedAt, category: "maintenance_long", strongIntent: true, confidence: confirmedDays >= 365 ? 99 : confirmedDays >= 180 ? 97 : 94,
        score: confirmedDays >= 365 ? 100 : 98,
        label: confirmedDays >= 365 ? "Seit mindestens 1 Jahr im Wartungsmodus" : confirmedDays >= 180 ? "Seit mindestens 6 Monaten im Wartungsmodus" : "Seit mindestens 3 Monaten im Wartungsmodus",
        evidence,
        maintenance: { current: true, confirmedDays, oldestConfirmedAt, archiveChecks },
        history: { unchangedYears: 0, similarity: 0, comparedAt: "" },
        current: { statusCode: live.statusCode, responseMs: live.responseMs, title: liveTitle },
      };
    }
    return {
      ...base, checkedAt, category: "maintenance_now", strongIntent: false, confidence: archiveChecks ? 78 : 68, score: 82,
      label: "Aktuell im Wartungsmodus · Dauer noch unbestätigt",
      evidence: ["Wartungs-/Im-Aufbau-Seite aktuell bestätigt", archiveChecks ? "Kein ≥3 Monate alter gleicher Wartungszustand bestätigt" : "Historie nicht verfügbar"],
      maintenance: { current: true, confirmedDays: 0, oldestConfirmedAt: "", archiveChecks },
      history: { unchangedYears: 0, similarity: 0, comparedAt: "" },
      current: { statusCode: live.statusCode, responseMs: live.responseMs, title: liveTitle },
    };
  }

  if (unchangedYears >= 2 || (unchangedYears >= 1 && (base.category === "outdated" || base.category === "bad_website" || legacy))) {
    const historyEvidence = unchangedYears >= 2 ? "Website-Inhalt seit mindestens ca. 2 Jahren nahezu unverändert" : "Website-Inhalt seit mindestens ca. 1 Jahr nahezu unverändert";
    return {
      ...base, checkedAt, category: "outdated", strongIntent: true, confidence: unchangedYears >= 2 ? 96 : 90, score: unchangedYears >= 2 ? 96 : 91,
      label: unchangedYears >= 2 ? "Seit Jahren praktisch unverändert" : "Seit mindestens 1 Jahr praktisch unverändert",
      evidence: [historyEvidence, ...(legacy ? ["Veraltete Technik-/Generator-Signale erkannt"] : []), ...base.evidence].slice(0, 5),
      maintenance: { current: false, confirmedDays: 0, oldestConfirmedAt: "", archiveChecks },
      history: { unchangedYears, similarity: Math.round(historySimilarity * 100) / 100, comparedAt },
      current: { statusCode: live.statusCode, responseMs: live.responseMs, title: liveTitle },
    };
  }

  if (legacy) {
    return {
      ...base, checkedAt, category: "outdated", strongIntent: true, confidence: 87, score: 89,
      label: "Deutlich veraltete Website-Technik", evidence: ["Legacy-Technik-/Generator-Signal im Live-HTML erkannt", ...base.evidence].slice(0, 5),
      maintenance: { current: false, confirmedDays: 0, oldestConfirmedAt: "", archiveChecks },
      history: { unchangedYears, similarity: Math.round(historySimilarity * 100) / 100, comparedAt },
      current: { statusCode: live.statusCode, responseMs: live.responseMs, title: liveTitle },
    };
  }

  return {
    ...base,
    checkedAt,
    maintenance: { current: false, confirmedDays: 0, oldestConfirmedAt: "", archiveChecks },
    history: { unchangedYears, similarity: Math.round(historySimilarity * 100) / 100, comparedAt },
    current: { statusCode: live.statusCode, responseMs: live.responseMs, title: liveTitle },
  };
}

function freshStrongExisting(row: Candidate) {
  const intel = asObject(row.metadata?.website_sales_intelligence);
  if (!bool(intel.strongIntent)) return null;
  const checked = Date.parse(String(intel.checkedAt || ""));
  if (!Number.isFinite(checked) || Date.now() - checked > 3 * 86_400_000) return null;
  const category = String(intel.category || "");
  if (!["maintenance_long", "outdated", "broken", "parked", "bad_website", "no_website"].includes(category)) return null;
  return intel as unknown as WebsiteSalesIntelligence;
}

async function candidates(workspace: string, limit?: number, staleOnly = false) {
  const values: unknown[] = [workspace];
  let limiter = "";
  if (limit) {
    values.push(limit);
    limiter = `limit $${values.length}`;
  }
  const stale = staleOnly ? `and (
    c.metadata->'website_sales_intelligence' is null
    or coalesce(c.metadata->'website_sales_intelligence'->>'checkedAt','')=''
    or (c.metadata->'website_sales_intelligence'->>'checkedAt')::timestamptz < now() - interval '3 days'
    or c.metadata->'website_sales_intelligence'->>'category' in ('maintenance_now','unknown','no_website')
  )` : "";
  return query<Candidate>(`
    select c.id company_id,l.id lead_id,c.name company,c.city,c.source,c.website,coalesce(ct.phone,c.phone,'') phone,c.metadata,
           coalesce(rr.website_score,0)::int website_score,coalesce(rr.audit,'{}'::jsonb) audit
    from sales_leads l
    join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
    left join sales_contacts ct on ct.id=l.contact_id
    left join lateral (
      select website_score,audit from sales_research_runs r
      where r.workspace=l.workspace and r.company_id=l.company_id
      order by r.created_at desc limit 1
    ) rr on true
    where l.workspace=$1 and l.status='active' ${stale}
    order by case when coalesce(c.website,'')='' then 0 else 1 end,l.priority_score desc,c.updated_at asc
    ${limiter}
  `, values);
}

async function persist(row: Candidate, intel: WebsiteSalesIntelligence, workspace: string) {
  await query(
    `update sales_companies set metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('website_sales_intelligence',$3::jsonb),updated_at=now()
     where id=$1 and workspace=$2`,
    [row.company_id, workspace, JSON.stringify(intel)],
  );
  await query(
    `update sales_opportunities set score=greatest(score,$3),next_action=case when coalesce(next_action,'')='' or next_action='Jetzt anrufen und Bedarf qualifizieren' then $4 else next_action end,updated_at=now()
     where workspace=$1 and company_id=$2 and product_key='website' and status='open'`,
    [workspace, row.company_id, intel.score, intel.strongIntent ? `Website-Hebel: ${intel.label}` : "Website-Verkaufsgrund weiter verifizieren"],
  );
}

export async function refreshStoredWebsiteSalesIntelligence(workspace = "default") {
  await ensureSalesOsSchema();
  const rows = await candidates(workspace);
  let strong = 0;
  const categories: Record<string, number> = {};
  for (const row of rows) {
    const preserved = freshStrongExisting(row);
    const intel = preserved || storedClassification(row);
    if (!preserved) await persist(row, intel, workspace);
    if (intel.strongIntent) strong += 1;
    categories[intel.category] = (categories[intel.category] || 0) + 1;
  }
  return { checked: rows.length, strong, categories };
}

export async function refreshDeepWebsiteSalesIntelligence(workspace = "default", limit = 10) {
  await ensureSalesOsSchema();
  const rows = await candidates(workspace, Math.max(1, Math.min(20, limit)), true);
  const results: WebsiteSalesIntelligence[] = [];
  for (const row of rows) {
    const base = storedClassification(row);
    const intel = await deepClassification(row, base);
    await persist(row, intel, workspace);
    results.push(intel);
  }
  return {
    checked: results.length,
    strong: results.filter((item) => item.strongIntent).length,
    maintenanceLong: results.filter((item) => item.category === "maintenance_long").length,
    outdated: results.filter((item) => item.category === "outdated").length,
    broken: results.filter((item) => item.category === "broken" || item.category === "parked").length,
  };
}

export async function getWebsiteSalesPipelineStats(workspace = "default") {
  await ensureSalesOsSchema();
  const rows = await query<{ category: string; count: number; value: number }>(`
    select coalesce(c.metadata->'website_sales_intelligence'->>'category','unknown') category,
           count(distinct l.id)::int count,
           coalesce(sum(case when o.id is not null and o.status='open' then o.setup_value + o.monthly_value*12 else 0 end),0)::float8 value
    from sales_leads l
    join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
    left join sales_opportunities o on o.workspace=l.workspace and o.lead_id=l.id and o.product_key='website'
    where l.workspace=$1 and l.status='active'
      and coalesce(c.metadata->'website_sales_intelligence'->>'strongIntent','false')='true'
    group by 1
  `, [workspace]);
  const by = new Map(rows.map((row) => [row.category, { count: Number(row.count || 0), value: Number(row.value || 0) }]));
  const sum = (...keys: string[]) => keys.reduce((acc, key) => ({ count: acc.count + (by.get(key)?.count || 0), value: acc.value + (by.get(key)?.value || 0) }), { count: 0, value: 0 });
  return {
    noWebsite: sum("no_website", "parked"),
    badWebsite: sum("maintenance_long", "outdated", "bad_website", "broken"),
    maintenanceLong: sum("maintenance_long"),
    outdated: sum("outdated"),
    broken: sum("broken", "parked"),
    strongTotal: rows.reduce((acc, row) => acc + Number(row.count || 0), 0),
  };
}
