import { fetchText } from "../lib.mjs";

// Social-Daten ohne Login: (1) optional ein Scraping-Anbieter (SOCIAL_SCRAPER_URL + SOCIAL_SCRAPER_KEY, POST {url} -> JSON),
// (2) sonst die öffentlichen Open-Graph-Tags, wie sie auch Link-Vorschauen nutzen. Kein eigenes Login-Scraping.
const og = (html, p) => html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']*)`, "i"))?.[1]?.trim() || "";

export function parseFollowers(text) {
  const m = text.match(/([\d.,]+)\s*([KkMm]|Mio\.?|Tsd\.?)?\s*(?:Follower|Abonnenten|Gefällt|likes|followers)/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  const u = (m[2] || "").toLowerCase();
  if (u === "k" || u.startsWith("tsd")) n *= 1e3; else if (u === "m" || u.startsWith("mio")) n *= 1e6;
  return Number.isFinite(n) ? Math.round(n) : null;
}

export async function enrichSocial(company, websiteData) {
  const links = websiteData?.social || {};
  const entries = Object.entries(links).filter(([k]) => ["facebook", "instagram", "linkedin", "youtube", "tiktok"].includes(k));
  if (!entries.length) return { status: "skipped", data: { reason: "keine Social-Links auf der Website" } };
  const out = {};
  for (const [network, url] of entries) {
    try {
      if (process.env.SOCIAL_SCRAPER_URL) {
        const r = await fetch(process.env.SOCIAL_SCRAPER_URL, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.SOCIAL_SCRAPER_KEY || ""}` }, body: JSON.stringify({ url, network }), signal: AbortSignal.timeout(30000) });
        out[network] = { url, via: "provider", ...(r.ok ? await r.json() : { error: `HTTP ${r.status}` }) };
        continue;
      }
      const page = await fetchText(url, { respectRobots: false });
      const description = og(page.text, "description");
      out[network] = { url, via: "og", title: og(page.text, "title"), description: description.slice(0, 300), followers: parseFollowers(`${og(page.text, "title")} ${description}`), limited: !page.ok || /log ?in|anmelden/i.test(og(page.text, "title")) };
    } catch (e) { out[network] = { url, error: String(e.message || e).slice(0, 120) }; }
  }
  return { status: "ok", data: out };
}
