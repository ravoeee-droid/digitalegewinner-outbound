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
  const city = lead.city.trim();
  const region = city ? `in ${city}` : "in Ihrer Region";
  const sentences = variant === "A"
    ? [
        `Ihre Anzeige für ${title} ${region} erreicht nur Pflegekräfte, die gerade aktiv suchen.`,
        "Das ist die kleinste Gruppe: Die Besten haben einen Job und scrollen abends durch Instagram und Facebook.",
        `Ich zeige Ihnen in 15 Minuten, wie Sie genau diese Pflegekräfte ${region} erreichen, danach entscheiden Sie.`,
      ]
    : [
        `Wie viele Pflegekräfte ${region} haben Ihre Anzeige für ${title} diese Woche gesehen?`,
        "Wenn Sie die Zahl nicht kennen, verschenken Sie Bewerber.",
        "Ich zeige Ihnen in 15 Minuten, wie Sie sie messen und deutlich erhöhen, passt Ihnen Dienstag oder Donnerstag?",
      ];
  return {
    variant,
    subject: (variant === "A" ? `${lead.company}: Ihre Anzeige für ${title}` : `${title} ${region}: wer sieht Ihre Anzeige?`).slice(0, 78),
    body: `${greeting(lead.contact)}\n\n${sentences.join(" ")}\n\n${SIGNATURE}`,
  };
}

export function followUp(lead: Pick<CopyLead, "company" | "contact" | "title">, step: number) {
  const title = cleanJobTitle(lead.title);
  if (step === 1) {
    return { subject: `Re: ${title} bei ${lead.company}`.slice(0, 78), body: `${greeting(lead.contact)}\n\nIch habe mir Ihre Anzeige für ${title} noch einmal angesehen. Die Frage von letzter Woche bleibt offen: Wie viele der richtigen Pflegekräfte erreichen Sie damit? 15 Minuten reichen, um das zu klären.\n\n${SIGNATURE}` };
  }
  return { subject: `Re: ${title} bei ${lead.company}`.slice(0, 78), body: `${greeting(lead.contact)}\n\nDas ist meine letzte Nachricht dazu. Ist die Stelle besetzt, sagen Sie es mir kurz, dann melde ich mich nicht mehr.\n\n${SIGNATURE}` };
}
