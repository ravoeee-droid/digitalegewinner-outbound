import { runQualityLeadCycle } from "@/lib/quality-lead-runner";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}

async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await runQualityLeadCycle(15);
    return Response.json({ ...result, quality: result.after });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Quality-Lead-Cycle fehlgeschlagen." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
