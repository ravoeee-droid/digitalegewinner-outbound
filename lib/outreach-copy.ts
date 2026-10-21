// Erstmail von Raphael Hermann (Sie-Form). Es werden nur Angaben aus dem Lead benutzt.
// Die Anrede "Frau"/"Herr" wird nicht geraten, weil das Geschlecht aus dem Namen nicht sicher ableitbar ist.
export const PFLEGE_PAGE = "https://digitalegewinner.de/pflege";
const SIGNATURE = `Freundliche Grüße\nRaphael Hermann\nDigitale Gewinner\n${PFLEGE_PAGE}`;

// Schon eingeplante Mails (alte Signatur) bekommen den Link beim Versand nachträglich.
export function withSignatureLink(body: string) {
  if (body.includes("digitalegewinner.de/")) return body;
  const trimmed = body.trimEnd();
  return /Raphael Hermann\s+Digitale Gewinner$/.test(trimmed) ? `${trimmed}\n${PFLEGE_PAGE}` : body;
}

export type CopyLead = { lead_id: string; company: string; contact: string; city: string; title: string; publishedAt?: string };

// Terminlink für die Videocall-Variante (Test B). Ohne gesetzten Link läuft nur die Standard-Mail.
const BOOKING_URL = (process.env.BOOKING_URL || "").trim();

// Nur belegbare Angabe: wie lange die Anzeige schon veröffentlicht ist (aus dem Veröffentlichungsdatum der Stellenanzeige).
function openSinceText(publishedAt?: string) {
  const time = Date.parse(String(publishedAt || ""));
  if (!Number.isFinite(time)) return "";
  const days = Math.floor((Date.now() - time) / 86_400_000);
  return days >= 90 ? "seit über 90 Tagen" : days >= 60 ? "seit über 60 Tagen" : "";
}

export function cleanJobTitle(raw: string) {
  const first = String(raw || "").split(/\s[-–—|:]\s/)[0];
  const title = first.replace(/\((?:[mwdfgx*\/]+\s*)+\)/gi, "").replace(/\s+/g, " ").trim();
  return title && title.length <= 70 ? title : "Pflegefachkraft";
}

// Aus Webseiten gelesene Namen enthalten oft Beiwerk ("Kontakt Telefon", "Stellv", "Mobile Pflege Judith Schenz").
// Nur ein sauberer Name aus 2 bis 3 Wörtern kommt in die Anrede, sonst bleibt sie neutral.
const WEB_NOISE = /^(nordrhein-westfalen|baden-württemberg|rheinland-pfalz|sachsen-anhalt|schleswig-holstein|mecklenburg-vorpommern|niedersachsen|hessen|bayern|berlin|brandenburg|bremen|hamburg|saarland|sachsen|thüringen|deutschland|nordrhein|westfalen|jobs?|aktuelles|aktuell|aktuelle|news|neuigkeiten|karriere|kontakt|impressum|datenschutz|startseite|home|über|uns|unser|unsere|leistungen|referenzen|service|willkommen|angebot|angebote|solar|solartechnik|photovoltaik|energie|energien|energietechnik|technik|systeme|bau|haus|elektro|elektrotechnik|installation|montage|beratung|planung|wir|sie|ihr|ihre|team|mitarbeiter|stellenangebote|bewerbung|ausbildung|firma|unternehmen|gruppe|verwaltung|zentrale|info|anfrage|termin|hier|mehr|lesen|weiter|handwerk|meisterbetrieb|dach|dächer|speicher|wärmepumpe|sanitär|heizung|klima|projekt|projekte|partner|partnerschaft|referenz|geschäftsführung|geschäftsleitung|vertrieb|kundenservice|kundendienst|support|portal|shop|blog|presse|medien|galerie|rechtliches|agb|sitemap|navigation|menü|menu|suche|login|anmelden)\.?$/i;
const NAME_NOISE = /^(kontakt|telefon|tel|fax|mail|stellv|stellvertretung|ihre|ihr|ansprechpartner|ansprechpartnerin|mobile|mobil|pflege|pflegedienst|stationär|stationaer|ambulant|ambulante|leitung|geschäftsleitung|geschaeftsleitung|geschäftsführer|geschäftsführerin|inhaber|inhaberin|team|fr|frau|herr|hr|dr|prof|und|oder|pdl|gmbh|gbr|kg|co)\.?$/i;
const ROLE_OR_NOUN = /(beauftragte[rn]?|technik|leistungen|dienste?|kaufmänn\w*|hände|\w+ung|\w+heit|\w+keit|\w+schaft|\w+tion|\w+anlagen?|\w+werk|\w+service|\w+leiter(in)?|\w+manager(in)?)$/i;
export function cleanPersonName(raw: string) {
  const all = String(raw || "").replace(/[,;:|()\/\d]/g, " ").split(/\s+/).filter(Boolean).map((word) => word.replace(/\.+$/, ""));
  if (all.some((word) => WEB_NOISE.test(word) || ROLE_OR_NOUN.test(word))) return "";
  const words = all.filter((word) => !NAME_NOISE.test(word));
  const valid = words.length >= 2 && words.length <= 3 && words.every((word) => /^[A-ZÄÖÜ][A-Za-zÄÖÜäöüßéèáíóúñç'’-]{1,}$/.test(word) && !/^[A-ZÄÖÜ]{3,}$/.test(word));
  return valid ? words.join(" ") : "";
}

function greeting(contact: string) {
  const name = cleanPersonName(contact);
  return name ? `Guten Tag ${name},` : "Guten Tag,";
}

export function firstTouch(lead: CopyLead) {
  const title = cleanJobTitle(lead.title);
  if (BOOKING_URL && pvVariantFor(String(lead.lead_id || lead.contact || "")) === "B") {
    const since = openSinceText(lead.publishedAt);
    const body = [
      greeting(lead.contact),
      since ? `ich habe gesehen, dass Ihre Stelle als ${title} ${since} offen ist.` : `ich habe gesehen, dass Sie aktuell eine Fachkraft als ${title} suchen.`,
      "Das ist gerade in der Pflege ein bekanntes Problem: Auf Anzeigen melden sich kaum noch passende Fachkräfte, und jede Woche ohne Besetzung belastet Ihr Team.",
      "Genau diese Situation haben wir bereits mehrfach bei anderen Pflegediensten gelöst.",
      `Ich schaue mir gerne in einem kurzen Videocall Ihre Situation an, und wir sehen gemeinsam, ob das auch bei Ihnen Sinn machen würde. Buchen Sie sich dafür hier einen passenden Termin: ${BOOKING_URL}`,
      SIGNATURE,
    ].join("\n\n");
    return { variant: "B", subject: `Ihre offene Stelle: ${title}`.slice(0, 78), body };
  }
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

// ---------- Kampagne Photovoltaik-Betriebe ----------
export const PV_PAGE = "https://digitalegewinner.de/handwerk-kunden";
export const PV_TRUST_PAGE = "https://digitalegewinner.de/pv-trust";
// Der Link wird erst beim Versand eingesetzt: /pv-trust, sobald die Seite erreichbar ist, sonst /handwerk-kunden.
const PV_SIGNATURE = "Freundliche Grüße\nRaphael Hermann\nDigitale Gewinner\n{{pv_link}}";

// A/B-Test: A = ausführlich, B = kurz. Zuordnung stabil pro Lead.
export function pvVariantFor(leadId: string): "A" | "B" {
  let sum = 0;
  for (let index = 0; index < leadId.length; index += 1) sum += leadId.charCodeAt(index);
  return sum % 2 === 0 ? "A" : "B";
}

export function pvFirstTouch(lead: { contact: string; lead_id?: string }) {
  const variant = pvVariantFor(String(lead.lead_id || lead.contact || ""));
  const longBody = [
    greeting(lead.contact),
    "kurze Frage: Aktuell ist die Auftragslage Gott sei Dank ziemlich gut im PV-Markt. Ich spreche täglich mit PV-Geschäftsführern, und viele erzählen mir, dass sie ziemlich frustriert sind über die Schwankungen am Markt und darüber, dass Leadportal-Leads an 4 bis 5 andere Betriebe gleichzeitig gehen. Das ruiniert die Margen, und am Ende gewinnt nur noch der Billigste. Viele weichen deshalb auf Subunternehmer aus, bei denen die Verständigung oft schwierig ist, und früher oder später kommt es zu Reklamationen und Anzeigen, was alles nur noch schlimmer macht.",
    "Genau deshalb habe ich ein System entwickelt, das dieses Problem aus der Welt schafft: Sie sind damit nicht mehr abhängig von Leadportal-Leads, nicht von Empfehlungen und nicht von teuren Agenturen. Das System generiert exklusive Leads unter Ihrem eigenen Namen. Langfristig ist das ein deutlicher Vorteil gegenüber anderen Betrieben, weil Tag für Tag Ihre Marke, Ihre Bekanntheit und das Vertrauen wachsen.",
    "Ich würde Ihnen das gerne komplett kostenlos und unverbindlich vorstellen, damit Sie sehen, wie das in der Praxis aussieht. Danach entscheiden Sie, ob es für Ihr Unternehmen wirtschaftlich Sinn macht oder nicht. Würde Ihnen {{termin_1}} Vormittag oder {{termin_2}} Nachmittag eher passen? Das dauert ca. 20 Minuten.",
    PV_SIGNATURE,
  ].join("\n\n");
  const shortBody = [
    greeting(lead.contact),
    "kurze Frage: Leadportale verkaufen jede Anfrage an 4 bis 5 Betriebe gleichzeitig, das ruiniert die Margen, und am Ende gewinnt nur der Billigste. Ich habe ein System entwickelt, das exklusive Leads unter Ihrem eigenen Namen bringt: ohne Leadportal, ohne Empfehlungen und ohne teure Agentur.",
    "Ich zeige Ihnen das gerne kostenlos und unverbindlich in ca. 20 Minuten. Passt Ihnen {{termin_1}} Vormittag oder {{termin_2}} Nachmittag besser?",
    PV_SIGNATURE,
  ].join("\n\n");
  return { variant, subject: "Kurze Frage zur Kundengewinnung", body: variant === "A" ? longBody : shortBody };
}

export function pvFollowUp(lead: { contact: string }, step: number) {
  const subject = "Re: Kurze Frage zur Kundengewinnung";
  if (step === 1) {
    return { subject, body: [greeting(lead.contact), "kurz zu meiner Nachricht: Hätten Sie in den nächsten Tagen 20 Minuten, damit ich Ihnen zeigen kann, wie Sie ohne Leadportale an exklusive Anfragen unter Ihrem eigenen Namen kommen? Die Vorstellung ist kostenlos und unverbindlich.", PV_SIGNATURE].join("\n\n") };
  }
  return { subject, body: [greeting(lead.contact), "das ist meine letzte Nachricht dazu. Ist das Thema bei Ihnen gerade kein Thema, geben Sie mir bitte kurz Bescheid, dann melde ich mich nicht mehr bei Ihnen.", PV_SIGNATURE].join("\n\n") };
}

// Terminvorschläge werden erst beim Versand eingesetzt, damit „morgen“ und „übermorgen“ immer Werktage sind.
const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
function berlinDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(now).split("-").map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12));
}
export function terminSlots(now = new Date()) {
  const base = berlinDate(now);
  const days: Array<{ offset: number; weekday: number }> = [];
  for (let offset = 1; days.length < 2 && offset < 8; offset += 1) {
    const day = new Date(base.getTime() + offset * 86400000).getUTCDay();
    if (day !== 0 && day !== 6) days.push({ offset, weekday: day });
  }
  const label = (slot: { offset: number; weekday: number }, index: number) => (index === 0 && slot.offset === 1 ? "morgen" : index === 1 && slot.offset === 2 ? "übermorgen" : WEEKDAYS[slot.weekday]);
  return [label(days[0], 0), label(days[1], 1)];
}
export function resolveSlots(text: string, now = new Date()) {
  if (!text.includes("{{termin_")) return text;
  const [first, second] = terminSlots(now);
  return text.replaceAll("{{termin_1}}", first).replaceAll("{{termin_2}}", second);
}
