export type StudioAspectRatio = "16:9" | "9:16" | "1:1" | "4:5";
export type StudioTrackType = "background" | "media" | "presenter" | "overlay" | "text" | "audio";
export type StudioItemType = "video" | "image" | "website" | "presenter" | "text" | "shape" | "metric" | "logo" | "audio";
export type StudioMode = "video" | "landing" | "brand" | "versions" | "render";

export type StudioTransform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  borderRadius: number;
  scale: number;
};

export type StudioItem = {
  id: string;
  type: StudioItemType;
  label: string;
  trackId: string;
  startMs: number;
  endMs: number;
  zIndex: number;
  sourceUrl?: string;
  dynamicSource?: "presenter" | "website" | "logo" | "portrait";
  text?: string;
  subtext?: string;
  color?: string;
  backgroundColor?: string;
  fontSize?: number;
  fontWeight?: number;
  textAlign?: "left" | "center" | "right";
  transform: StudioTransform;
  hidden?: boolean;
  locked?: boolean;
};

export type StudioTrack = {
  id: string;
  name: string;
  type: StudioTrackType;
  zIndex: number;
  hidden: boolean;
  locked: boolean;
  items: StudioItem[];
};

export type StudioTimeline = {
  version: 3;
  durationMs: number;
  fps: number;
  aspectRatio: StudioAspectRatio;
  width: number;
  height: number;
  backgroundColor: string;
  tracks: StudioTrack[];
};

export type StudioBrandKit = {
  name: string;
  logoUrl: string;
  portraitUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  mutedTextColor: string;
  buttonTextColor: string;
  fontHeading: string;
  fontBody: string;
  radiusPx: number;
  defaultCtaLabel: string;
  defaultCtaUrl: string;
  trustHeadline: string;
  trustBody: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

export type StudioLandingBlock = {
  id: string;
  type: "hero" | "video" | "findings" | "metrics" | "trust" | "about" | "cta" | "calendar" | "faq" | "footer";
  enabled: boolean;
  order: number;
  eyebrow?: string;
  headline?: string;
  body?: string;
};

export type StudioProject = {
  version: 3;
  name: string;
  presetKey: string;
  timeline: StudioTimeline;
  brand: StudioBrandKit;
  landing: StudioLandingBlock[];
  sources: {
    presenterUrl: string;
    websiteUrl: string;
    websiteCaptureUrl: string;
    logoUrl: string;
    portraitUrl: string;
  };
  updatedAt?: string;
};

export type StudioLead = {
  id: string;
  company: string;
  contact: string;
  city: string;
  industry: string;
  website: string;
  email: string;
  phone: string;
  notes: string;
  priorityScore: number;
  opportunityScore: number;
  websiteScore: number;
};

export const STUDIO_VARIABLES = [
  "{{company}}",
  "{{firstname}}",
  "{{website}}",
  "{{city}}",
  "{{industry}}",
  "{{problem}}",
  "{{opportunity}}",
  "{{website_score}}",
  "{{cta}}",
] as const;

export const STUDIO_PRESETS = [
  { key: "pflege-recruiting", label: "Pflege Recruiting", headline: "{{company}}: drei konkrete Recruiting-Hebel", problem: "Pflegefachkräfte planbarer erreichen" },
  { key: "karriere-check", label: "Karriere-Check", headline: "Kurzer Karriere-Check für {{company}}", problem: "Bewerberweg, Arbeitgeberwirkung und Conversion" },
  { key: "website-recruiting", label: "Website Recruiting", headline: "Was {{company}} online Bewerber kosten kann", problem: "Website, Vertrauen und Bewerbungsbarrieren" },
  { key: "social-recruiting", label: "Social Recruiting", headline: "Wie {{company}} latent wechselbereite Pflegekräfte erreicht", problem: "Social Ads, Zielgruppe und Funnel" },
] as const;

export const DIGITALE_GEWINNER_BRAND: StudioBrandKit = {
  name: "Digitale Gewinner",
  logoUrl: "",
  portraitUrl: "",
  primaryColor: "#17181b",
  secondaryColor: "#f3f4f6",
  accentColor: "#b58a34",
  backgroundColor: "#ffffff",
  surfaceColor: "#f6f7f9",
  textColor: "#17181b",
  mutedTextColor: "#5f646d",
  buttonTextColor: "#ffffff",
  fontHeading: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  fontBody: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  radiusPx: 18,
  defaultCtaLabel: "Kurze Analyse besprechen",
  defaultCtaUrl: "",
  trustHeadline: "Recruiting, das Pflegebetriebe nicht austauschbar wirken lässt.",
  trustBody: "Employer Branding, Social Recruiting, Bewerber-Funnel und strukturierter Follow-up-Prozess in einem messbaren System.",
  contactName: "Raphael Hermann",
  contactEmail: "",
  contactPhone: "",
};

export function studioTransform(patch: Partial<StudioTransform> = {}): StudioTransform {
  return { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, borderRadius: 0, scale: 1, ...patch };
}

export function studioResolution(ratio: StudioAspectRatio) {
  if (ratio === "9:16") return { width: 1080, height: 1920 };
  if (ratio === "1:1") return { width: 1080, height: 1080 };
  if (ratio === "4:5") return { width: 1080, height: 1350 };
  return { width: 1920, height: 1080 };
}

function item(input: Omit<StudioItem, "transform"> & { transform?: Partial<StudioTransform> }): StudioItem {
  return { ...input, transform: studioTransform(input.transform) };
}

export function defaultStudioProject(): StudioProject {
  const durationMs = 78000;
  return {
    version: 3,
    name: "Pflege Recruiting · Master",
    presetKey: "pflege-recruiting",
    brand: { ...DIGITALE_GEWINNER_BRAND },
    sources: { presenterUrl: "", websiteUrl: "", websiteCaptureUrl: "", logoUrl: "", portraitUrl: "" },
    timeline: {
      version: 3,
      durationMs,
      fps: 30,
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      backgroundColor: "#111214",
      tracks: [
        {
          id: "track-bg", name: "Website / Hintergrund", type: "background", zIndex: 10, hidden: false, locked: false,
          items: [
            item({ id: "website", type: "website", label: "Unternehmenswebsite", trackId: "track-bg", startMs: 0, endMs: 62000, zIndex: 10, dynamicSource: "website" }),
          ],
        },
        {
          id: "track-presenter", name: "Sprecher", type: "presenter", zIndex: 40, hidden: false, locked: false,
          items: [
            item({ id: "presenter-intro", type: "presenter", label: "Intro", trackId: "track-presenter", startMs: 0, endMs: 8000, zIndex: 40, dynamicSource: "presenter" }),
            item({ id: "presenter-bubble", type: "presenter", label: "Talking Head", trackId: "track-presenter", startMs: 8000, endMs: 65000, zIndex: 45, dynamicSource: "presenter", transform: { x: 75, y: 65, width: 20, height: 30, borderRadius: 100 } }),
            item({ id: "presenter-close", type: "presenter", label: "CTA Abschluss", trackId: "track-presenter", startMs: 65000, endMs: durationMs, zIndex: 40, dynamicSource: "presenter" }),
          ],
        },
        {
          id: "track-overlays", name: "Analyse & Overlays", type: "overlay", zIndex: 60, hidden: false, locked: false,
          items: [
            item({ id: "company-title", type: "text", label: "Firmenname", trackId: "track-overlays", startMs: 1200, endMs: 7000, zIndex: 60, text: "Kurze Recruiting-Analyse für {{company}}", fontSize: 50, fontWeight: 800, color: "#ffffff", backgroundColor: "rgba(17,18,20,.86)", transform: { x: 5, y: 72, width: 58, height: 16, borderRadius: 16 } }),
            item({ id: "metric-opportunity", type: "metric", label: "Opportunity", trackId: "track-overlays", startMs: 18000, endMs: 30000, zIndex: 62, text: "Recruiting Opportunity", subtext: "{{opportunity}} / 100", fontSize: 38, fontWeight: 800, color: "#17181b", backgroundColor: "#ffffff", transform: { x: 6, y: 66, width: 31, height: 20, borderRadius: 18 } }),
            item({ id: "metric-website", type: "metric", label: "Website Score", trackId: "track-overlays", startMs: 30000, endMs: 42000, zIndex: 62, text: "Karriere-/Website-Signal", subtext: "{{website_score}} / 100", fontSize: 38, fontWeight: 800, color: "#17181b", backgroundColor: "#ffffff", transform: { x: 6, y: 66, width: 31, height: 20, borderRadius: 18 } }),
            item({ id: "cta", type: "text", label: "CTA", trackId: "track-overlays", startMs: 67000, endMs: durationMs, zIndex: 65, text: "{{cta}}", fontSize: 46, fontWeight: 850, textAlign: "center", color: "#ffffff", backgroundColor: "#17181b", transform: { x: 20, y: 71, width: 60, height: 15, borderRadius: 20 } }),
          ],
        },
        {
          id: "track-brand", name: "Branding", type: "text", zIndex: 80, hidden: false, locked: false,
          items: [item({ id: "brand-logo", type: "logo", label: "Logo", trackId: "track-brand", startMs: 0, endMs: durationMs, zIndex: 80, dynamicSource: "logo", transform: { x: 3, y: 3, width: 18, height: 9 } })],
        },
        { id: "track-audio", name: "Audio", type: "audio", zIndex: 5, hidden: false, locked: false, items: [] },
      ],
    },
    landing: [
      { id: "hero", type: "hero", enabled: true, order: 10, eyebrow: "Persönliche Recruiting-Analyse", headline: "{{firstname}}, wir haben uns {{company}} kurz angesehen.", body: "Drei konkrete Hebel für Arbeitgeberwirkung, Reichweite und einen einfacheren Bewerbungsweg." },
      { id: "video", type: "video", enabled: true, order: 20, headline: "Ihre persönliche Videoanalyse" },
      { id: "findings", type: "findings", enabled: true, order: 30, eyebrow: "Was wir gesehen haben", headline: "Die wichtigsten Recruiting-Hebel" },
      { id: "metrics", type: "metrics", enabled: true, order: 40, headline: "Erste Potenzialindikatoren" },
      { id: "trust", type: "trust", enabled: true, order: 50, eyebrow: "Digitale Gewinner", headline: "Recruiting-System statt austauschbarer Stellenanzeige", body: "Employer Branding, Zielgruppenansprache, Social Recruiting, Bewerber-Funnel und Follow-up greifen ineinander." },
      { id: "cta", type: "cta", enabled: true, order: 60, headline: "Lassen Sie uns kurz prüfen, welche Stelle zuerst Sinn ergibt." },
      { id: "calendar", type: "calendar", enabled: true, order: 70, headline: "Passenden Termin auswählen" },
      { id: "footer", type: "footer", enabled: true, order: 90 },
    ],
  };
}

export function resolveStudioText(value: string | undefined, lead: StudioLead | null, project: StudioProject) {
  const source = value || "";
  const firstName = (lead?.contact || "").trim().split(/\s+/)[0] || "Guten Tag";
  const values: Record<string, string> = {
    "{{company}}": lead?.company || "Ihr Unternehmen",
    "{{firstname}}": firstName,
    "{{website}}": lead?.website || "",
    "{{city}}": lead?.city || "",
    "{{industry}}": lead?.industry || "Pflege",
    "{{problem}}": lead?.notes || "Mitarbeitergewinnung",
    "{{opportunity}}": String(lead?.opportunityScore || lead?.priorityScore || 0),
    "{{website_score}}": String(lead?.websiteScore || 0),
    "{{cta}}": project.brand.defaultCtaLabel,
  };
  return Object.entries(values).reduce((text, [key, replacement]) => text.replaceAll(key, replacement), source);
}
