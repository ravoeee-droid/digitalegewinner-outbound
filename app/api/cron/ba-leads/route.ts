import { collectBaLeads, type BaSegmentKey } from "@/lib/ba-lead-source";
import { ensureSalesOsSchema } from "@/lib/sales-os";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}

async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureSalesOsSchema();
    const only = new URL(request.url).searchParams.get("segment");
    const segments: BaSegmentKey[] = only === "pflege" || only === "pv" ? [only] : ["pflege", "pv"];
    const target = Number(process.env.BA_LEADS_PER_DAY) || 150;
    const results = [];
    for (const segment of segments) {
      // Beide Kampagnen teilen sich die Laufzeit; jede bekommt ihren Anteil.
      results.push(await collectBaLeads({ segment, target, budgetMs: segments.length === 1 ? 240_000 : 115_000 }));
    }
    console.log("[ba-leads]", JSON.stringify(results.map((r, i) => ({ segment: segments[i], addedToday: r.addedToday, addedThisRun: r.addedThisRun, tasks: r.tasks }))));
    return Response.json({ ok: true, results, ...results[0] });
  } catch (error) {
    console.error("[ba-leads-error]", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Lead-Suche fehlgeschlagen." }, { status: 500 });
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
