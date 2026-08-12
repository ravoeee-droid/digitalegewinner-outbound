import { getTriggerOverview } from "@/lib/sales-triggers";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspace = url.searchParams.get("workspace") || "default";
    return Response.json(await getTriggerOverview(workspace));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Trigger-Übersicht konnte nicht geladen werden." }, { status: 503 });
  }
}
