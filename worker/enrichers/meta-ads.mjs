// Meta Ad Library (offizielle Graph API). Braucht META_ACCESS_TOKEN (App-ID|App-Secret) und bestätigte Identität.
const norm = (s) => s.toLowerCase().replace(/\b(gmbh|ug|ggmbh|gbr|e\.?\s?k\.?|ohg|kg|mbh|&|und|co|der|die|das)\b/g, " ").replace(/[^a-z0-9äöüß]+/g, " ").trim();

export function nameMatches(pageName, company) {
  const a = norm(pageName), b = norm(company);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const ta = new Set(a.split(" ")), tb = b.split(" ").filter((t) => t.length > 2);
  return tb.length > 0 && tb.filter((t) => ta.has(t)).length / tb.length >= 0.75;
}

export async function enrichMetaAds(company) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return { status: "skipped", data: { reason: "META_ACCESS_TOKEN fehlt" } };
  const params = new URLSearchParams({
    search_terms: company.name, ad_reached_countries: '["DE"]', ad_active_status: "ALL", limit: "50",
    fields: "id,page_id,page_name,ad_delivery_start_time,ad_delivery_stop_time,publisher_platforms", access_token: token,
  });
  const res = await fetch(`https://graph.facebook.com/v21.0/ads_archive?${params}`, { signal: AbortSignal.timeout(15000) });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Meta API HTTP ${res.status}`);
  const mine = (json.data || []).filter((a) => nameMatches(a.page_name || "", company.name));
  const active = mine.filter((a) => !a.ad_delivery_stop_time);
  const platforms = [...new Set(mine.flatMap((a) => a.publisher_platforms || []))];
  const starts = mine.map((a) => a.ad_delivery_start_time).filter(Boolean).sort();
  return { status: "ok", data: {
    runsAds: mine.length > 0, adsTotal: mine.length, adsActive: active.length, platforms,
    pageName: mine[0]?.page_name || "", pageId: mine[0]?.page_id || "", firstAdAt: starts[0] || null, lastAdAt: starts[starts.length - 1] || null,
  } };
}
