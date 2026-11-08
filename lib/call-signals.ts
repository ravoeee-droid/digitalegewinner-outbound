// Macht die Rohdaten des Anreicherungs-Workers (lead_enrichment) zu kurzen deutschen Gesprächsaufhängern für das Call-Cockpit.
type Data = Record<string, unknown>;

export function buildCallSignals(bySource: Record<string, Data | undefined>): string[] {
  const out: string[] = [];
  const web = bySource.website, meta = bySource.meta_ads, google = bySource.google_ads;
  const people = Array.isArray(web?.people) ? (web.people as Array<{ name?: string; role?: string }>) : [];
  if (people[0]?.name) out.push(`Ansprechpartner laut Impressum: ${people[0].name}${people[0].role ? ` (${people[0].role})` : ""}`);
  if (web?.mentionsJobs && !web.hasJobPostingSchema) out.push("Stellen auf der Website, aber ohne Google-for-Jobs-Markup");
  if (web && web.mobileReady === false) out.push("Website nicht mobiloptimiert");
  if (web && web.https === false) out.push("Website ohne HTTPS");
  if (web && web.hasContactForm === false) out.push("Kein Kontaktformular auf der Website");
  if (web && Array.isArray(web.tracking) && web.tracking.length === 0) out.push("Kein Tracking, Bewerberwege nicht messbar");
  const year = Number(web?.copyrightYear || 0);
  if (year && year < new Date().getFullYear() - 2) out.push(`Website zuletzt ${year} gepflegt`);
  if (meta?.runsAds) out.push(`Schaltet Meta-Anzeigen (${Number(meta.adsActive || 0)} aktiv)`);
  if (google?.runsAds) out.push("Schaltet Google-Anzeigen");
  return out.slice(0, 5);
}
