import { cookies } from "next/headers";
import OpenAI from "openai";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";

export const runtime = "nodejs";
const kinds = ["reel","carousel","caption","story","weekly-plan","profile-audit","comment","reply","dm","repurpose","post-audit","viral-analysis","humanize"] as const;
export async function POST(request: Request) {
  const cookie = await cookies();
  if (!sessionRole(cookie.get(adminCookieName())?.value)) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });
  let payload: Record<string,unknown>;
  try { payload = await request.json(); } catch { return Response.json({error:"Ungültiges JSON"}, {status:400}); }
  const kind = String(payload.kind || "");
  const industry = String(payload.industry || "Pflege");
  const brief = String(payload.brief || "").trim().slice(0,9000);
  const voice = String(payload.voice || "").slice(0,3000);
  if (!kinds.includes(kind as typeof kinds[number]) || !brief) return Response.json({error:"Funktion und Briefing erforderlich"}, {status:400});
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({error:"OPENAI_API_KEY im Deployment fehlt"}, {status:503});
  try {
    const client = new OpenAI({apiKey:key});
    const response = await client.responses.create({
      model: process.env.DG_CONTENT_MODEL || "gpt-4.1-mini",
      instructions: [
        "Du bist DG Content Intelligence, deutschsprachiger B2B-Content-Stratege für Digitale Gewinner.",
        "Schreibe natürliche, konkrete, nicht marktschreierische Inhalte mit Fokus auf Entscheider in Pflege und Handwerk.",
        "Nie Referenz-Posts kopieren, nie Kundenergebnisse erfinden, keine Reichweitenzahlen erfinden.",
        "Wenn Viraldaten oder Profilmetriken fehlen, kennzeichne die Analyse als hypothesenbasiert; keine Recherche vortäuschen.",
        "Drei alternative Hooks, eine starke finale Version, Skript bzw. Struktur, CTA sowie Aufnahme-/Visual-Hinweise wo sinnvoll.",
        "Das Ziel sind qualifizierte Gespräche über intelligente Websysteme, Recruiting und Leadgewinnung, nicht nur Likes.",
        "Alle Vorschläge sind Entwürfe. Keine Zusage über automatisches Posting oder DMs.",
        "Formatiere lesbar in Markdown."
      ].join("\n"),
      input: "Aufgabe: "+kind+"\nBranche: "+industry+"\nVoice Guide: "+voice+"\nBriefing/Referenzen:\n"+brief,
      max_output_tokens: 2600
    });
    return Response.json({draft:response.output_text || "Keine Ausgabe erhalten",status:"draft"});
  } catch (e) { return Response.json({error:e instanceof Error?e.message:"Generierung fehlgeschlagen"},{status:502}); }
}
