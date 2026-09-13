import { getDailyQualityLeadReport } from "@/lib/daily-quality-leads";
import { runQualityLeadFill } from "@/lib/quality-lead-runner";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getDailyQualityLeadReport());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Quality-Lead-Report konnte nicht geladen werden." },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    return Response.json(await runQualityLeadFill({ maxCycles: 20, batchSize: 10, timeBudgetMs: 250_000 }));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Quality-Lead-Lauf konnte nicht gestartet werden." },
      { status: 500 },
    );
  }
}
