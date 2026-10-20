import { poolStats, processPvPool } from "@/lib/pv-pool";
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
    // Nur auffüllen, solange heute noch weniger als das Tagesziel an PV-Leads da ist.
    const target = Number(process.env.BA_LEADS_PER_DAY) || 150;
    const today = await countTodaysBaLeads("ba-pv");
    const result = today >= target ? { checked: 0, added: 0, seconds: 0 } : await processPvPool({ limit: target - today });
    const stats = await poolStats();
    console.log("[pv-pool]", JSON.stringify({ today, ...result, stats }));
    return Response.json({ ok: true, today, ...result, stats });
  } catch (error) {
    console.error("[pv-pool-error]", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "PV-Pool fehlgeschlagen." }, { status: 500 });
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
