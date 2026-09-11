import { z } from "zod";
import { runDgAgentModel } from "@/lib/dg-agent-provider";

export const runtime = "nodejs";

const inputSchema = z.object({
  audience: z.string().min(3).max(1000),
  offer: z.string().min(3).max(1000),
  sender: z.string().max(200).default("Digitale Gewinner"),
  tone: z.string().max(100).default("seriös, knapp, persönlich"),
});
const outputSchema = z.object({
  name: z.string(), audience: z.string(), angle: z.string(), callOpening: z.string(),
  steps: z.array(z.object({ waitDays: z.number().int().min(0).max(30), subject: z.string(), body: z.string() })).min(3).max(5),
});

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    const prompt = `Erstelle als erstklassiger B2B-Outbound-Stratege für Digitale Gewinner eine seriöse, hochpersonalisierbare Cold-E-Mail-Kampagne. Zielgruppe: ${input.audience}. Angebot/Nutzen: ${input.offer}. Absender: ${input.sender}. Ton: ${input.tone}. Ziel ist eine qualifizierte Antwort oder ein Gespräch. Keine erfundenen Zahlen, keine falschen Referenzen, keine garantierten Ergebnisse, keine Spam-Tricks. Die erste Nachricht soll kurz und relevant sein; Follow-ups bringen neue Information oder einen einfachen Ausstieg. Verwende nur {{first_name}}, {{company}}, {{city}}, {{analysis_link}}. Antworte ausschließlich als valides JSON: {"name":"...","audience":"...","angle":"...","callOpening":"...","steps":[{"waitDays":0,"subject":"...","body":"..."},{"waitDays":3,"subject":"...","body":"..."},{"waitDays":7,"subject":"...","body":"..."}]}`;
    const response = await runDgAgentModel({ messages: [{ role: "user", content: prompt }], mode: "smart" });
    const raw = response.content.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return Response.json({ ...outputSchema.parse(JSON.parse(raw)), _provider: response.provider, _model: response.model });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Kampagne konnte nicht erstellt werden." }, { status: 400 });
  }
}
