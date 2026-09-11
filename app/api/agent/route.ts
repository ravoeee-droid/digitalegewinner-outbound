import { z } from "zod";
import { runDgAgent } from "@/lib/dg-agent";
import { ensureDgAgentSchema, listPendingAgentActions, loadAgentHistory } from "@/lib/dg-agent-store";

export const runtime = "nodejs";
export const maxDuration = 60;

const inputSchema = z.object({
  message: z.string().min(1).max(8000),
  threadId: z.string().uuid().optional(),
  mode: z.enum(["auto", "fast", "smart", "vision"]).optional(),
});

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    return Response.json(await runDgAgent({ message: input.message, threadId: input.threadId, mode: input.mode }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "DG Core konnte den Befehl nicht verarbeiten." }, { status: 400 });
  }
}

export async function GET(request: Request) {
  try {
    await ensureDgAgentSchema();
    const threadId = new URL(request.url).searchParams.get("threadId") || "";
    if (!threadId) return Response.json({ history: [], pendingApprovals: [] });
    const [history, pending] = await Promise.all([loadAgentHistory(threadId, 30), listPendingAgentActions(threadId)]);
    return Response.json({ history, pendingApprovals: pending.map((row) => ({ id: row.id, tool: row.tool_name, args: row.args, risk: row.risk, expiresAt: row.expires_at })) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Agent-Verlauf nicht erreichbar." }, { status: 400 });
  }
}
