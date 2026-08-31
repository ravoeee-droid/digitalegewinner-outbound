import { runLeadFactoryCycle } from "@/lib/daily-lead-factory";
import { buildDailyOutboundPlan } from "@/lib/outbound-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}

async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await runLeadFactoryCycle(5);
    const outbound = await buildDailyOutboundPlan();
    return Response.json({
      ...result,
      outbound: {
        date: outbound.date,
        channels: outbound.channels,
        targets: outbound.targets,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Lead Factory fehlgeschlagen." }, { status: 500 });
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
