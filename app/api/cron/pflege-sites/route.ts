import { pflegeSitesStats, processPflegeSites } from "@/lib/pflege-sites";
import { ensureSalesOsSchema } from "@/lib/sales-os";
import { countTodaysBaLeads } from "@/lib/ba-lead-source";

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
    // Nur auffüllen, solange heute noch weniger als das Tagesziel an Pflege-Leads da ist.
    const target = Number(process.env.BA_LEADS_PER_DAY) || 150;
    const today = await countTodaysBaLeads("ba-jobboerse");
    const result = today >= target ? { checked: 0, added: 0, seconds: 0 } : await processPflegeSites({ limit: target - today });
    const stats = await pflegeSitesStats();
    console.log("[pflege-sites]", JSON.stringify({ today, ...result, stats }));
    return Response.json({ ok: true, today, ...result, stats });
  } catch (error) {
    console.error("[pflege-sites-error]", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Pflege-Betriebe fehlgeschlagen." }, { status: 500 });
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
