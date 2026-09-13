import { task } from "@trigger.dev/sdk";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function endpoint() {
  const base = String(process.env.DG_APP_BASE_URL || "").trim().replace(/\/$/, "");
  if (!base) throw new Error("DG_APP_BASE_URL fehlt.");
  return `${base}/api/cron/quality-lead-cycle`;
}

async function runCycle() {
  const secret = String(process.env.DG_CRON_SECRET || process.env.CRON_SECRET || "").trim();
  if (!secret) throw new Error("DG_CRON_SECRET/CRON_SECRET fehlt.");
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error || `Quality cycle HTTP ${response.status}`));
  return data;
}

export const dgDailyQualityLeads = task({
  id: "dg-daily-quality-leads",
  retry: {
    maxAttempts: 4,
    factor: 1.6,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 30_000,
    randomize: false,
  },
  run: async payload => {
    const dailyTarget = Math.max(1, Math.min(200, Number(payload?.dailyTarget || 120)));
    const target = Math.max(dailyTarget, Math.min(400, Number(payload?.target || 240)));
    const maxCycles = Math.max(1, Math.min(160, Number(payload?.maxCycles || 120)));
    const runs = [];
    let ready = Number(payload?.ready || 0);
    let previousReady = ready;
    let stalled = 0;

    for (let cycle = 1; cycle <= maxCycles && ready < target; cycle += 1) {
      const result = await runCycle();
      ready = Number(result?.quality?.ready || 0);
      const strictSelected = Number(result?.strict?.selected || 0);
      const strictPassed = Number(result?.strict?.passed || 0);
      const strictRejected = Number(result?.strict?.rejected || 0);
      const discovered = Number(result?.discovery?.discovered || 0);
      const discoveryQualified = Array.isArray(result?.discovery?.qualified) ? result.discovery.qualified.length : 0;
      runs.push({ cycle, ready, strictSelected, strictPassed, strictRejected, discovered, discoveryQualified, skipped: Boolean(result?.skipped) });

      const activity = strictSelected + discovered + discoveryQualified;
      if (ready > previousReady || activity > 0) stalled = 0;
      else stalled += 1;
      previousReady = ready;

      if (result?.skipped || stalled >= 12) break;
      if (ready < target) await sleep(400);
    }

    return {
      ok: true,
      dailyTarget,
      target,
      ready,
      dailyDeficit: Math.max(0, dailyTarget - ready),
      bufferDeficit: Math.max(0, target - ready),
      reachedDailyTarget: ready >= dailyTarget,
      reachedBuffer: ready >= target,
      daysOfCoverage: Number((ready / dailyTarget).toFixed(2)),
      cycles: runs.length,
      stoppedBecause: ready >= target ? "buffer_reached" : stalled >= 12 ? "stalled" : runs.length >= maxCycles ? "cycle_limit" : "complete",
      runs,
    };
  },
});
