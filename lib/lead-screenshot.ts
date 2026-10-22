// Screenshot der Website eines Leads für die persönliche Videoseite (/v/<token>): Chromium auf dem Server, Ablage als Bild in der Datenbank.
import sharp from "sharp";
import { query } from "@/lib/db";

const FREEMAIL = /^(gmail|googlemail|gmx|web|t-online|outlook|hotmail|live|yahoo|icloud|me|arcor|freenet|posteo|mail|aol|online|1und1|email|protonmail|proton|kabelmail)\./i;
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)/i;

export async function ensureScreenshotTable() {
  await query(`create table if not exists lead_screenshots (
    lead_id text primary key, url text, status text not null default 'ok', data bytea, error text, created_at timestamptz not null default now())`);
}

export function safeWebsite(raw: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(url.protocol) || PRIVATE_HOST.test(url.hostname) || !url.hostname.includes(".")) return "";
    return url.origin;
  } catch { return ""; }
}

export function websiteFor(website: string, email: string) {
  const direct = safeWebsite(website || "");
  if (direct) return direct;
  const domain = (email.split("@")[1] || "").toLowerCase();
  return domain && !FREEMAIL.test(domain) ? safeWebsite(domain) : "";
}

const HIDE_BANNERS = `
  [id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="cmp" i],[class*="cmp-" i],[class*="borlabs" i],[id*="usercentrics" i],[class*="onetrust" i],[id*="onetrust" i],[aria-label*="cookie" i],[class*="privacy-banner" i]
  { display: none !important; }
  html, body { overflow: hidden !important; }
`;

type Browser = Awaited<ReturnType<typeof launch>>;
export async function launch() {
  const { chromium: pw } = await import("playwright-core");
  const local = process.env.CHROMIUM_PATH;
  if (local) return pw.launch({ executablePath: local, headless: true });
  const sparticuz = (await import("@sparticuz/chromium")).default;
  return pw.launch({ executablePath: await sparticuz.executablePath(), args: sparticuz.args, headless: true });
}

export async function capture(browser: Browser, website: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "de-DE", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" });
  try {
    const page = await context.newPage();
    await page.goto(website, { timeout: 20_000, waitUntil: "domcontentloaded" });
    await page.addStyleTag({ content: HIDE_BANNERS }).catch(() => null);
    await page.waitForTimeout(2_500);
    const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1440, height: 900 } });
    const jpg = await sharp(png).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
    // Fast leere oder einfarbige Seiten (Fehlerseiten, Ladebildschirme) sind kein brauchbarer Screenshot.
    const { channels } = await sharp(png).resize(64, 40).stats();
    const spread = Math.max(...channels.map((channel) => channel.stdev));
    if (spread < 8) return null;
    return jpg;
  } finally { await context.close().catch(() => null); }
}

export async function loadScreenshot(leadId: string) {
  const [row] = await query<{ data: Buffer | null }>("select data from lead_screenshots where lead_id=$1 and status='ok'", [leadId]).catch(() => []);
  return row?.data || null;
}

export async function hasScreenshot(leadId: string) {
  const [row] = await query("select 1 from lead_screenshots where lead_id=$1 and status='ok'", [leadId]).catch(() => []);
  return Boolean(row);
}

export async function screenshotReadySet(leadIds: string[]) {
  if (!leadIds.length) return new Set<string>();
  const rows = await query<{ lead_id: string }>("select lead_id from lead_screenshots where status='ok' and lead_id=any($1::text[])", [leadIds]).catch(() => []);
  return new Set(rows.map((row) => row.lead_id));
}

// Nächste Leads, die als Nächstes in die Warteschlange kommen (gleiche Reihenfolge wie die Kampagnen-Planung) und noch keinen Screenshot haben.
export async function screenshotCandidates(limit: number) {
  return query<{ lead_id: string; website: string; email: string }>(`
    select l.id::text lead_id, coalesce(c.website,'') website, ct.email
    from sales_leads l
    join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
    join sales_contacts ct on ct.id=l.contact_id and ct.workspace=l.workspace
    left join lead_screenshots s on s.lead_id=l.id::text
    where l.workspace='default' and l.status='active' and l.stage in ('Neu','Research','Bereit')
      and coalesce(l.do_not_contact,false)=false and coalesce(ct.email,'')<>''
      and lower(coalesce(c.source,''))=any(array['ba-jobboerse','ba-pv'])
      and s.lead_id is null
      and not exists(select 1 from er_outbox o where o.workspace='default' and o.lead_id=l.id::text and o.status not in ('failed','suppressed'))
    order by l.priority_score desc, l.updated_at desc
    limit $1`, [limit]);
}
