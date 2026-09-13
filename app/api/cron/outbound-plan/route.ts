import { buildDailyOutboundPlan } from "@/lib/outbound-engine";

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
    const outbound = await buildDailyOutboundPlan();
    return Response.json({
      ok: true,
      date: outbound.date,
      targets: outbound.targets,
      channels: outbound.channels,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Outbound-Plan konnte nicht gebaut werden." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
