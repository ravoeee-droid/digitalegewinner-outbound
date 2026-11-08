// Google Ads Transparency Center hat keine offizielle API. Wir nutzen SerpAPI (SERPAPI_KEY), sonst wird übersprungen.
export async function enrichGoogleAds(company) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return { status: "skipped", data: { reason: "SERPAPI_KEY fehlt" } };
  const domain = (company.domain || company.website || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (!domain) return { status: "skipped", data: { reason: "keine Domain" } };
  const params = new URLSearchParams({ engine: "google_ads_transparency_center", text: domain, region: "2276", api_key: key });
  const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(25000) });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || `SerpAPI HTTP ${res.status}`);
  const creatives = json.ad_creatives || [];
  const advertisers = [...new Set(creatives.map((c) => c.advertiser).filter(Boolean))].slice(0, 3);
  return { status: "ok", data: { runsAds: creatives.length > 0, adCreatives: creatives.length, advertisers, formats: [...new Set(creatives.map((c) => c.format).filter(Boolean))] } };
}
