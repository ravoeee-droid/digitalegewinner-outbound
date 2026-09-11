import { z } from "zod";
import { claimAgentAction, finishClaimedAgentAction } from "@/lib/dg-agent-store";
import { executeDgAgentTool } from "@/lib/dg-agent-tools";

export const runtime = "nodejs";
export const maxDuration = 60;

const inputSchema = z.object({ actionId: z.string().uuid(), decision: z.enum(["approve", "reject"]) });

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    const action = await claimAgentAction(input.actionId, input.decision);
    if (!action) return Response.json({ error: "Aktion ist abgelaufen, bereits verarbeitet oder existiert nicht." }, { status: 409 });
    if (input.decision === "reject") return Response.json({ ok: true, status: "rejected", actionId: action.id });

    try {
      const result = await executeDgAgentTool(action.tool_name, action.args || {});
      await finishClaimedAgentAction(action.id, result);
      return Response.json({ ok: true, status: "executed", actionId: action.id, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Freigegebene Aktion fehlgeschlagen.";
      await finishClaimedAgentAction(action.id, null, message);
      return Response.json({ error: message, actionId: action.id }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Freigabe konnte nicht verarbeitet werden." }, { status: 400 });
  }
}
