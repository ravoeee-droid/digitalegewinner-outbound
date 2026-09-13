import { DAILY_QUALITY_TARGET, getDailyQualityLeadReport } from "./daily-quality-leads";
import { runLeadFactoryCycle } from "./daily-lead-factory";
import { runStrictQualityQualificationBatch } from "./strict-quality-qualifier";

export async function runQualityLeadCycle(batchSize = 10) {
  const before = await getDailyQualityLeadReport();
  if (before.ready >= DAILY_QUALITY_TARGET) {
    return { ok: true, skipped: true, reason: "target_reached", before, after: before, strict: null, discovery: null };
  }

  const strict = await runStrictQualityQualificationBatch(batchSize);
  let discovery: Awaited<ReturnType<typeof runLeadFactoryCycle>> | null = null;
  if (strict.selected === 0) discovery = await runLeadFactoryCycle(5);
  const after = await getDailyQualityLeadReport();

  return {
    ok: true,
    skipped: false,
    before,
    after,
    strict,
    discovery,
  };
}

export async function runQualityLeadFill(options: { maxCycles?: number; timeBudgetMs?: number; batchSize?: number } = {}) {
  const startedAt = Date.now();
  const maxCycles = Math.max(1, Math.min(60, options.maxCycles ?? 20));
  const batchSize = Math.max(1, Math.min(20, options.batchSize ?? 10));
  const timeBudgetMs = Math.max(10_000, Math.min(280_000, options.timeBudgetMs ?? 250_000));
  const before = await getDailyQualityLeadReport();
  let report = before;
  let stalled = 0;
  const cycles: Array<Record<string, unknown>> = [];

  while (report.ready < DAILY_QUALITY_TARGET && cycles.length < maxCycles && Date.now() - startedAt < timeBudgetMs) {
    const cycle = await runQualityLeadCycle(batchSize);
    report = cycle.after;
    const activity = Number(cycle.strict?.selected || 0) + Number(cycle.discovery?.discovered || 0) + Number(cycle.discovery?.qualified?.length || 0);
    if (report.ready > Number(cycle.before.ready || 0) || activity > 0) stalled = 0;
    else stalled += 1;
    cycles.push({
      cycle: cycles.length + 1,
      readyBefore: cycle.before.ready,
      readyAfter: cycle.after.ready,
      strictSelected: cycle.strict?.selected || 0,
      strictPassed: cycle.strict?.passed || 0,
      strictRejected: cycle.strict?.rejected || 0,
      strictFailed: cycle.strict?.failed || [],
      discovered: cycle.discovery?.discovered || 0,
      discoveryTask: cycle.discovery?.discoveryTask || "",
      discoveryWarning: cycle.discovery?.discoveryWarning || "",
    });
    if (cycle.skipped || stalled >= 8) break;
  }

  return {
    ok: true,
    target: DAILY_QUALITY_TARGET,
    reachedTarget: report.ready >= DAILY_QUALITY_TARGET,
    before,
    after: report,
    cycles,
    elapsedMs: Date.now() - startedAt,
    stoppedBecause:
      report.ready >= DAILY_QUALITY_TARGET ? "target_reached" :
      cycles.length >= maxCycles ? "cycle_limit" :
      stalled >= 8 ? "stalled" :
      Date.now() - startedAt >= timeBudgetMs ? "time_budget" : "complete",
  };
}
