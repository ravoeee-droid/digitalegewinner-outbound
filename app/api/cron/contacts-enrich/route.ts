import { contactEnrichProgress, enrichContactsOnce } from "@/lib/contact-enrich";
import { enrichGeoOnce } from "@/lib/lead-geo";
import { enrichProfilesOnce } from "@/lib/lead-profile";
import { enrichJobSearchOnce } from "@/lib/lead-jobsearch";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}

// Zieht Ansprechpartner aus Impressum/Kontaktseite ordnet Bundesland und Landkreis zu und ermittelt Betriebsgröße, offene Stellen und Träger, bis jeder Lead einmal durch war.
async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await enrichContactsOnce();
    const geo = await enrichGeoOnce().catch(() => ({ geoChecked: 0, geoMapped: 0 }));
    const profile = await enrichProfilesOnce().catch(() => ({ profileChecked: 0, profileFound: 0 }));
    const jobs = await enrichJobSearchOnce().catch(() => ({ jobsearchChecked: 0, jobsearchActive: 0 }));
    const progress = await contactEnrichProgress();
    console.log("[contacts-enrich]", JSON.stringify({ ...result, ...geo, ...profile, ...jobs, ...progress }));
    return Response.json({ ok: true, ...result, ...geo, ...profile, ...jobs, ...progress });
  } catch (error) {
    console.error("[contacts-enrich-error]", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Ansprechpartner-Suche fehlgeschlagen." }, { status: 500 });
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
