export type AdCheckStatus = "active" | "likely" | "none" | "unknown";

export type AdIntelligence = {
  checkedAt: string;
  marketing: {
    metaPixel: boolean;
    googleAdsTag: boolean;
    googleAnalyticsOrGtm: boolean;
    tiktokPixel: boolean;
    linkedinInsight: boolean;
    microsoftAds: boolean;
  };
  meta: { status: AdCheckStatus; url: string; evidence: string };
  google: { status: AdCheckStatus; url: string; evidence: string };
  signals: string[];
};

function domainFromWebsite(value: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function trackingFlags(tools: string[]) {
  const joined = tools.join(" | ").toLowerCase();
  return {
    metaPixel: joined.includes("meta pixel"),
    googleAdsTag: joined.includes("google ads"),
    googleAnalyticsOrGtm: joined.includes("google analytics") || joined.includes("gtm"),
    tiktokPixel: joined.includes("tiktok pixel"),
    linkedinInsight: joined.includes("linkedin insight"),
    microsoftAds: joined.includes("microsoft ads"),
  };
}

async function fetchText(url: string) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; DigitaleGewinner-AdIntel/1.0; +https://digitalegewinner.de)",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) return { ok: false, text: "" };
    return { ok: true, text: (await response.text()).slice(0, 1_500_000) };
  } catch {
    return { ok: false, text: "" };
  }
}

function companyTokens(company: string) {
  return company.toLowerCase().replace(/[^a-z0-9äöüß\s-]/gi, " ").split(/\s+/).filter((part) => part.length >= 4).slice(0, 5);
}

export async function inspectAdIntelligence(company: string, website: string, trackingTools: string[] = []): Promise<AdIntelligence> {
  const domain = domainFromWebsite(website);
  const flags = trackingFlags(trackingTools);
  const metaUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=DE&q=${encodeURIComponent(company)}&search_type=keyword_unordered&media_type=all`;
  const googleUrl = domain
    ? `https://adstransparency.google.com/?domain=${encodeURIComponent(domain)}&region=DE&platform=SEARCH&safe=active`
    : `https://adstransparency.google.com/?region=DE&platform=SEARCH&safe=active`;

  const [metaResponse, googleResponse] = await Promise.all([fetchText(metaUrl), fetchText(googleUrl)]);
  const metaText = metaResponse.text.toLowerCase();
  const googleText = googleResponse.text.toLowerCase();
  const tokens = companyTokens(company);

  const metaHasCompany = tokens.length ? tokens.some((token) => metaText.includes(token)) : false;
  const metaHasAdPayload = /adarchiveid|ad_archive_id|adlibraryid|ad_library_id|archive_id/.test(metaText);
  const metaExplicitNone = /no results|keine ergebnisse|keine anzeigen gefunden|0 results/.test(metaText);
  const metaActive = metaResponse.ok && metaHasCompany && metaHasAdPayload;

  const googleHasDomain = Boolean(domain && googleText.includes(domain));
  const googleActiveMarker = /this domain includes results|advertiser accounts with ads pointing to this domain|anzeigen, die auf diese domain|werbetreibendenkonten/.test(googleText);
  const googleExplicitNone = /cannot find results|try refreshing the page or altering the search|keine ergebnisse/.test(googleText);
  const googleActive = googleResponse.ok && googleHasDomain && googleActiveMarker;

  const metaStatus: AdCheckStatus = metaActive ? "active" : metaExplicitNone ? "none" : flags.metaPixel ? "likely" : "unknown";
  const googleStatus: AdCheckStatus = googleActive ? "active" : googleExplicitNone ? "none" : flags.googleAdsTag ? "likely" : "unknown";

  const signals: string[] = [];
  if (flags.metaPixel) signals.push("Meta Pixel auf Website erkannt");
  if (flags.googleAdsTag) signals.push("Google Ads Tag auf Website erkannt");
  if (flags.googleAnalyticsOrGtm) signals.push("Google Analytics / GTM erkannt");
  if (flags.tiktokPixel) signals.push("TikTok Pixel erkannt");
  if (flags.linkedinInsight) signals.push("LinkedIn Insight Tag erkannt");
  if (flags.microsoftAds) signals.push("Microsoft Ads UET erkannt");
  if (metaStatus === "active") signals.push("Meta Ad Library: aktive Werbeanzeigen gefunden");
  else if (metaStatus === "likely") signals.push("Meta Ads wahrscheinlich aktiv / vorbereitet");
  if (googleStatus === "active") signals.push("Google Ads Transparency: aktive Search Ads gefunden");
  else if (googleStatus === "likely") signals.push("Google Ads wahrscheinlich aktiv / vorbereitet");

  return {
    checkedAt: new Date().toISOString(),
    marketing: flags,
    meta: {
      status: metaStatus,
      url: metaUrl,
      evidence: metaActive ? "Öffentlicher Ad-Library-Treffer + Anzeigen-Payload erkannt" : flags.metaPixel ? "Meta Pixel erkannt; öffentlicher Treffer nicht sicher maschinenlesbar" : metaExplicitNone ? "Ad Library lieferte keinen Treffer" : "Öffentlicher Check ohne eindeutiges maschinenlesbares Ergebnis",
    },
    google: {
      status: googleStatus,
      url: googleUrl,
      evidence: googleActive ? "Ads Transparency Center meldet Anzeigen für die Domain" : flags.googleAdsTag ? "Google Ads Tag erkannt; Transparency-Treffer nicht sicher bestätigt" : googleExplicitNone ? "Ads Transparency Center lieferte keinen Treffer" : "Öffentlicher Check ohne eindeutiges maschinenlesbares Ergebnis",
    },
    signals,
  };
}
