import { z } from "zod";
import { getVoiceAgentStatus, startVoiceAgentCall } from "@/lib/voice-agent-bridge";

export const runtime = "nodejs";
export const maxDuration = 60;

const callSchema = z.object({
  phone: z.string().min(8).max(20),
  name: z.string().max(120).optional(),
  company: z.string().max(180).optional(),
  purpose: z.enum(["demo", "callback"]),
  consentConfirmed: z.literal(true),
  context: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export async function GET() {
  return Response.json(getVoiceAgentStatus());
}

export async function POST(request: Request) {
  try {
    const input = callSchema.parse(await request.json());
    return Response.json(await startVoiceAgentCall(input));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Voice-Agent konnte nicht gestartet werden." }, { status: 400 });
  }
}
