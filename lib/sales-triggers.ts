import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { query } from "./db";
import { ensureSalesOsSchema } from "./sales-os";

let triggerSchemaReady = false;

const MAX_BYTES = 1_000_000;
const MAX_PAGES = 4;
const MAX_REDIRECTS = 4;
const USER_AGENT = "DigitaleGewinner-SalesTriggerRadar/1.0";

export type TriggerKind =
  | "jobs"
  | "career_page"
  | "location"
  | "service"
  | "announcement"
  | "contact"
  | "site_change";

export type SalesSignal = {
  kind: TriggerKind;
  weight: number;
  title: string;
  detail: string;
  evidence: string[];
  fingerprint: string;
};

type Snapshot = {
  capturedAt: string;
  finalUrl: string;
  hash: string;
  title: string;
  h1: string[];
  headings: string[];
  pages: string[];
  links: string[];
  textLength: number;
  markers: {
    jobs: string[];
    career: string[];
    locations: string[];
    services: string[];
    announcements: string[];
    contacts: string[];
  };
};

type CompanyRow = {
  id: string;
  workspace: string;
  name: string;
  website: string;
  lead_id: string;
  intent_score: number;
  fit_score: number;
  opportunity_score: number;
  email: string;
  phone: string;
  linkedin: string;
  instagram: string;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function decode(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanHtml(value: string) {
  return normalizeText(
    decode(
      value
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function uniq(values: string[], max = 30) {
  return [...new Set(values.map(normalizeText).filter(Boolean))].slice(0, max);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function privateIp(ip: string) {
  const value = ip.toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (isIP(ip) === 6) return value === "::1" || value === "::" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd");
  return true;
}

async function assertPublicUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Ungültige Website-URL.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Interne Hosts sind nicht erlaubt.");
  if (isIP(host) && privateIp(host)) throw new Error("Private Zieladresse ist nicht erlaubt.");
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => privateIp(entry.address))) throw new Error("Website ist nicht öffentlich erreichbar.");
}

function normalizeUrl(raw: string) {
  const value = raw.trim();
  if (!value) throw new Error("Website fehlt.");
  return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
}

function siteHost(host: string) {
  return host.toLowerCase().replace(/^www\./, "");
}

function sameSite(a: string, b: string) {
  return siteHost(a) === siteHost(b);
}

async function getHtml(input: URL) {
  let url = new URL(input);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicUrl(url);
    const response = await fetch(url, {
      redirect: "manual",
      cache: "no-store",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(9_000),
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
    if (declared > MAX_BYTES) throw new Error("Website-Seite zu groß.");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) throw new Error("Website-Seite zu groß.");
    return { html: new TextDecoder().decode(bytes), url };
  }
  throw new Error("Zu viele Weiterleitungen.");
}

function tagText(html: string, tag: string, max = 25) {
  const values: string[] = [];
  const expression = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  for (const match of html.matchAll(expression)) {
    const value = cleanHtml(match[1] || "");
    if (value) values.push(value);
    if (values.length >= max) break;
  }
  return uniq(values, max);
}

function extractPage(html: string, base: URL) {
  const title = cleanHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const h1 = tagText(html, "h1", 8);
  const headings = uniq([...h1, ...tagText(html, "h2", 20), ...tagText(html, "h3", 20)], 40);
  const text = cleanHtml(html);
  const links: Array<{ url: string; label: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(match[1], base);
      if (!sameSite(url.hostname, base.hostname) || !["http:", "https:"].includes(url.protocol)) continue;
      links.push({ url: url.toString(), label: cleanHtml(match[2] || "") });
    } catch {}
  }
  return { title, h1, headings, text, links };
}

function markerValues(values: string[], pattern: RegExp, max = 20) {
  return uniq(values.filter((value) => pattern.test(value)), max);
}

function buildMarkers(headings: string[], linkLabels: string[], text: string) {
  const candidates = uniq([...headings, ...linkLabels], 120);
  const textFragments = uniq(text.split(/[.!?·|]/).map(normalizeText).filter((v) => v.length >= 12 && v.length <= 180), 180);
  const all = uniq([...candidates, ...textFragments], 240);
  return {
    jobs: markerValues(all, /\b(stelle|stellenangebot|job|jobs|karriere|mitarbeiter gesucht|wir suchen|bewerb|fachkraft|azubi|ausbildung)\b/i),
    career: markerValues(candidates, /\b(karriere|jobs?|stellenangebote?|bewerben|arbeiten bei|komm ins team)\b/i),
    locations: markerValues(all, /\b(neuer standort|neue niederlassung|niederlassung|filiale|standort eröffnet|eröffnung|expandier|expansion)\b/i),
    services: markerValues(headings, /\b(leistung|service|angebot|lösung|beratung|planung|installation|montage|wartung|sanierung|pv|photovoltaik|wärmepumpe|recruiting|webdesign|marketing)\b/i),
    announcements: markerValues(all, /\b(neu|jetzt neu|eröffnet|erweiter|wachstum|zertifiziert|auszeichnung|partnerschaft|partner geworden|launch|startet)\b/i),
    contacts: markerValues(all, /(?:\+?\d[\d\s()\/-]{7,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i),
  };
}

export async function captureWebsiteSnapshot(rawUrl: string): Promise<Snapshot> {
  const start = normalizeUrl(rawUrl);
  const first = await getHtml(start);
  const root = first.url;
  const queue = [root.toString()];
  const prefetched = new Map([[root.toString(), first.html]]);
  const visited = new Set<string>();
  const pages: string[] = [];
  const allHeadings: string[] = [];
  const allLinks: string[] = [];
  const allLabels: string[] = [];
  const textParts: string[] = [];
  let title = "";
  let h1: string[] = [];

  while (queue.length && visited.size < MAX_PAGES) {
    const raw = queue.shift()!;
    if (visited.has(raw)) continue;
    visited.add(raw);
    try {
      const requested = new URL(raw);
      if (!sameSite(requested.hostname, root.hostname)) continue;
      const fetched = prefetched.has(raw) ? { html: prefetched.get(raw)!, url: requested } : await getHtml(requested);
      if (!sameSite(fetched.url.hostname, root.hostname)) continue;
      const page = extractPage(fetched.html, fetched.url);
      if (!title) title = page.title;
      if (!h1.length) h1 = page.h1;
      pages.push(fetched.url.toString());
      allHeadings.push(...page.headings);
      textParts.push(page.text.slice(0, 25_000));
      for (const link of page.links) {
        allLinks.push(link.url);
        if (link.label) allLabels.push(link.label);
        const hint = `${link.url} ${link.label}`;
        if (/karriere|career|jobs?|stellen|aktuelles|news|leistungen|services|standort|unternehmen|about/i.test(hint) && !visited.has(link.url) && queue.length + visited.size < MAX_PAGES + 4) queue.push(link.url);
      }
    } catch {}
  }

  const headings = uniq(allHeadings, 60);
  const links = uniq(allLinks, 80);
  const text = normalizeText(textParts.join(" "));
  const markers = buildMarkers(headings, uniq(allLabels, 100), text);
  const canonical = JSON.stringify({ title, h1, headings, pages: pages.map((p) => new URL(p).pathname).sort(), markers });
  return {
    capturedAt: new Date().toISOString(),
    finalUrl: root.toString(),
    hash: digest(canonical),
    title,
    h1,
    headings,
    pages,
    links,
    textLength: text.length,
    markers,
  };
}

function added(before: string[] = [], after: string[] = []) {
  const prior = new Set(before.map((v) => v.toLowerCase()));
  return after.filter((value) => !prior.has(value.toLowerCase()));
}

function makeSignal(kind: TriggerKind, weight: number, title: string, detail: string, evidence: string[]): SalesSignal {
  const safeEvidence = uniq(evidence, 6);
  return { kind, weight, title, detail, evidence: safeEvidence, fingerprint: digest(`${kind}|${title}|${safeEvidence.join("|")}`).slice(0, 32) };
}

export function detectSalesSignals(previous: Snapshot, current: Snapshot): SalesSignal[] {
  const signals: SalesSignal[] = [];
  const jobs = added(previous.markers.jobs, current.markers.jobs);
  const career = added(previous.markers.career, current.markers.career);
  const locations = added(previous.markers.locations, current.markers.locations);
  const services = added(previous.markers.services, current.markers.services);
  const announcements = added(previous.markers.announcements, current.markers.announcements);
  const contacts = added(previous.markers.contacts, current.markers.contacts);
  const pathsBefore = new Set(previous.pages.map((p) => { try { return new URL(p).pathname.toLowerCase(); } catch { return p.toLowerCase(); } }));
  const newCareerPages = current.pages.filter((p) => {
    try { const path = new URL(p).pathname.toLowerCase(); return !pathsBefore.has(path) && /karriere|career|jobs?|stellen|bewerb/.test(path); } catch { return false; }
  });

  if (jobs.length) signals.push(makeSignal("jobs", 32, "Neue Recruiting-Aktivität", "Auf der Website sind neue Stellen-/Recruiting-Hinweise aufgetaucht.", jobs));
  if (newCareerPages.length || career.length) signals.push(makeSignal("career_page", 26, "Karrierebereich verändert", "Ein Karriere-/Jobbereich ist neu oder wurde sichtbar erweitert.", [...newCareerPages, ...career]));
  if (locations.length) signals.push(makeSignal("location", 38, "Expansionssignal erkannt", "Hinweise auf einen neuen Standort, eine Niederlassung oder Expansion wurden erkannt.", locations));
  if (services.length) signals.push(makeSignal("service", 22, "Leistungsangebot verändert", "Neue oder geänderte Leistungs-/Service-Hinweise wurden erkannt.", services));
  if (announcements.length) signals.push(makeSignal("announcement", 18, "Aktuelles Unternehmenssignal", "Neue Wachstums-, Launch-, Partner- oder Unternehmenshinweise wurden erkannt.", announcements));
  if (contacts.length) signals.push(makeSignal("contact", 10, "Neue Kontaktdaten erkannt", "Auf der Website sind neue öffentliche Kontakthinweise aufgetaucht.", contacts));

  const previousHeadingSet = new Set(previous.headings.map((v) => v.toLowerCase()));
  const newHeadings = current.headings.filter((v) => !previousHeadingSet.has(v.toLowerCase()));
  const lengthDelta = previous.textLength ? Math.abs(current.textLength - previous.textLength) / previous.textLength : 0;
  if (!signals.length && current.hash !== previous.hash && (newHeadings.length >= 3 || lengthDelta >= 0.2 || current.title !== previous.title)) {
    signals.push(makeSignal("site_change", 12, "Größere Website-Änderung", "Die Unternehmenswebsite hat sich strukturell deutlich verändert.", newHeadings.slice(0, 6)));
  }
  return signals;
}

export async function ensureTriggerSchema() {
  if (triggerSchemaReady) return;
  await ensureSalesOsSchema();
  await query(`
    create table if not exists sales_monitors (
      id text primary key,
      workspace text not null,
      company_id text not null references sales_companies(id) on delete cascade,
      active boolean not null default true,
      interval_minutes integer not null default 720,
      next_check_at timestamptz not null default now(),
      last_checked_at timestamptz,
      last_hash text not null default '',
      check_count integer not null default 0,
      last_error text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index if not exists sales_monitors_company_idx on sales_monitors(workspace,company_id);
    create index if not exists sales_monitors_due_idx on sales_monitors(workspace,active,next_check_at);

    create table if not exists sales_trigger_snapshots (
      id text primary key,
      workspace text not null,
      company_id text not null references sales_companies(id) on delete cascade,
      hash text not null,
      snapshot jsonb not null,
      created_at timestamptz not null default now()
    );
    create index if not exists sales_trigger_snapshots_company_idx on sales_trigger_snapshots(workspace,company_id,created_at desc);

    create table if not exists sales_triggers (
      id text primary key,
      workspace text not null,
      company_id text not null references sales_companies(id) on delete cascade,
      lead_id text,
      kind text not null,
      weight integer not null default 0,
      title text not null,
      detail text not null,
      fingerprint text not null,
      evidence jsonb not null default '[]'::jsonb,
      status text not null default 'active',
      detected_at timestamptz not null default now()
    );
    create index if not exists sales_triggers_company_idx on sales_triggers(workspace,company_id,detected_at desc);
    create unique index if not exists sales_triggers_fingerprint_idx on sales_triggers(workspace,company_id,fingerprint);
  `);
  triggerSchemaReady = true;
}

export async function ensureWebsiteMonitors(workspace = "default") {
  await ensureTriggerSchema();
  const rows = await query<{ company_id: string }>(
    `select c.id as company_id from sales_companies c
     join sales_leads l on l.company_id=c.id and l.workspace=c.workspace and l.status='active'
     where c.workspace=$1 and c.website<>''`,
    [workspace],
  );
  for (const row of rows) {
    await query(
      `insert into sales_monitors(id,workspace,company_id) values($1,$2,$3)
       on conflict(workspace,company_id) do update set active=true,updated_at=now()`,
      [`monitor:${row.company_id}`, workspace, row.company_id],
    );
  }
  return rows.length;
}

async function companyForScan(companyId: string, workspace: string) {
  const rows = await query<CompanyRow>(
    `select c.id,c.workspace,c.name,c.website,l.id as lead_id,l.intent_score,l.fit_score,l.opportunity_score,
            coalesce(ct.email,'') as email,coalesce(ct.phone,c.phone,'') as phone,
            coalesce(ct.linkedin,'') as linkedin,coalesce(ct.instagram,'') as instagram
     from sales_companies c
     join sales_leads l on l.company_id=c.id and l.workspace=c.workspace and l.status='active'
     left join sales_contacts ct on ct.id=l.contact_id
     where c.workspace=$1 and c.id=$2 limit 1`,
    [workspace, companyId],
  );
  return rows[0];
}

function contactability(company: CompanyRow) {
  return clamp((company.email ? 45 : 0) + (company.phone ? 30 : 0) + (company.linkedin ? 15 : 0) + (company.instagram ? 10 : 0));
}

function triggerPriority(company: CompanyRow, intentScore: number) {
  const contactScore = contactability(company);
  return clamp(company.opportunity_score * 0.35 + company.fit_score * 0.25 + contactScore * 0.15 + intentScore * 0.25);
}

async function refreshIntent(company: CompanyRow, workspace: string) {
  const [row] = await query<{ total: number }>(
    `select coalesce(sum(weight),0)::int as total from sales_triggers
     where workspace=$1 and company_id=$2 and status='active' and detected_at>=now()-interval '30 days'`,
    [workspace, company.id],
  );
  const intentScore = clamp(Number(row?.total || 0));
  const priorityScore = triggerPriority(company, intentScore);
  await query("update sales_leads set intent_score=$3,priority_score=$4,updated_at=now() where workspace=$1 and id=$2", [workspace, company.lead_id, intentScore, priorityScore]);
  await query("update sales_companies set latest_score=$3,updated_at=now() where workspace=$1 and id=$2", [workspace, company.id, priorityScore]);
  return { intentScore, priorityScore };
}

export async function scanCompanyTriggers(companyId: string, workspace = "default") {
  await ensureTriggerSchema();
  const company = await companyForScan(companyId, workspace);
  if (!company) throw new Error("Firma oder aktiver Lead nicht gefunden.");
  if (!company.website) throw new Error("Firma hat keine Website.");
  await query(
    `insert into sales_monitors(id,workspace,company_id) values($1,$2,$3)
     on conflict(workspace,company_id) do update set active=true,updated_at=now()`,
    [`monitor:${company.id}`, workspace, company.id],
  );

  try {
    const snapshot = await captureWebsiteSnapshot(company.website);
    const previousRows = await query<{ snapshot: Snapshot; hash: string }>(
      `select snapshot,hash from sales_trigger_snapshots where workspace=$1 and company_id=$2 order by created_at desc limit 1`,
      [workspace, company.id],
    );
    const previous = previousRows[0]?.snapshot;
    const unchanged = previousRows[0]?.hash === snapshot.hash;
    const signals = previous && !unchanged ? detectSalesSignals(previous, snapshot) : [];

    if (!unchanged) {
      await query(
        `insert into sales_trigger_snapshots(id,workspace,company_id,hash,snapshot) values($1,$2,$3,$4,$5::jsonb)`,
        [crypto.randomUUID(), workspace, company.id, snapshot.hash, JSON.stringify(snapshot)],
      );
    }

    let created = 0;
    for (const signal of signals) {
      const result = await query<{ id: string }>(
        `insert into sales_triggers(id,workspace,company_id,lead_id,kind,weight,title,detail,fingerprint,evidence)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
         on conflict(workspace,company_id,fingerprint) do nothing returning id`,
        [crypto.randomUUID(), workspace, company.id, company.lead_id, signal.kind, signal.weight, signal.title, signal.detail, signal.fingerprint, JSON.stringify(signal.evidence)],
      );
      if (result.length) {
        created += 1;
        await query(
          `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
           values($1,$2,$3,'trigger.detected',$4,$5::jsonb)`,
          [workspace, company.lead_id, company.id, `⚡ ${signal.title} · +${signal.weight} Intent`, JSON.stringify(signal)],
        );
      }
    }

    const scores = await refreshIntent(company, workspace);
    await query(
      `update sales_monitors set last_checked_at=now(),next_check_at=now()+(interval '1 minute' * interval_minutes),last_hash=$3,check_count=check_count+1,last_error='',updated_at=now()
       where workspace=$1 and company_id=$2`,
      [workspace, company.id, snapshot.hash],
    );
    return { companyId: company.id, company: company.name, baseline: !previous, unchanged, signals, created, ...scores };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Trigger Scan fehlgeschlagen";
    await query(
      `update sales_monitors set last_checked_at=now(),next_check_at=now()+interval '2 hours',last_error=$3,check_count=check_count+1,updated_at=now()
       where workspace=$1 and company_id=$2`,
      [workspace, company.id, message],
    );
    throw error;
  }
}

export async function scanDueCompanies(workspace = "default", limit = 4) {
  await ensureWebsiteMonitors(workspace);
  const due = await query<{ company_id: string }>(
    `select company_id from sales_monitors where workspace=$1 and active=true and next_check_at<=now() order by next_check_at asc limit $2`,
    [workspace, Math.max(1, Math.min(10, limit))],
  );
  const results: Array<Record<string, unknown>> = [];
  for (const row of due) {
    try { results.push(await scanCompanyTriggers(row.company_id, workspace)); }
    catch (error) { results.push({ companyId: row.company_id, error: error instanceof Error ? error.message : "Scan fehlgeschlagen" }); }
  }
  return { due: due.length, results };
}

export async function getTriggerOverview(workspace = "default") {
  await ensureWebsiteMonitors(workspace);
  const [stats] = await query<{ monitors: number; due: number; signals_24h: number; hot_signals: number }>(
    `select
      count(*)::int as monitors,
      count(*) filter(where next_check_at<=now())::int as due,
      (select count(*)::int from sales_triggers where workspace=$1 and detected_at>=now()-interval '24 hours') as signals_24h,
      (select count(*)::int from sales_triggers where workspace=$1 and weight>=30 and detected_at>=now()-interval '30 days') as hot_signals
     from sales_monitors where workspace=$1 and active=true`,
    [workspace],
  );
  const triggers = await query<{
    id: string; company: string; lead_id: string; kind: string; weight: number; title: string; detail: string; evidence: string[]; detected_at: string;
  }>(
    `select t.id,c.name as company,t.lead_id,t.kind,t.weight,t.title,t.detail,t.evidence,t.detected_at
     from sales_triggers t join sales_companies c on c.id=t.company_id
     where t.workspace=$1 and t.status='active'
     order by t.detected_at desc,t.weight desc limit 20`,
    [workspace],
  );
  return { stats: stats || { monitors: 0, due: 0, signals_24h: 0, hot_signals: 0 }, triggers };
}
