import OpenAI from "openai";
import { z } from "zod";

export const runtime = "nodejs";

const inputSchema = z.object({
  audience: z.string().min(3).max(1000),
  offer: z.string().min(3).max(1000),
  sender: z.string().max(200).default("Walkenhorst Energie"),
  tone: z.string().max(100).default("seriös, knapp, persönlich"),
});

const outputSchema = z.object({
  name: z.string(),
  audience: z.string(),
  angle: z.string(),
  callOpening: z.string(),
  steps: z.array(z.object({ waitDays: z.number().int().min(0).max(30), subject: z.string(), body: z.string() })).min(3).max(5),
});

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    if (!process.env.OPENAI_API_KEY) return Response.json({ error: "OPENAI_API_KEY fehlt." }, { status: 503 });
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `Du bist B2B-Outbound-Stratege für Energieberatung. Erstelle eine seriöse Cold-E-Mail-Kampagne für: ${input.audience}. Angebot: ${input.offer}. Absender: ${input.sender}. Ton: ${input.tone}. Keine erfundenen Einsparzahlen, keine garantierten Förderungen, keine Spam-Tricks. Verwende Variablen {{first_name}}, {{company}}, {{city}}, {{analysis_link}}. Gib ausschließlich valides JSON in diesem Format zurück: {"name":"...","audience":"...","angle":"...","callOpening":"...","steps":[{"waitDays":0,"subject":"...","body":"..."},{"waitDays":3,"subject":"...","body":"..."},{"waitDays":7,"subject":"...","body":"..."}]}`;
    const response = await client.responses.create({ model: process.env.OPENAI_MODEL || "gpt-5", input: prompt });
    const raw = response.output_text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const parsed = outputSchema.parse(JSON.parse(raw));
    return Response.json(parsed);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Kampagne konnte nicht erstellt werden." }, { status: 400 });
  }
}
