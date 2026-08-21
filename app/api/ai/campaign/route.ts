import OpenAI from "openai";
import { z } from "zod";
import { getSecret } from "@/lib/secrets";

export const runtime = "nodejs";

const inputSchema = z.object({
  audience: z.string().min(3).max(1000),
  offer: z.string().min(3).max(1000),
  sender: z.string().max(200).default("Pflege Recruiting OS"),
  tone: z.string().max(160).default("menschlich, seriös, knapp, persönlich"),
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
    const apiKey = process.env.OPENAI_API_KEY || await getSecret("openai_api_key");
    if (!apiKey) return Response.json({ error: "OpenAI ist noch nicht verbunden." }, { status: 503 });

    const client = new OpenAI({ apiKey });
    const prompt = `Du bist ein erstklassiger B2B-Outbound-Stratege mit Spezialisierung auf Mitarbeitergewinnung in der deutschen Pflegebranche. Erstelle eine seriöse, hochpersonalisierbare Kampagne für: ${input.audience}. Angebot/Nutzen: ${input.offer}. Absender: ${input.sender}. Ton: ${input.tone}.

Kontext: Angesprochen werden typischerweise ambulante Pflegedienste, Pflegeanbieter, PDL oder Geschäftsführungen. Relevante Themen können Arbeitgeberpositionierung, Karriere-Seite, mobile Schnellbewerbung, Mitarbeiterstimmen, Bewerbungsreibung und Social Recruiting sein. Beziehe dich aber nur auf Punkte, die über {{analysis_link}} tatsächlich belegt werden können; erfinde keine Website-Mängel.

Ziel ist eine qualifizierte Antwort oder ein Gespräch. Keine erfundenen Zahlen, keine falschen Referenzen, keine garantierten Bewerberzahlen, keine künstliche Dringlichkeit, keine Spam-Tricks und keine irreführenden Behauptungen. Pflegefachkräftemangel darf als Kontext erwähnt werden, aber nicht dramatisiert werden. Die erste Nachricht soll kurz, relevant und leicht beantwortbar sein. Follow-ups sollen neue Information liefern oder einen einfachen Ausstieg anbieten. Verwende nur {{first_name}}, {{company}}, {{city}}, {{analysis_link}}.

Gib ausschließlich valides JSON zurück: {"name":"...","audience":"...","angle":"...","callOpening":"...","steps":[{"waitDays":0,"subject":"...","body":"..."},{"waitDays":3,"subject":"...","body":"..."},{"waitDays":7,"subject":"...","body":"..."}]}`;

    const response = await client.responses.create({ model: process.env.OPENAI_MODEL || "gpt-5", input: prompt });
    const raw = response.output_text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return Response.json(outputSchema.parse(JSON.parse(raw)));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Kampagne konnte nicht erstellt werden." }, { status: 400 });
  }
}
