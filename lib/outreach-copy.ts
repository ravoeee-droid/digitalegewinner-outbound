// Kurze Erstmail: höchstens 3 Sätze, Sie-Form, jede Mail mit Firma, Ort und konkreter Stelle.
// Es werden nur Angaben aus dem Lead benutzt, keine erfundenen Zahlen oder Referenzen.
const SIGNATURE = "Raphael Hermann\nDigitale Gewinner";

export type CopyLead = { lead_id: string; company: string; contact: string; city: string; title: string };

export function cleanJobTitle(raw: string) {
  const first = String(raw || "").split(/\s[-–—|:]\s/)[0];
  const title = first.replace(/\((?:[mwdfgx*\/]+\s*)+\)/gi, "").replace(/\s+/g, " ").trim();
  return title && title.length <= 70 ? title : "Pflegefachkraft";
}

function greeting(contact: string) {
  const name = contact.trim();
  return name ? `Guten Tag ${name},` : "Guten Tag,";
}

function hash(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function firstTouch(lead: CopyLead) {
  const variant = hash(lead.lead_id || lead.company) % 2 === 0 ? "A" : "B";
  const title = cleanJobTitle(lead.title);
  const where = lead.city.trim() ? ` in ${lead.city.trim()}` : "";
  const hook = variant === "A"
    ? `${lead.company} hat aktuell die Stelle ${title}${where} ausgeschrieben.`
    : `Ich habe Ihre Stellenanzeige für ${title}${where} gesehen.`;
  const offer = "Ich gewinne für Pflegebetriebe Bewerber über gezielte Online-Werbung.";
  const ask = variant === "A" ? "Haben Sie diese Woche 15 Minuten für ein Gespräch?" : "Passt Ihnen dafür Dienstag oder Donnerstag?";
  const sentences = [hook, offer, ask];
  return {
    variant,
    subject: `${title} bei ${lead.company}`.slice(0, 78),
    body: `${greeting(lead.contact)}\n\n${sentences.join(" ")}\n\n${SIGNATURE}`,
  };
}

export function followUp(lead: Pick<CopyLead, "company" | "contact" | "title">, step: number) {
  const title = cleanJobTitle(lead.title);
  if (step === 1) {
    return { subject: `Re: ${title} bei ${lead.company}`.slice(0, 78), body: `${greeting(lead.contact)}\n\nKurze Nachfrage zu Ihrer Stelle ${title}. Haben Sie dafür diese Woche 15 Minuten?\n\n${SIGNATURE}` };
  }
  return { subject: `Re: ${title} bei ${lead.company}`.slice(0, 78), body: `${greeting(lead.contact)}\n\nDas ist meine letzte Nachricht dazu. Ist die Stelle besetzt, sagen Sie es mir kurz, dann melde ich mich nicht mehr.\n\n${SIGNATURE}` };
}
