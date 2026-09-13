import { task } from "@trigger.dev/sdk";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function baseUrl() {
  const base = String(process.env.DG_APP_BASE_URL || "").trim().replace(/\/$/, "");
  if (!base) throw new Error("DG_APP_BASE_URL fehlt.");
  return base;
}

function authHeaders() {
  const secret = String(process.env.DG_CRON_SECRET || process.env.CRON_SECRET || "").trim();
  if (!secret) throw new Error("DG_CRON_SECRET/CRON_SECRET fehlt.");
  return {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  };
}

async function postJson(path) {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: "{}",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error || `${path} HTTP ${response.status}`));
  return data;
}

async function runCycle() {
  return postJson("/api/cron/quality-lead-cycle");
}

async function buildOutboundPlan() {
  return postJson("/api/cron/outbound-plan");
}

export const dgDailyQualityLeads = task({
  id: "dg-daily-quality-leads",
  retry: {
    maxAttempts: 4,
    factor: 1.6,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    randomize: true,
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
      const jobSeeds = Number(result?.discovery?.jobSeeds || 0);
      runs.push({ cycle, ready, strictSelected, strictPassed, strictRejected, discovered, jobSeeds, skipped: Boolean(result?.skipped) });

      const activity = strictSelected + discovered + jobSeeds;
      if (ready > previousReady || activity > 0) stalled = 0;
      else stalled += 1;
      previousReady = ready;

      if (result?.skipped || stalled >= 12) break;
      if (ready < target) await sleep(400);
    }

    if (ready < dailyTarget) {
      // Unter 120 ist der Lauf operativ nicht erfolgreich. Throw aktiviert die Trigger-Retries,
      // statt einen roten Tagesbestand fälschlich als erfolgreich abzuschließen.
      throw new Error(`Loom Lead Supply unter Tagesziel: ${ready}/${dailyTarget}. Automatischer Retry erforderlich.`);
    }

    // Absichtlich erst NACH dem Quality Gate: so entstehen nie 120 Loom-Tasks aus einem schwächeren Ersatzpool.
    const outbound = await buildOutboundPlan();

    return {
      ok: true,
      dailyTarget,
      target,
      ready,
      dailyDeficit: 0,
      bufferDeficit: Math.max(0, target - ready),
      reachedDailyTarget: true,
      reachedBuffer: ready >= target,
      daysOfCoverage: Number((ready / dailyTarget).toFixed(2)),
      outboundPlanned: true,
      outbound,
      cycles: runs.length,
      stoppedBecause: ready >= target ? "buffer_reached" : stalled >= 12 ? "daily_ready_buffer_stalled" : runs.length >= maxCycles ? "daily_ready_cycle_limit" : "daily_ready",
      runs,
    };
  },
});
