import { z } from "zod";
import { scanCompanyTriggers, scanDueCompanies } from "@/lib/sales-triggers";
import { restoreTriggerScores } from "@/lib/trigger-score-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  workspace: z.string().min(1).max(100).optional().default("default"),
  companyId: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(10).optional().default(4),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json().catch(() => ({})));
    const result = input.companyId
      ? await scanCompanyTriggers(input.companyId, input.workspace)
      : await scanDueCompanies(input.workspace, input.limit);
    const scoreSync = await restoreTriggerScores(input.workspace);
    return Response.json({ ok: true, result, scoreSync });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Trigger-Scan fehlgeschlagen." }, { status: 400 });
  }
}
