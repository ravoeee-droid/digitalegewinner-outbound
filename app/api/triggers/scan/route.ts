import { z } from "zod";
import { scanCompanyTriggers, scanDueCompanies } from "@/lib/sales-triggers";
import { restoreTriggerScores } from "@/lib/trigger-score-sync";
import { reconcileSalesTriggers } from "@/lib/sales-trigger-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  workspace: z.string().min(1).max(100).optional().default("default"),
  companyId: z.string().min(1).max(200).optional(),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json().catch(() => ({})));
    const result = input.companyId
      ? await scanCompanyTriggers(input.companyId, input.workspace)
      : await scanDueCompanies(input.workspace, 1);
    const websiteScoreSync = await restoreTriggerScores(input.workspace);
    const behaviorTriggerSync = await reconcileSalesTriggers(input.workspace, 100);
    return Response.json({ ok: true, result, websiteScoreSync, behaviorTriggerSync });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Trigger-Scan fehlgeschlagen." }, { status: 400 });
  }
}
