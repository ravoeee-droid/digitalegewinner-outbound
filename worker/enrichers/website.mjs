import { fetchText } from "../lib.mjs";

const SOCIALS = {
  facebook: /https?:\/\/(?:www\.|de-de\.)?facebook\.com\/(?!sharer|share|plugins|tr\b|dialog)[^\s"'<>?#]+/i,
  instagram: /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|explore)[^\s"'<>?#]+/i,
  linkedin: /https?:\/\/(?:[a-z]{2}\.)?linkedin\.com\/(?:company|in|school)\/[^\s"'<>?#]+/i,
  youtube: /https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/|user\/)[^\s"'<>?#]+/i,
  tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/@[^\s"'<>?#]+/i,
  xing: /https?:\/\/(?:www\.)?xing\.com\/(?:pages|companies|profile)\/[^\s"'<>?#]+/i,
  kununu: /https?:\/\/(?:www\.)?kununu\.com\/de\/[^\s"'<>?#]+/i,
};
const TECH = [
  ["WordPress", /wp-content|wp-includes|content="WordPress/i], ["Wix", /wixstatic\.com|wix\.com/i], ["Jimdo", /jimdo(?:free|site)?\.com/i],
  ["Squarespace", /squarespace/i], ["Webflow", /webflow\.(?:com|io)/i], ["Shopify", /cdn\.shopify\.com/i], ["TYPO3", /typo3/i],
  ["Elementor", /elementor/i], ["Joomla", /content="Joomla/i],
];
const TRACKING = [
  ["Google Analytics", /google-analytics\.com|gtag\(|googletagmanager\.com\/gtag/i], ["Google Tag Manager", /googletagmanager\.com\/gtm/i],
  ["Meta Pixel", /connect\.facebook\.net\/[^"']*fbevents|fbq\(/i], ["Hotjar", /hotjar\.com/i], ["LinkedIn Insight", /snap\.licdn\.com/i],
  ["Google Ads", /googleadservices\.com|AW-\d{6,}/i], ["Matomo", /matomo|piwik/i],
];
const JUNK_MAIL = /\.(png|jpe?g|gif|svg|webp)$|^(?:sentry|example|name|user|email|your|mail)@|wixpress|sentry\.io|schema\.org|domain\.(?:com|de)$/i;

const deobf = (h) => h.replace(/\s*[\[(]\s*(?:at|ät)\s*[\])]\s*/gi, "@").replace(/\s*[\[(]\s*(?:dot|punkt)\s*[\])]\s*/gi, ".").replace(/&#0*64;|&commat;/gi, "@");

export function parseSite(html, baseUrl) {
  const src = deobf(html);
  const emails = [...new Set([...src.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0].toLowerCase()).filter((e) => !JUNK_MAIL.test(e)))].slice(0, 12);
  const phones = [...new Set([...src.matchAll(/href=["']tel:([+\d()\s\/.-]{6,24})["']/gi)].map((m) => m[1].replace(/[^\d+]/g, "")).concat(
    [...src.replace(/<[^>]+>/g, " ").matchAll(/(?:\+49|0049|\(?0\d{2,5}\)?)[\s\/.-]?\d[\d\s\/.-]{5,14}\d/g)].map((m) => m[0].replace(/[^\d+]/g, ""))))].filter((p) => p.length >= 8 && p.length <= 16).slice(0, 8);
  const social = {};
  for (const [k, re] of Object.entries(SOCIALS)) { const m = html.match(re); if (m) social[k] = m[0].replace(/[\\'")]+$/, ""); }
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const description = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] || "").trim().slice(0, 300);
  const people = [...text.matchAll(/(?:Geschäftsführ(?:er|ung|erin)|Inhaber(?:in)?|Pflegedienstleitung|Einrichtungsleitung|Heimleitung|Vertreten durch)[:\s]+((?:(?:Dr\.|Prof\.|Dipl\.-[A-Za-z]+)\s+)?[A-ZÄÖÜ][a-zäöüß]+(?:\s[A-ZÄÖÜ][a-zäöüß-]+){1,2})/g)].map((m) => ({ role: m[0].split(/[:\s]/)[0], name: m[1] }));
  const uniquePeople = people.filter((p, i) => people.findIndex((q) => q.name === p.name) === i).slice(0, 5);
  return {
    url: baseUrl, title, description,
    emails, phones, social, people: uniquePeople,
    tech: TECH.filter(([, re]) => re.test(html)).map(([n]) => n),
    tracking: TRACKING.filter(([, re]) => re.test(html)).map(([n]) => n),
    https: baseUrl.startsWith("https://"),
    mobileReady: /<meta[^>]+name=["']viewport["']/i.test(html),
    hasJobPostingSchema: /"@type"\s*:\s*"JobPosting"/i.test(html),
    mentionsJobs: /stellenangebot|karriere|jobs?\b|wir suchen|bewerb/i.test(text),
    hasContactForm: /<form[\s\S]{0,3000}?(?:name=["'](?:email|e-mail|mail)["']|type=["']email["'])/i.test(html),
    copyrightYear: Number(text.match(/©\s*(?:copyright\s*)?(20\d{2})/i)?.[1] || 0) || null,
    textLength: text.length,
  };
}

const PATHS = ["/impressum", "/kontakt", "/karriere", "/jobs", "/team", "/ueber-uns"];

export async function enrichWebsite(company) {
  const base = /^https?:\/\//i.test(company.website) ? company.website : `https://${company.website}`;
  const root = new URL(base);
  const home = await fetchText(root.href);
  if (home.blocked) return { status: "blocked", data: { reason: "robots.txt" } };
  if (!home.ok || !home.text) throw new Error(`Startseite nicht erreichbar (HTTP ${home.status})`);
  const pages = [parseSite(home.text, home.finalUrl)];
  const seen = new Set([new URL(home.finalUrl).pathname]);
  for (const p of PATHS) {
    if (pages.length >= 5) break;
    const link = home.text.match(new RegExp(`href=["']([^"']*${p.slice(1)}[^"']*)["']`, "i"))?.[1];
    if (!link) continue;
    try {
      const u = new URL(link, home.finalUrl);
      if (u.host !== new URL(home.finalUrl).host || seen.has(u.pathname)) continue;
      seen.add(u.pathname);
      const r = await fetchText(u.href);
      if (r.ok && r.text) pages.push(parseSite(r.text, r.finalUrl));
    } catch { /* eine Unterseite darf fehlen */ }
  }
  const merge = (k) => [...new Set(pages.flatMap((p) => p[k]))];
  const social = Object.assign({}, ...pages.map((p) => p.social).reverse());
  const people = pages.flatMap((p) => p.people).filter((p, i, a) => a.findIndex((q) => q.name === p.name) === i).slice(0, 5);
  const h = pages[0];
  return { status: "ok", data: {
    title: h.title, description: h.description, emails: merge("emails").slice(0, 12), phones: merge("phones").slice(0, 8), social, people,
    tech: merge("tech"), tracking: merge("tracking"), https: h.https, mobileReady: h.mobileReady,
    hasJobPostingSchema: pages.some((p) => p.hasJobPostingSchema), mentionsJobs: pages.some((p) => p.mentionsJobs),
    hasContactForm: pages.some((p) => p.hasContactForm), copyrightYear: Math.max(0, ...pages.map((p) => p.copyrightYear || 0)) || null,
    pagesCrawled: pages.length,
  } };
}
