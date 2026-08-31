import { z } from "zod";
import { syncOpenOutreachLeads } from "@/lib/openoutreach-bridge";
import {
  buildDailyOutboundPlan,
  dispatchLinkedInQueue,
  getOutboundEngineSnapshot,
  prepareLinkedInDrafts,
  updateOutboundTask,
} from "@/lib/outbound-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("build") }),
  z.object({ action: z.literal("openoutreach-sync"), count: z.number().int().min(1).max(100).optional() }),
  z.object({ action: z.literal("linkedin-drafts"), limit: z.number().int().min(1).max(50).optional() }),
  z.object({ action: z.literal("linkedin-dispatch"), limit: z.number().int().min(1).max(30).optional() }),
  z.object({ action: z.literal("task-status"), id: z.string().min(3), status: z.string().min(2).max(30) }),
]);

export async function GET() {
  try {
    const snapshot = await buildDailyOutboundPlan();
    return Response.json(snapshot);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Outbound Engine konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = actionSchema.parse(await request.json());
    if (input.action === "build") return Response.json(await buildDailyOutboundPlan());
    if (input.action === "openoutreach-sync") return Response.json(await syncOpenOutreachLeads(input.count));
    if (input.action === "linkedin-drafts") return Response.json(await prepareLinkedInDrafts(input.limit));
    if (input.action === "linkedin-dispatch") {
      const result = await dispatchLinkedInQueue(input.limit);
      return Response.json({ ...result, snapshot: await getOutboundEngineSnapshot() });
    }
    await updateOutboundTask(input.id, input.status);
    return Response.json(await getOutboundEngineSnapshot());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Outbound-Aktion fehlgeschlagen." }, { status: 400 });
  }
}
