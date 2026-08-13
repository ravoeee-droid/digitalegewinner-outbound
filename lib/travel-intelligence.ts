import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { runWebsiteAudit, type WebsiteAuditResult } from "@/lib/website-audit";

export type SocialPlatform = "instagram" | "facebook" | "tiktok" | "youtube" | "pinterest" | "linkedin";

export type TravelManualSignals = {
  instagramUrl?: string;
  facebookUrl?: string;
  tiktokUrl?: string;
  youtubeUrl?: string;
  pinterestUrl?: string;
  linkedinUrl?: string;
  instagramFollowers?: number;
  instagramPosts90?: number;
  instagramReels90?: number;
  youtubeVideos?: number;
  youtubeShorts?: number;
  reviewCount?: number;
  rating?: number;
  lastPostDays?: number;
};

export type TravelOpportunity = {
  id: string;
  title: string;
  evidence: string;
  angle: string;
  priority: "high" | "medium";
};

export type TravelLoomScene = {
  start: number;
  end: number;
  source: "instagram" | "website" | "youtube" | "reviews" | "strategy";
  url?: string;
  visual: string;
  voiceover: string;
};

export type TravelIntelligenceResult = {
  version: 1;
  analyzedAt: string;
  company: string;
  city: string;
  website: string;
  finalUrl: string;
  niche: string;
  social: Record<SocialPlatform, string>;
  manual: TravelManualSignals;
  websiteAudit: WebsiteAuditResult;
  signals: {
    imageCount: number;
    videoCount: number;
    offerLinkCount: number;
    offerNames: string[];
    destinations: string[];
    hasBooking: boolean;
    hasBlog: boolean;
    hasTestimonials: boolean;
    hasNewsletter: boolean;
    platformCount: number;
  };
  scores: {
    opportunity: number;
    visualAssets: number;
    socialPresence: number;
    shortFormGap: number;
    socialProof: number;
    repurposing: number;
    channelGap: number;
    commercialIntent: number;
  };
  strengths: string[];
  gaps: string[];
  opportunities: TravelOpportunity[];
  contentIdeas: Array<{ hook: string; format: string; source: string }>;
  loom: {
    opener: string;
    talkingPoints: string[];
    scenes: TravelLoomScene[];
  };
  microsite: {
    eyebrow: string;
    headline: string;
    subheadline: string;
    insights: string[];
    cta: string;
  };
};

const MAX_HTML_BYTES = 2_500_000;
const MAX_REDIRECTS = 4;
const platformPatterns: Array<[SocialPlatform, RegExp]> = [
  ["instagram", /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[A-Za-z0-9._-]+/i],
  ["facebook", /(?:https?:\/\/)?(?:www\.)?facebook\.com\/[A-Za-z0-9._/-]+/i],
  ["tiktok", /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@?[A-Za-z0-9._-]+/i],
  ["youtube", /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/[A-Za-z0-9@._/?=&-]+/i],
  ["pinterest", /(?:https?:\/\/)?(?:www\.)?pinterest\.[A-Za-z.]+\/[A-Za-z0-9._/-]+/i],
  ["linkedin", /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9._/-]+/i],
];

const destinationTerms = [
  "Namibia","Südafrika","Suedafrika","Marokko","Tansania","Kenia","Botswana","Uganda","Ruanda","Ägypten","Aegypten","Jordanien","Oman","Dubai","Thailand","Vietnam","Kambodscha","Laos","Indonesien","Bali","Japan","Sri Lanka","Indien","Nepal","Bhutan","Malediven","Mauritius","Seychellen","Australien","Neuseeland","Kanada","USA","Alaska","Mexiko","Costa Rica","Panama","Peru","Chile","Argentinien","Brasilien","Kolumbien","Ecuador","Galapagos","Island","Norwegen","Schweden","Finnland","Griechenland","Italien","Spanien","Portugal","Kroatien","Albanien","Montenegro","Türkei","Tuerkei","Schottland","Irland","Frankreich","Österreich","Oesterreich","Schweiz","Madeira","Azoren","Kanaren","Mallorca","Kreta","Sardinien","Sizilien","Patagonien","Sansibar","Madagaskar","Antarktis"
];

function clamp(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }
function cleanText(value: string) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
function attr(tag: string, name: string) {
  const quoted = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
  if (quoted !== undefined) return quoted.trim();
  return tag.match(new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i"))?.[1]?.trim() || "";
}
function normalizeUrl(raw: string) {
  const value = raw.trim();
  if (!value) throw new Error("Website fehlt.");
  return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
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
  if (url.username || url.password) throw new Error("URLs mit Zugangsdaten sind nicht erlaubt.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Interne Hosts sind nicht erlaubt.");
  if (isIP(host) && isPrivateIp(host)) throw new Error("Private IP-Adressen sind nicht erlaubt.");
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) throw new Error("Die Zieladresse ist nicht öffentlich erreichbar.");
}
async function fetchPublicHtml(rawUrl: string) {
  let current = normalizeUrl(rawUrl);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "user-agent": "JJMedia-TravelRadar/1.0 (+public-travel-audit)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Weiterleitung ohne Ziel-URL.");
      current = new URL(location, current);
      continue;
    }
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) throw new Error("Die URL liefert keine HTML-Webseite.");
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_HTML_BYTES) throw new Error("Website ist für den Schnell-Audit zu groß.");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_HTML_BYTES) throw new Error("Website ist für den Schnell-Audit zu groß.");
    return { html: new TextDecoder().decode(buffer), finalUrl: current };
  }
  throw new Error("Zu viele Weiterleitungen.");
}
function absoluteSocial(raw: string, base: URL) {
  if (!raw) return "";
  try { return new URL(raw, base).toString(); } catch { return raw.startsWith("http") ? raw : `https://${raw.replace(/^\/+/, "")}`; }
}
function discoverSocial(html: string, base: URL, manual: TravelManualSignals) {
  const social = { instagram:"", facebook:"", tiktok:"", youtube:"", pinterest:"", linkedin:"" } satisfies Record<SocialPlatform,string>;
  const manualMap: Record<SocialPlatform, string | undefined> = {
    instagram: manual.instagramUrl,
    facebook: manual.facebookUrl,
    tiktok: manual.tiktokUrl,
    youtube: manual.youtubeUrl,
    pinterest: manual.pinterestUrl,
    linkedin: manual.linkedinUrl,
  };
  const links = (html.match(/<a\b[^>]*>/gi) || []).map((tag) => attr(tag, "href")).filter(Boolean);
  for (const platform of Object.keys(social) as SocialPlatform[]) {
    if (manualMap[platform]) { social[platform] = absoluteSocial(String(manualMap[platform]), base); continue; }
    const pattern = platformPatterns.find(([name]) => name === platform)?.[1];
    if (!pattern) continue;
    const fromHref = links.find((href) => pattern.test(href));
    const fromBody = html.match(pattern)?.[0];
    social[platform] = absoluteSocial(fromHref || fromBody || "", base);
  }
  return social;
}
function extractOffers(html: string, base: URL) {
  const offerPattern = /(reise|reisen|tour|tours|trip|expedition|kreuzfahrt|cruise|safari|urlaub|adventure|abenteuer|motorrad|rundreise|gruppenreise|erlebnis|destination|reiseziele)/i;
  const excluded = /(impressum|datenschutz|privacy|agb|kontakt|login|account|newsletter|cookie)/i;
  const seen = new Set<string>();
  const names: string[] = [];
  let count = 0;
  for (const match of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const tag = match[0];
    const label = cleanText(match[1] || "");
    const href = attr(tag, "href");
    if (!href || excluded.test(`${href} ${label}`) || !offerPattern.test(`${href} ${label}`)) continue;
    try {
      const url = new URL(href, base);
      if (url.hostname !== base.hostname) continue;
      count += 1;
      if (label.length >= 3 && label.length <= 70 && !seen.has(label.toLowerCase())) {
        seen.add(label.toLowerCase());
        names.push(label);
      }
    } catch {}
    if (names.length >= 8) break;
  }
  return { count, names };
}
function inferNiche(text: string) {
  const rules: Array<[RegExp,string]> = [
    [/(motorrad|bike tour|motorcycle)/i,"Motorradreisen"],
    [/(kreuzfahrt|cruise|schiffsreise)/i,"Kreuzfahrten"],
    [/(safari|wildlife|afrika-reise)/i,"Safari & Erlebnisreisen"],
    [/(wander|trekking|hiking)/i,"Aktiv- & Wanderreisen"],
    [/(luxus|luxury|private travel)/i,"Luxusreisen"],
    [/(gruppenreise|group travel)/i,"Gruppenreisen"],
    [/(expedition|wildnis|adventure|abenteuer)/i,"Abenteuer- & Erlebnisreisen"],
    [/(reisebüro|reisebuero|travel agency)/i,"Reisebüro"],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] || "Reiseveranstalter & Tourismus";
}
function buildOpportunity(input: {
  company: string;
  website: string;
  social: Record<SocialPlatform,string>;
  signals: TravelIntelligenceResult["signals"];
  manual: TravelManualSignals;
  scores: Omit<TravelIntelligenceResult["scores"],"opportunity"> & { opportunity:number };
}) {
  const { company, website, social, signals, manual, scores } = input;
  const strengths: string[] = [];
  const gaps: string[] = [];
  if (scores.visualAssets >= 65) strengths.push("Viel visuelles Reise-Material als Basis für Reels, Shorts und Ads.");
  if ((manual.reviewCount || 0) >= 50 || signals.hasTestimonials) strengths.push("Starker Social Proof, der sich in Content und Creatives übersetzen lässt.");
  if (signals.offerLinkCount >= 5) strengths.push("Mehrere konkrete Reisen/Angebote liefern kontinuierlich Content-Anlässe.");
  if (social.instagram) strengths.push("Instagram ist bereits vorhanden und kann als Ausgangspunkt skaliert werden.");
  if (!social.tiktok) gaps.push("TikTok wurde nicht gefunden – zusätzlicher Short-Form-Kanal bleibt ungenutzt.");
  if (!social.youtube) gaps.push("Kein YouTube-Kanal gefunden – Shorts und Longform-Repurposing fehlen als Hebel.");
  if ((manual.instagramPosts90 || 0) >= 4 && (manual.instagramReels90 || 0) <= 2) gaps.push("Content ist vorhanden, aber der Reel-Anteil wirkt im Verhältnis zur Aktivität niedrig.");
  if ((manual.lastPostDays || 0) >= 21) gaps.push("Die letzte bekannte Social-Aktivität liegt mehrere Wochen zurück.");
  if ((manual.reviewCount || 0) >= 50 && scores.socialPresence < 70) gaps.push("Bewertungen/Vertrauen sind stärker als die aktuelle Social-Präsenz – Proof wird vermutlich nicht voll genutzt.");

  const opportunities: TravelOpportunity[] = [];
  if (scores.shortFormGap >= 55) opportunities.push({id:"short-form",title:"Short-Form Engine",evidence:"Reiseangebote und visuelles Material sind vorhanden, Short-Form-Signale bleiben aber unter ihrem Potenzial.",angle:"Aus vorhandenem Material wiederkehrende Reels, Shorts und TikToks bauen – mit Hook, Story und CTA statt nur schönen Bildern.",priority:"high"});
  if (scores.socialProof >= 55) opportunities.push({id:"proof",title:"Traveller Proof",evidence:`${manual.reviewCount ? `${manual.reviewCount} bekannte Bewertungen` : "Kundenstimmen/Proof"} liefern verwertbare Vertrauenssignale.`,angle:"Bewertungen als Gesichter, Storys, Reactions und Reise-Erfahrungen in Content übersetzen.",priority:"high"});
  if (scores.channelGap >= 45) opportunities.push({id:"distribution",title:"Multi-Channel Distribution",evidence:"Mindestens ein relevanter Social-Kanal fehlt oder ist nicht sichtbar verknüpft.",angle:"Ein Master-Asset systematisch für Instagram, TikTok und YouTube Shorts adaptieren.",priority:"medium"});
  if (scores.repurposing >= 60) opportunities.push({id:"repurpose",title:"Content Repurposing",evidence:"Die Website und vorhandene Video-/Bildsignale liefern genug Rohmaterial für eine Content-Pipeline.",angle:"Bestehende Reisebilder, Tour-Videos und Guides in wiederverwendbare Serien verwandeln.",priority:"high"});
  if (!opportunities.length) opportunities.push({id:"strategy",title:"Content Positioning",evidence:"Die vorhandenen öffentlichen Signale reichen für einen klaren ersten Content-Test.",angle:"Mit 3 wiederkehrenden Formaten testen, welche Storys qualifizierte Reiseinteressenten am stärksten aktivieren.",priority:"medium"});

  const sourceName = signals.offerNames[0] || signals.destinations[0] || "einer Ihrer Reisen";
  const contentIdeas = [
    {hook:`7 Momente aus ${sourceName}, die auf keiner Hochglanz-Broschüre landen`,format:"Reel / Short",source:"Website-Angebot + vorhandenes Reise-Material"},
    {hook:"Was unsere Gäste vor der Reise dachten – und danach gesagt haben",format:"Testimonial Reel",source:"Bewertungen / Kundenstimmen"},
    {hook:`POV: Du buchst nicht einfach Urlaub, sondern ${sourceName}`,format:"Story Reel",source:"Destination + Experience Footage"},
  ];
  const scenes: TravelLoomScene[] = [
    {start:0,end:8,source:social.instagram?"instagram":"website",url:social.instagram||website,visual:social.instagram?"Instagram-Profil des Unternehmens, Bio und Feed sichtbar":"Startseite des Reiseunternehmens",voiceover:`Ich habe mir ${company} gerade kurz angesehen – und das Material ist eigentlich viel zu stark, um es nur als klassische Reise-Kommunikation zu nutzen.`},
    {start:8,end:20,source:social.instagram?"instagram":"website",url:social.instagram||website,visual:"Feed bzw. Reisebilder langsam durchscrollen; starke Motive kurz markieren",voiceover:"Gerade bei Reisen entscheidet Emotion. Ihr habt dafür schon Bilder, Orte und Erlebnisse – der Hebel ist, daraus wiederkehrende Story-Formate zu bauen."},
    {start:20,end:34,source:"website",url:website,visual:`Konkretes Angebot öffnen: ${sourceName}`,voiceover:`Nehmen wir nur ${sourceName}: Daraus lassen sich Hooks, POVs, Kundenstorys, Behind-the-Scenes und mehrere Short-Form-Serien bauen.`},
    {start:34,end:48,source:"strategy",visual:"JJ-Media Opportunity Cards: Short-Form, Proof, Distribution",voiceover:"Wir würden also nicht einfach mehr posten, sondern vorhandenes Material so strukturieren, dass daraus mehr Aufmerksamkeit, Vertrauen und konkrete Reiseanfragen entstehen können."},
    {start:48,end:62,source:"strategy",visual:"Persönliche JJ-Media Microsite mit drei Content-Ideen und CTA",voiceover:"Ich habe euch darunter drei konkrete Ansätze vorbereitet. Wenn einer davon spannend aussieht, können wir das in 15 Minuten einmal gemeinsam durchgehen."},
  ];
  const talkingPoints = opportunities.slice(0,3).map((item) => `${item.title}: ${item.angle}`);
  return { strengths, gaps, opportunities: opportunities.slice(0,4), contentIdeas, scenes, talkingPoints };
}

export async function analyzeTravelLead(input: { company:string; website:string; city?:string; manual?:TravelManualSignals }): Promise<TravelIntelligenceResult> {
  const manual = input.manual || {};
  const [{ html, finalUrl }, websiteAudit] = await Promise.all([
    fetchPublicHtml(input.website),
    runWebsiteAudit(input.website, input.company),
  ]);
  const text = cleanText(html);
  const social = discoverSocial(html, finalUrl, manual);
  const offers = extractOffers(html, finalUrl);
  const destinations = destinationTerms.filter((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\b`,"i").test(text)).slice(0,10);
  const imageCount = (html.match(/<img\b/gi) || []).length;
  const videoCount = (html.match(/<video\b|youtube\.com\/embed|vimeo\.com\/(?:video\/)?/gi) || []).length;
  const hasBooking = /(jetzt buchen|reise buchen|book now|booking|verfügbarkeit|verfuegbarkeit|termin anfragen|reise anfragen)/i.test(text);
  const hasBlog = /(blog|reisemagazin|reiseberichte|stories|journal)/i.test(text);
  const hasTestimonials = Boolean(websiteAudit.metrics.hasTestimonials);
  const hasNewsletter = /(newsletter|reise-news|inspiration per e-mail|inspiration per email)/i.test(text);
  const platformCount = Object.values(social).filter(Boolean).length;
  const signals = { imageCount, videoCount, offerLinkCount:offers.count, offerNames:offers.names, destinations, hasBooking, hasBlog, hasTestimonials, hasNewsletter, platformCount };

  const visualAssets = clamp(imageCount * 2.2 + videoCount * 14 + Math.min(offers.count,10) * 3);
  const socialPresence = clamp(platformCount * 15 + (social.instagram?15:0) + (social.youtube?10:0) + Math.min((manual.instagramFollowers || 0) / 250,20));
  const posts90 = manual.instagramPosts90 || 0;
  const reels90 = manual.instagramReels90 || 0;
  const reelShare = posts90 > 0 ? reels90 / posts90 : social.instagram ? 0.15 : 0;
  const shortFormGap = clamp((1-Math.min(1,reelShare))*58 + (!social.tiktok?18:0) + (!social.youtube?12:0) + ((manual.lastPostDays || 0)>=21?12:0));
  const socialProof = clamp((hasTestimonials?32:0) + Math.min((manual.reviewCount || 0)/4,38) + ((manual.rating || 0)>=4.5?18:0) + (websiteAudit.scores.trust*.12));
  const repurposing = clamp(visualAssets*.52 + Math.min(manual.youtubeVideos || 0,30)*1.1 + offers.count*2 + (hasBlog?12:0));
  const channelGap = clamp((!social.tiktok?30:0)+(!social.youtube?24:0)+(!social.pinterest?12:0)+(!social.instagram?28:0)+(!social.facebook?6:0));
  const commercialIntent = clamp((hasBooking?28:0)+Math.min(offers.count,10)*4+(websiteAudit.scores.conversion*.34)+(websiteAudit.metrics.formCount>0?12:0));
  const opportunity = clamp(visualAssets*.18 + socialProof*.13 + repurposing*.16 + shortFormGap*.22 + channelGap*.11 + commercialIntent*.20);
  const scores = { opportunity, visualAssets, socialPresence, shortFormGap, socialProof, repurposing, channelGap, commercialIntent };
  const built = buildOpportunity({ company:input.company, website:finalUrl.toString(), social, signals, manual, scores });
  const niche = inferNiche(`${text} ${offers.names.join(" ")}`);
  const topInsight = built.opportunities[0]?.title || "Content Opportunity";
  return {
    version:1,
    analyzedAt:new Date().toISOString(),
    company:input.company,
    city:input.city || "",
    website:input.website,
    finalUrl:finalUrl.toString(),
    niche,
    social,
    manual,
    websiteAudit,
    signals,
    scores,
    strengths:built.strengths,
    gaps:built.gaps,
    opportunities:built.opportunities,
    contentIdeas:built.contentIdeas,
    loom:{
      opener:`Ich habe mir ${input.company} gerade kurz angesehen und dabei ist mir ein ziemlich klarer Social-Media-Hebel aufgefallen.`,
      talkingPoints:built.talkingPoints,
      scenes:built.scenes,
    },
    microsite:{
      eyebrow:"JJ-MEDIA · TRAVEL GROWTH SNAPSHOT",
      headline:`3 Content-Chancen für ${input.company}`,
      subheadline:`Aus öffentlich sichtbaren Reise-, Website- und Social-Signalen haben wir die stärksten Hebel für mehr Aufmerksamkeit und qualifizierte Reiseinteressenten priorisiert.`,
      insights:[topInsight,...built.opportunities.slice(1,3).map((x)=>x.title)].slice(0,3),
      cta:"15 Minuten gemeinsam durchgehen",
    },
  };
}
