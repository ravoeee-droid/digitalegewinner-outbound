import { PV_PAGE, PV_TRUST_PAGE } from "@/lib/outreach-copy";

// Die Seite /pv-trust darf erst verlinkt werden, wenn sie erreichbar ist. Bis dahin steht /handwerk-kunden in der Signatur.
let cache: { url: string; at: number } | null = null;

export async function pvPageUrl() {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.url;
  let url = PV_PAGE;
  try {
    const response = await fetch(PV_TRUST_PAGE, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(4000), headers: { "user-agent": "DigitaleGewinnerLinkCheck/1.0" } });
    if (response.ok && new URL(response.url).pathname.replace(/\/+$/, "") === "/pv-trust") url = PV_TRUST_PAGE;
  } catch {
    url = PV_PAGE;
  }
  cache = { url, at: Date.now() };
  return url;
}
