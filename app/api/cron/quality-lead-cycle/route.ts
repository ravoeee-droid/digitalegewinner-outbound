import { getDailyQualityLeadReport } from "@/lib/daily-quality-leads";
import { runLeadFactoryCycle } from "@/lib/daily-lead-factory";

export const runtime = "nodejs";
export const maxDuration = 90;
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}

async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const before = await getDailyQualityLeadReport();
    if (before.deficit === 0) return Response.json({ ok: true, skipped: true, quality: before });
    const cycle = await runLeadFactoryCycle(5);
    const quality = await getDailyQualityLeadReport();
    return Response.json({ ok: true, skipped: false, cycle, quality });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Quality-Lead-Cycle fehlgeschlagen." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
