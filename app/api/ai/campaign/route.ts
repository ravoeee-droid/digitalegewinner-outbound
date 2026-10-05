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
  firstStepSubjectVariantB: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    const prompt = `Erstelle als erstklassiger B2B-Outbound-Stratege für Digitale Gewinner eine seriöse, hochpersonalisierbare Cold-E-Mail-Kampagne. Zielgruppe: ${input.audience}. Angebot/Nutzen: ${input.offer}. Absender: ${input.sender}. Ton: ${input.tone}. Nutze konsequent den Hand-Raiser-Mechanismus: Verkaufe in der ersten Nachricht nicht die Dienstleistung, sondern formuliere ein konkretes gewünschtes Ergebnis bzw. gelöstes Problem und stelle eine kleine Ja/Nein-Frage. Die erste Mail soll sehr kurz sein und möglichst auf einem echten Lead-Signal basieren. Kein Gratis-Entwurf, kein Rabatt-Pitch und kein Preis in der ersten Nachricht. Bei positiver Reaktion soll der nächste Schritt bevorzugt ein kurzes 5-Minuten-Video sein, das den konkreten Weg zum Ergebnis für den Betrieb demonstriert; ein Termin ist erst danach nötig, wenn noch Fragen offen sind. Zeige im Video-/Follow-up-Konzept zuerst das Resultat bzw. den zukünftigen Zustand und erst danach die Methode. Preise, falls sie in späteren Schritten genannt werden, immer im Verhältnis zum wirtschaftlichen Wert des Ergebnisses kontextualisieren. Keine erfundenen Zahlen, keine falschen Referenzen, keine garantierten Ergebnisse, keine Spam-Tricks und keine Behauptung über Kontakte zu Bewerbern, wenn dafür kein echtes Signal vorliegt. Follow-ups bringen jeweils einen neuen, kurzen Grund zu antworten und wirken nicht wie Sales-Nachfasserei. Verwende nur {{first_name}}, {{company}}, {{city}}, {{analysis_link}}. Liefere zusätzlich firstStepSubjectVariantB: eine zweite, inhaltlich klar andere Betreffzeile für die erste Nachricht, bevorzugt Frage vs. konkrete Beobachtung, zum A/B-Test der Öffnungsrate. Antworte ausschließlich als valides JSON: {"name":"...","audience":"...","angle":"...","callOpening":"...","steps":[{"waitDays":0,"subject":"...","body":"..."},{"waitDays":3,"subject":"...","body":"..."},{"waitDays":7,"subject":"...","body":"..."}],"firstStepSubjectVariantB":"..."}`;
    const response = await runDgAgentModel({ messages: [{ role: "user", content: prompt }], mode: "smart" });
    const raw = response.content.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return Response.json({ ...outputSchema.parse(JSON.parse(raw)), _provider: response.provider, _model: response.model });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Kampagne konnte nicht erstellt werden." }, { status: 400 });
  }
}
