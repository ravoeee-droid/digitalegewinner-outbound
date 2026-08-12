import { scanDueCompanies } from "@/lib/sales-triggers";
import { restoreTriggerScores } from "@/lib/trigger-score-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}

async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await scanDueCompanies("default", 1);
    const scoreSync = await restoreTriggerScores("default");
    return Response.json({ ok: true, ...result, scoreSync });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Trigger-Cron fehlgeschlagen." }, { status: 503 });
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
