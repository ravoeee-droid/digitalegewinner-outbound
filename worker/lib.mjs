import pg from "pg";

export const log = (...a) => console.log(new Date().toISOString(), ...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gleiche Auswahl wie lib/db.ts der App: nach DB_CUTOVER gilt nur NEW_DATABASE_URL.
// Direkte Supabase-Hosts (db.<ref>.supabase.co) sind nur per IPv6 erreichbar; GitHub-Runner und viele VMs haben nur IPv4 -> Pooler wie in lib/db.ts.
export function poolerUrl(raw) {
  try {
    const url = new URL(raw);
    const m = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (!m) return raw;
    url.hostname = process.env.SUPABASE_POOLER_HOST || "aws-0-eu-central-1.pooler.supabase.com";
    url.port = process.env.SUPABASE_POOLER_PORT || "5432";
    url.username = `postgres.${m[1]}`;
    return url.toString();
  } catch { return raw; }
}
export function connectionString() {
  if (process.env.DB_CUTOVER === "1" && process.env.NEW_DATABASE_URL) return process.env.NEW_DATABASE_URL;
  const raw = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
  return raw ? poolerUrl(raw) : "";
}

let pool;
export function db() {
  if (!pool) {
    const cs = connectionString();
    if (!cs) throw new Error("Keine DATABASE_URL gesetzt.");
    pool = new pg.Pool({ connectionString: cs, max: 4, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}
export const query = async (text, params) => (await db().query(text, params)).rows;

// Höflichkeit: höchstens eine Anfrage pro Sekunde und Host, robots.txt wird beachtet.
const lastHit = new Map();
const robotsCache = new Map();
const UA = "DG-EnrichmentBot/1.0 (+B2B-Recherche; Abmeldung per Antwort auf unsere Mail)";

async function throttle(host) {
  const wait = (lastHit.get(host) || 0) + 1000 - Date.now();
  lastHit.set(host, Math.max(Date.now(), (lastHit.get(host) || 0) + 1000));
  if (wait > 0) await sleep(wait);
}

export function robotsAllows(txt, path) {
  let applies = false, allowed = true, bestLen = -1;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") applies = val === "*";
    else if (applies && (key === "disallow" || key === "allow") && val && path.startsWith(val) && val.length > bestLen) {
      bestLen = val.length; allowed = key === "allow";
    }
  }
  return allowed;
}

export async function fetchText(url, { timeoutMs = 12000, respectRobots = true } = {}) {
  const u = new URL(url);
  if (respectRobots) {
    if (!robotsCache.has(u.host)) {
      try {
        await throttle(u.host);
        const r = await fetch(`${u.protocol}//${u.host}/robots.txt`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(6000) });
        robotsCache.set(u.host, r.ok ? await r.text() : "");
      } catch { robotsCache.set(u.host, ""); }
    }
    if (!robotsAllows(robotsCache.get(u.host), u.pathname)) return { ok: false, status: 0, blocked: true, text: "", finalUrl: url };
  }
  await throttle(u.host);
  const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "de-DE,de;q=0.9", accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  const type = res.headers.get("content-type") || "";
  const text = /text\/html|xml|json|text\/plain/i.test(type) ? (await res.text()).slice(0, 600_000) : "";
  return { ok: res.ok, status: res.status, text, finalUrl: res.url };
}
