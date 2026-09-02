import { z } from "zod";
import { enrichLeadsWithScrapling, getScraplingStatus } from "@/lib/scrapling-bridge";

export const runtime = "nodejs";
export const maxDuration = 60;

const inputSchema = z.object({ limit: z.number().int().min(1).max(25).optional() });

export async function GET() {
  return Response.json(getScraplingStatus());
}

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json().catch(() => ({})));
    return Response.json(await enrichLeadsWithScrapling(input.limit));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Scrapling-Enrichment fehlgeschlagen." }, { status: 400 });
  }
}
