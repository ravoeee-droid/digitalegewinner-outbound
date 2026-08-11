import { z } from "zod";
import { runWebsiteAudit } from "@/lib/website-audit";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
  url: z.string().min(3).max(500),
  company: z.string().max(200).optional().default(""),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const audit = await runWebsiteAudit(input.url, input.company);
    return Response.json({ audit });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Website-Analyse fehlgeschlagen." },
      { status: 400 },
    );
  }
}
