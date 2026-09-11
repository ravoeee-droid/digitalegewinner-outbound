import { dgAgentProviderStatus } from "@/lib/dg-agent-provider";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json(await dgAgentProviderStatus());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Provider-Status nicht erreichbar." }, { status: 503 });
  }
}
