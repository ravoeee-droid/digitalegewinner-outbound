// KI-Chat auf der persönlichen Videoseite. Der Assistent gibt sich offen als KI aus und leitet an Raphael (WhatsApp/Termin) weiter.
import { getSecret } from "@/lib/secrets";

const BASE_URL = "https://api.experientiallabs.ai/v1";

export const WHATSAPP_NUMBER = "4971134063951";

type ChatMessage = { role: "user" | "assistant"; content: string };

function systemPrompt(segment: "pflege" | "pv", company: string) {
  const audience = segment === "pv"
    ? "Photovoltaik- und Elektro-Betriebe, die exklusive Kundenanfragen unter ihrem eigenen Namen statt Leadportale wollen."
    : "Pflegedienste und Pflegeheime, die Fachkräfte gewinnen wollen, ohne sich auf Stellenportale, Vermittler und Leiharbeit zu verlassen.";
  return `Du bist der KI-Assistent von Raphael Hermann (Digitale Gewinner) auf einer persönlichen Videoseite für den Betrieb "${company}".
Sag offen, dass du ein KI-Assistent bist, wenn jemand danach fragt, und gib dich nie als Mensch aus. Du siezt die Besucher.

Zielgruppe: ${audience}

Was Digitale Gewinner macht: Raphael hilft Betrieben, passende Wege zu Fachkräften oder Kundenanfragen zu finden (Vermittlung, Fachkräfte aus dem Ausland, Portale, eigene Kampagnen, Websystem mit Bewerbungs- bzw. Anfrageweg). Zuerst wird die Situation des Betriebs angeschaut, dann geprüft, was wirtschaftlich Sinn macht. Je nach Bundesland und Betrieb kann die Arbeit gefördert werden (teilweise 50 bis 80 Prozent); ob das im Einzelfall gilt, klärt Raphael im Gespräch.

Regeln:
- Antworte kurz (2 bis 4 Sätze), freundlich, ohne Agentursprache und ohne Aufzählungen, außer sie werden gewünscht.
- Erfinde niemals Preise, Fallzahlen, Kundennamen oder Garantien. Bei Preisfragen: Der Preis hängt vom Umfang ab, Raphael schätzt das im kostenlosen Gespräch ein.
- Nenne keine Ergebnisse außer: 11 neue Mitarbeiter in 4 Monaten (Maternus), 3 Pflegefachkräfte in 8 Wochen (Pflegeresidenz Rose), jeweils Einzelergebnisse ohne Garantie.
- Sobald jemand Interesse zeigt oder du etwas nicht sicher weißt: schlage ein 15-minütiges kostenloses Gespräch vor (Terminkalender auf dieser Seite) oder eine Nachricht an Raphael auf WhatsApp.
- Gib keine Rechts-, Förder- oder Steuerberatung. Verweise dafür auf das Gespräch.`;
}

export async function askVideoChat(messages: ChatMessage[], segment: "pflege" | "pv", company: string) {
  const key = process.env.EXPLABS_API_KEY || process.env.EXPERIENTIAL_API_KEY || (await getSecret("experiential_api_key"));
  if (!key) return { error: "Der Chat ist gerade nicht verfügbar. Schreiben Sie uns gern auf WhatsApp." };
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.EXPERIENTIAL_MODEL_FAST || "deepseek-v4-flash",
      messages: [{ role: "system", content: systemPrompt(segment, company) }, ...messages],
      max_tokens: 350,
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!response?.ok) return { error: "Die Antwort konnte nicht geladen werden. Schreiben Sie uns gern auf WhatsApp." };
  const data = await response.json().catch(() => null);
  const reply = data?.choices?.[0]?.message?.content;
  return typeof reply === "string" && reply.trim() ? { reply: reply.trim() } : { error: "Unerwartete Antwort. Schreiben Sie uns gern auf WhatsApp." };
}
