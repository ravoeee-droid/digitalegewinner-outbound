import { z } from "zod";
import { discoverBusinesses } from "@/lib/business-discovery";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
  query: z.string().min(3).max(300),
  pageSize: z.number().int().min(1).max(20).default(20),
  pageToken: z.string().max(1000).optional().default(""),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const result = await discoverBusinesses({ query: input.query, pageSize: input.pageSize, pageToken: input.pageToken });
    const leads = result.leads.map((lead) => ({
      ...lead,
      employees: 0,
      roofArea: 0,
      pvExisting: false,
      energyScore: 0,
      intentScore: 0,
      stage: "Research",
      dealValue: 0,
      notes: `Quelle: ${lead.source === "google-places" ? "Google Places" : "OpenStreetMap"} · Deutschland Coverage Radar`,
    }));
    return Response.json({ leads, count: leads.length, nextPageToken: result.nextPageToken, source: result.source, warning: result.warning || "" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Lead-Suche fehlgeschlagen." }, { status: 400 });
  }
}
