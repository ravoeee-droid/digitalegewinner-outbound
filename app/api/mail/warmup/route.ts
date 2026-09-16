import { getWarmupStatus } from "@/lib/mail-warmup";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json(await getWarmupStatus());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Warmup-Status konnte nicht geladen werden." }, { status: 503 });
  }
}
