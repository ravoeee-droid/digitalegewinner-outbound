// Kurze Erstmail: höchstens 3 Sätze, Du-Form, jede Mail mit Stelle und Ort des Betriebs.
// Es werden nur Angaben aus dem Lead und das Angebot (20 Minuten, Strategie auch ohne Zusammenarbeit) benutzt.
const SIGNATURE = "Raphael Hermann\nDigitale Gewinner";

export type CopyLead = { lead_id: string; company: string; contact: string; city: string; title: string };

export function cleanJobTitle(raw: string) {
  const first = String(raw || "").split(/\s[-–—|:]\s/)[0];
  const title = first.replace(/\((?:[mwdfgx*\/]+\s*)+\)/gi, "").replace(/\s+/g, " ").trim();
  return title && title.length <= 70 ? title : "Pflegefachkraft";
}

function greeting(contact: string) {
  const first = contact.trim().split(/\s+/)[0];
  return first ? `Hey ${first},` : "Hey,";
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
  const region = city ? `in ${city}` : "in eurer Region";
  const sentences = variant === "A"
    ? [
        `ich hab gesehen, dass ihr eine ${title} ${region} sucht, und kenn das Problem: Stellen, die ewig offen bleiben, obwohl man schon alles probiert hat.`,
        "Lass uns 20 Minuten telefonieren, ich schau mir eure Lage an und bau euch eine Strategie, die ihr auch ohne mich umsetzen könnt.",
        "Dienstag oder Donnerstag?",
      ]
    : [
        `Wie lange sucht ihr schon eine ${title} ${region}?`,
        "Ich schau mir mit dir in 20 Minuten an, woran es hakt, und du bekommst eine Strategie dazu, egal ob wir danach zusammenarbeiten oder nicht.",
        "Passt dir Dienstag oder Donnerstag?",
      ];
  return {
    variant,
    subject: (variant === "A" ? `${title} ${region}: kurz quatschen?` : `${title} ${region}: seit wann offen?`).slice(0, 78),
    body: `${greeting(lead.contact)}\n\n${sentences.join(" ")}\n\n${SIGNATURE}`,
  };
}

export function followUp(lead: Pick<CopyLead, "company" | "contact" | "title">, step: number) {
  const title = cleanJobTitle(lead.title);
  const subject = `Re: ${title} bei ${lead.company}`.slice(0, 78);
  if (step === 1) {
    return { subject, body: `${greeting(lead.contact)}\n\nKurz zu meiner Nachricht: 20 Minuten, danach hast du eine maßgeschneiderte Strategie für deine Stelle ${title}, unverbindlich. Passt es dir diese Woche?\n\n${SIGNATURE}` };
  }
  return { subject, body: `${greeting(lead.contact)}\n\nDas ist meine letzte Nachricht dazu. Ist die Stelle besetzt, sag mir kurz Bescheid, dann melde ich mich nicht mehr.\n\n${SIGNATURE}` };
}
