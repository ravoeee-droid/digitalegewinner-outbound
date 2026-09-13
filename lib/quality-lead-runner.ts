import { DAILY_QUALITY_BUFFER_TARGET, DAILY_QUALITY_TARGET, getDailyQualityLeadReport } from "./daily-quality-leads";
import { runLeadFactoryCycle } from "./daily-lead-factory";
import { runStrictQualityQualificationBatch } from "./strict-quality-qualifier";

export async function runQualityLeadCycle(batchSize = 15) {
  const before = await getDailyQualityLeadReport();
  if (before.ready >= DAILY_QUALITY_BUFFER_TARGET) {
    return { ok: true, skipped: true, reason: "buffer_reached", before, after: before, strict: null, discovery: null };
  }

  const strict = await runStrictQualityQualificationBatch(batchSize);
  let discovery: Awaited<ReturnType<typeof runLeadFactoryCycle>> | null = null;

  // Discovery bleibt bewusst warm, solange der 2-Tages-Puffer nicht voll ist.
  // Sie läuft NACH der strengen Qualifizierung, damit v2/v3-Metadaten nicht parallel dieselben Leads überschreiben.
  if (before.ready < DAILY_QUALITY_BUFFER_TARGET) {
    discovery = await runLeadFactoryCycle(5);
  }

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
