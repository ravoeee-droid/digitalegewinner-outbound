// Erstmail von Raphael Hermann (Sie-Form). Es werden nur Angaben aus dem Lead benutzt.
// Die Anrede "Frau"/"Herr" wird nicht geraten, weil das Geschlecht aus dem Namen nicht sicher ableitbar ist.
export const PFLEGE_PAGE = "https://digitalegewinner.de/pflege";
const SIGNATURE = `Freundliche Grüße\nRaphael Hermann\nDigitale Gewinner\n${PFLEGE_PAGE}`;

// Schon eingeplante Mails (alte Signatur) bekommen den Link beim Versand nachträglich.
export function withSignatureLink(body: string) {
  if (body.includes("digitalegewinner.de/pflege")) return body;
  const trimmed = body.trimEnd();
  return /Raphael Hermann\s+Digitale Gewinner$/.test(trimmed) ? `${trimmed}\n${PFLEGE_PAGE}` : body;
}

export type CopyLead = { lead_id: string; company: string; contact: string; city: string; title: string };

export function cleanJobTitle(raw: string) {
  const first = String(raw || "").split(/\s[-–—|:]\s/)[0];
  const title = first.replace(/\((?:[mwdfgx*\/]+\s*)+\)/gi, "").replace(/\s+/g, " ").trim();
  return title && title.length <= 70 ? title : "Pflegefachkraft";
}

// Aus Webseiten gelesene Namen enthalten oft Beiwerk ("Kontakt Telefon", "Stellv", "Mobile Pflege Judith Schenz").
// Nur ein sauberer Name aus 2 bis 3 Wörtern kommt in die Anrede, sonst bleibt sie neutral.
const NAME_NOISE = /^(kontakt|telefon|tel|fax|mail|stellv|stellvertretung|ihre|ihr|ansprechpartner|ansprechpartnerin|mobile|mobil|pflege|pflegedienst|stationär|stationaer|ambulant|ambulante|leitung|geschäftsleitung|geschaeftsleitung|geschäftsführer|geschäftsführerin|inhaber|inhaberin|team|fr|frau|herr|hr|dr|prof|und|oder|pdl|gmbh|gbr|kg|co)\.?$/i;
export function cleanPersonName(raw: string) {
  const words = String(raw || "").replace(/[,;:|()\/\d]/g, " ").split(/\s+/).filter(Boolean).filter((word) => !NAME_NOISE.test(word));
  const valid = words.length >= 2 && words.length <= 3 && words.every((word) => /^[A-ZÄÖÜ][a-zäöüßéèá'-]{1,}$/.test(word));
  return valid ? words.join(" ") : "";
}

function greeting(contact: string) {
  const name = cleanPersonName(contact);
  return name ? `Guten Tag ${name},` : "Guten Tag,";
}

export function firstTouch(lead: CopyLead) {
  const title = cleanJobTitle(lead.title);
  const body = [
    greeting(lead.contact),
    `ich würde gerne mit Ihnen in den nächsten sechs Wochen Ihre offene Stelle als ${title} mit einer passenden Fachkraft besetzen.`,
    "Dafür würde ich mir zuerst Ihre konkrete Situation anschauen: Wen suchen Sie, was haben Sie bisher versucht und wo hakt es gerade?",
    "Auf dieser Grundlage arbeite ich eine Strategie aus, die zu Ihrer Einrichtung passt. Diese können Sie anschließend gemeinsam mit mir oder auch eigenständig umsetzen.",
    "Haben Sie nächste Woche 20 Minuten, um uns Ihre Situation gemeinsam anzuschauen?",
    SIGNATURE,
  ].join("\n\n");
  return { variant: "A", subject: `Ihre offene Stelle: ${title}`.slice(0, 78), body };
}

export function followUp(lead: Pick<CopyLead, "company" | "contact" | "title">, step: number) {
  const title = cleanJobTitle(lead.title);
  const subject = `Re: Ihre offene Stelle: ${title}`.slice(0, 78);
  if (step === 1) {
    return { subject, body: [greeting(lead.contact), `kurz zu meiner Nachricht: Haben Sie nächste Woche 20 Minuten, um Ihre Situation rund um die Stelle ${title} gemeinsam anzuschauen? Danach erhalten Sie eine Strategie, die zu Ihrer Einrichtung passt.`, SIGNATURE].join("\n\n") };
  }
  return { subject, body: [greeting(lead.contact), "das ist meine letzte Nachricht dazu. Ist die Stelle bereits besetzt, geben Sie mir bitte kurz Bescheid, dann melde ich mich nicht mehr bei Ihnen.", SIGNATURE].join("\n\n") };
}
