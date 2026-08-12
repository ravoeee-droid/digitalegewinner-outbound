import { getSalesOverview } from "@/lib/sales-os";
import { syncLegacyLeads } from "@/lib/sales-os-migration";
import { restoreTriggerScores } from "@/lib/trigger-score-sync";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspace = url.searchParams.get("workspace") || "default";
    const migration = await syncLegacyLeads(workspace);
    const triggerScores = await restoreTriggerScores(workspace);
    const overview = await getSalesOverview(workspace);
    return Response.json({ ...overview, migration, triggerScores });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "CRM-Übersicht konnte nicht geladen werden." },
      { status: 503 },
    );
  }
}
