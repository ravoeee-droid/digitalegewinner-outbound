// Kurze Erstmail: höchstens 3 Sätze, Sie-Form, jede Mail mit Stelle und Ort des Betriebs.
// Es werden nur Angaben aus dem Lead und das Angebot (20 Minuten, Strategie auch ohne Zusammenarbeit) benutzt.
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
        `Ihre Stelle als ${title} ${region} ist ausgeschrieben, und dafür habe ich einen Plan.`,
        "In 20 Minuten legen wir Ziel und Zeitrahmen für die Besetzung fest, danach bekommen Sie eine maßgeschneiderte Strategie, auch wenn Sie nicht mit uns arbeiten.",
        "Passt Ihnen Dienstag oder Donnerstag?",
      ]
    : [
        `Wie lange ist Ihre Stelle als ${title} ${region} schon offen?`,
        "Ich zeige Ihnen in 20 Minuten, wie sie sich mit festem Ziel und Zeitrahmen besetzen lässt, die Strategie dazu behalten Sie in jedem Fall.",
        "Passt Ihnen Dienstag oder Donnerstag?",
      ];
  return {
    variant,
    subject: (variant === "A" ? `Ihre Stelle: ${title} ${region}` : `${title} ${region}: seit wann offen?`).slice(0, 78),
    body: `${greeting(lead.contact)}\n\n${sentences.join(" ")}\n\n${SIGNATURE}`,
  };
}

export function followUp(lead: Pick<CopyLead, "company" | "contact" | "title">, step: number) {
  const title = cleanJobTitle(lead.title);
  const subject = `Re: ${title} bei ${lead.company}`.slice(0, 78);
  if (step === 1) {
    return { subject, body: `${greeting(lead.contact)}\n\nKurz zu meiner Nachricht: 20 Minuten, danach haben Sie eine maßgeschneiderte Strategie für Ihre Stelle ${title}, unverbindlich. Passt es Ihnen diese Woche?\n\n${SIGNATURE}` };
  }
  return { subject, body: `${greeting(lead.contact)}\n\nDas ist meine letzte Nachricht dazu. Ist die Stelle besetzt, sagen Sie es mir kurz, dann melde ich mich nicht mehr.\n\n${SIGNATURE}` };
}
