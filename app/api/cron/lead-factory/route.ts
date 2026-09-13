import { getDailyQualityLeadReport } from "@/lib/daily-quality-leads";
import { buildDailyOutboundPlan } from "@/lib/outbound-engine";
import { triggerConfigured, triggerTask } from "@/lib/oss/trigger-client";
import { runQualityLeadFill } from "@/lib/quality-lead-runner";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}

async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const before = await getDailyQualityLeadReport();
    let durableRun: Record<string, unknown> | null = null;
    let fallbackRun: Awaited<ReturnType<typeof runQualityLeadFill>> | null = null;

    if (before.ready < before.target && triggerConfigured()) {
      try {
        const date = new Date().toISOString().slice(0, 10);
        durableRun = await triggerTask(
          "dg-daily-quality-leads",
          { target: before.target, ready: before.ready, maxCycles: 48 },
          { idempotencyKey: `dg-daily-quality-leads:${date}`, idempotencyKeyTTL: "24h", tags: ["daily-quality-leads", date] },
        );
      } catch {
        fallbackRun = await runQualityLeadFill({ maxCycles: 6, batchSize: 10, timeBudgetMs: 70_000 });
      }
    } else if (before.ready < before.target) {
      fallbackRun = await runQualityLeadFill({ maxCycles: 6, batchSize: 10, timeBudgetMs: 70_000 });
    }

    const quality = fallbackRun?.after || await getDailyQualityLeadReport();
    const outbound = await buildDailyOutboundPlan();
    return Response.json({
      ok: true,
      quality,
      durableQueued: Boolean(durableRun),
      durableRun,
      fallbackRun,
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
