// Erstmail von Raphael Hermann (Sie-Form). Es werden nur Angaben aus dem Lead benutzt.
// Die Anrede "Frau"/"Herr" wird nicht geraten, weil das Geschlecht aus dem Namen nicht sicher ableitbar ist.
const SIGNATURE = "Freundliche Grüße\nRaphael Hermann\nDigitale Gewinner";

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
