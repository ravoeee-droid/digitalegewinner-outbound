import { getSalesOverview } from "@/lib/sales-os";
import { syncLegacyLeads } from "@/lib/sales-os-migration";
import { restoreTriggerScores } from "@/lib/trigger-score-sync";
import { getSalesTriggerSnapshots, reconcileSalesTriggers } from "@/lib/sales-trigger-engine";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspace = url.searchParams.get("workspace") || "default";
    const migration = await syncLegacyLeads(workspace);
    const websiteTriggerScores = await restoreTriggerScores(workspace);
    const behaviorTriggerSync = await reconcileSalesTriggers(workspace, 100);
    const [overview, triggerSnapshots] = await Promise.all([
      getSalesOverview(workspace),
      getSalesTriggerSnapshots(workspace),
    ]);
    const triggerByLead = new Map(triggerSnapshots.map((snapshot) => [snapshot.lead_id, snapshot]));
    const leads = overview.leads.map((lead) => ({ ...lead, ...(triggerByLead.get(lead.id) || {}) }));
    return Response.json({ ...overview, leads, migration, websiteTriggerScores, behaviorTriggerSync });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "CRM-Übersicht konnte nicht geladen werden." },
      { status: 503 },
    );
  }
}
