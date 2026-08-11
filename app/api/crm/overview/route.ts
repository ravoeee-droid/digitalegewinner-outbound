import { getSalesOverview } from "@/lib/sales-os";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspace = url.searchParams.get("workspace") || "default";
    const overview = await getSalesOverview(workspace);
    return Response.json(overview);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "CRM-Übersicht konnte nicht geladen werden." },
      { status: 503 },
    );
  }
}
