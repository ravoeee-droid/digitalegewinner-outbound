import { z } from "zod";
import { runWebsiteAudit } from "@/lib/website-audit";
import { analyzePflegeRecruiting } from "@/lib/pflege-recruiting";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
  url: z.string().min(3).max(500),
  company: z.string().max(250).optional().default(""),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const audit = await runWebsiteAudit(input.url, input.company);
    const recruiting = analyzePflegeRecruiting(audit);
    return Response.json({ ok: true, audit, recruiting });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Pflege-Recruiting-Analyse fehlgeschlagen." },
      { status: 400 },
    );
  }
}
