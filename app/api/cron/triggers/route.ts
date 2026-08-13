import { ensureSalesOsSchema } from "@/lib/sales-os";
import { scanDueCompanies } from "@/lib/sales-triggers";
import { restoreTriggerScores } from "@/lib/trigger-score-sync";
import { reconcileSalesTriggers } from "@/lib/sales-trigger-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}

async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(request.url);
    const eventLimit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 200)));
    await ensureSalesOsSchema();
    const websiteSignals = await scanDueCompanies("default", 1);
    const websiteScoreSync = await restoreTriggerScores("default");
    const behaviorSignals = await reconcileSalesTriggers("default", eventLimit);
    return Response.json({ ok: true, websiteSignals, websiteScoreSync, behaviorSignals });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Trigger-Cron fehlgeschlagen." }, { status: 503 });
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
