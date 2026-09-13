import { DAILY_QUALITY_BUFFER_TARGET, DAILY_QUALITY_TARGET, getDailyQualityLeadReport } from "./daily-quality-leads";
import { runQualitySupplyDiscovery } from "./quality-lead-discovery";
import { runStrictQualityQualificationBatch } from "./strict-quality-qualifier";

export async function runQualityLeadCycle(batchSize = 15) {
  const before = await getDailyQualityLeadReport();
  if (before.ready >= DAILY_QUALITY_BUFFER_TARGET) {
    return { ok: true, skipped: true, reason: "buffer_reached", before, after: before, strict: null, discovery: null };
  }

  // Discovery und Qualifizierung arbeiten auf getrennten Kandidatenmengen:
  // Discovery fügt nur neue/aktualisierte Firmen hinzu, Gate v3 entscheidet anschließend unabhängig über A+.
  const [strictResult, discoveryResult] = await Promise.allSettled([
    runStrictQualityQualificationBatch(batchSize),
    runQualitySupplyDiscovery(),
  ]);

  const strict = strictResult.status === "fulfilled"
    ? strictResult.value
    : { selected: 0, passed: 0, rejected: 0, qualified: [], failed: [strictResult.reason instanceof Error ? strictResult.reason.message : String(strictResult.reason)] };
  const discovery = discoveryResult.status === "fulfilled"
    ? discoveryResult.value
    : { discovered: 0, jobSeeds: 0, task: "", warning: discoveryResult.reason instanceof Error ? discoveryResult.reason.message : String(discoveryResult.reason) };

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
  const maxCycles = Math.max(1, Math.min(120, options.maxCycles ?? 80));
  const batchSize = Math.max(1, Math.min(20, options.batchSize ?? 15));
  const timeBudgetMs = Math.max(10_000, Math.min(280_000, options.timeBudgetMs ?? 250_000));
  const before = await getDailyQualityLeadReport();
  let report = before;
  let stalled = 0;
  const cycles: Array<Record<string, unknown>> = [];

  while (report.ready < DAILY_QUALITY_BUFFER_TARGET && cycles.length < maxCycles && Date.now() - startedAt < timeBudgetMs) {
    const cycle = await runQualityLeadCycle(batchSize);
    report = cycle.after;
    const activity = Number(cycle.strict?.selected || 0) + Number(cycle.discovery?.discovered || 0) + Number(cycle.discovery?.jobSeeds || 0);
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
      jobSeeds: cycle.discovery?.jobSeeds || 0,
      discoveryTask: cycle.discovery?.task || "",
      discoveryWarning: cycle.discovery?.warning || "",
    });
    if (cycle.skipped || stalled >= 12) break;
  }

  return {
    ok: true,
    target: DAILY_QUALITY_TARGET,
    bufferTarget: DAILY_QUALITY_BUFFER_TARGET,
    reachedTarget: report.ready >= DAILY_QUALITY_TARGET,
    reachedBuffer: report.ready >= DAILY_QUALITY_BUFFER_TARGET,
    before,
    after: report,
    cycles,
    elapsedMs: Date.now() - startedAt,
    stoppedBecause:
      report.ready >= DAILY_QUALITY_BUFFER_TARGET ? "buffer_reached" :
      cycles.length >= maxCycles ? "cycle_limit" :
      stalled >= 12 ? "stalled" :
      Date.now() - startedAt >= timeBudgetMs ? "time_budget" : "complete",
  };
}
