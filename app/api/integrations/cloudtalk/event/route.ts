import { z } from "zod";
import { recordCloudTalkEvent } from "@/lib/telephony";

export const runtime = "nodejs";

const schema = z.object({
  leadId: z.string().max(200).optional().default(""),
  company: z.string().max(300).optional().default(""),
  event: z.string().min(1).max(100),
  properties: z.record(z.string(), z.unknown()).optional().default({}),
});

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Ungültiges CloudTalk-Event." }, { status: 400 });
    const call = await recordCloudTalkEvent(parsed.data);
    return Response.json({ ok: true, call });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "CloudTalk-Event konnte nicht gespeichert werden." }, { status: 503 });
  }
}
