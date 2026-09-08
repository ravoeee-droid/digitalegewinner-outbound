import { z } from "zod";
import {
  getWebsiteSalesPipelineStats,
  refreshDeepWebsiteSalesIntelligence,
  refreshStoredWebsiteSalesIntelligence,
} from "@/lib/website-sales-intelligence";

export const runtime = "nodejs";
export const maxDuration = 60;

const actionSchema = z.object({
  action: z.enum(["refresh", "deep-refresh"]),
  limit: z.number().int().min(1).max(20).optional(),
});

function workspaceOf(request: Request) {
  return new URL(request.url).searchParams.get("workspace") || "default";
}

export async function GET(request: Request) {
  try {
    const workspace = workspaceOf(request);
    await refreshStoredWebsiteSalesIntelligence(workspace);
    return Response.json(await getWebsiteSalesPipelineStats(workspace));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Website-Intelligence konnte nicht geladen werden." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const workspace = workspaceOf(request);
    const input = actionSchema.parse(await request.json());
    const refresh = input.action === "deep-refresh"
      ? await refreshDeepWebsiteSalesIntelligence(workspace, input.limit || 10)
      : await refreshStoredWebsiteSalesIntelligence(workspace);
    return Response.json({ refresh, stats: await getWebsiteSalesPipelineStats(workspace) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Website-Intelligence konnte nicht aktualisiert werden." }, { status: 400 });
  }
}
