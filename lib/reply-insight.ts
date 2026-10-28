import { heuristicClassification } from "@/lib/outbound-conversation-intelligence";
import { classifyInboxMessage, currentReplyText } from "@/lib/inbox-classifier";

// Auswertung einer Antwort: Einordnung, Empfehlung und Wiedervorlage-Datum (regelbasiert, ohne KI-Schlüssel).
const LABEL: Record<string, string> = {
  positive: "🔥 Interesse",
  meeting_intent: "📅 Möchte einen Termin",
  needs_information: "ℹ️ Möchte mehr Infos",
  objection_price: "💶 Einwand: Preis",
  objection_existing_solution: "🧩 Hat schon eine Lösung",
  objection_timing: "⏳ Später nochmal melden",
  not_responsible: "👤 Nicht zuständig",
  referral: "➡️ Verweist an andere Person",
  not_interested: "🚫 Kein Interesse",
  already_filled: "✅ Stelle schon besetzt",
  out_of_office: "🏖 Abwesend",
  legal_complaint: "⚖️ Beschwerde",
  unsubscribe: "⛔ Möchte keine Mails mehr",
  unknown: "💬 Antwort (bitte lesen)",
};
const ACTION: Record<string, { text: string; days: number | null }> = {
  positive: { text: "Sofort anrufen oder antworten", days: 0 },
  meeting_intent: { text: "Termin vereinbaren", days: 0 },
  needs_information: { text: "Infos schicken", days: 0 },
  objection_price: { text: "Auf Preis-Einwand antworten", days: 1 },
  objection_existing_solution: { text: "Auf bestehende Lösung antworten", days: 2 },
  objection_timing: { text: "Später nochmal melden", days: 14 },
  not_responsible: { text: "Richtige Ansprechperson erfragen", days: 1 },
  referral: { text: "Neue Ansprechperson anschreiben", days: 1 },
  out_of_office: { text: "Nach der Abwesenheit nochmal melden", days: 7 },
  not_interested: { text: "Abgeschlossen, kein Interesse", days: null },
  already_filled: { text: "Abgeschlossen, Stelle besetzt", days: null },
  legal_complaint: { text: "Beschwerde prüfen, nicht mehr kontaktieren", days: 0 },
  unsubscribe: { text: "Nie wieder anschreiben (gesperrt)", days: null },
  unknown: { text: "Antwort lesen und entscheiden", days: 0 },
};
const MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];

// Findet Zeitangaben wie "in 2 Wochen", "nächsten Monat", "im Januar", "nächstes Jahr".
export function parseFollowUpDate(text: string, now = new Date()): Date | null {
  const t = text.toLowerCase();
  const day = 86400000;
  const rel = t.match(/in\s+(?:etwa\s+|ca\.?\s+)?(\d{1,2})\s*(tag|woche|monat)/);
  if (rel) return new Date(now.getTime() + Number(rel[1]) * (rel[2] === "tag" ? day : rel[2] === "woche" ? 7 * day : 30 * day));
  if (/nächste[nsm]?\s+woche/.test(t)) return new Date(now.getTime() + 7 * day);
  if (/nächste[nsm]?\s+monat/.test(t)) return new Date(now.getTime() + 30 * day);
  if (/nächste[nsm]?\s+jahr|nach\s+dem\s+jahreswechsel/.test(t)) return new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 8));
  const season = t.match(/\b(frühjahr|frühling|sommer|herbst|winter)\b/);
  if (season) { const m = ({ frühjahr: 2, frühling: 2, sommer: 5, herbst: 8, winter: 11 } as Record<string, number>)[season[1]]; return new Date(Date.UTC(m <= now.getUTCMonth() ? now.getUTCFullYear() + 1 : now.getUTCFullYear(), m, 8)); }
  const month = t.match(new RegExp(`\\b(?:im|ab|nach|Anfang|Mitte|Ende)\\s+(${MONTHS.join("|")})\\b`, "i")) || t.match(new RegExp(`\\b(${MONTHS.join("|")})\\b`));
  if (month) {
    const index = MONTHS.indexOf(month[1].toLowerCase());
    const year = index <= now.getUTCMonth() ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
    return new Date(Date.UTC(year, index, 8));
  }
  return null;
}

// Drohungen und Beschwerden über unerwünschte Werbung: sofort sperren und persönlich prüfen.
const COMPLAINT = /\b(anzeige[n]?|anzeigen|polizei|staatsanwalt|verbraucherzentrale|wettbewerbszentrale|abmahn\w*|anwalt|rechtsanwalt|unerlaubte werbung|unerwünschte werbung|unerbetene werbung|spam|belästigung|datenschutzbeauftragt\w*|dsgvo|uwg|löschen sie (meine|alle)|nicht mehr (anschreiben|schreiben|kontaktieren|belästigen)|zeige[n]?\s+(ich\s+)?(sie|euch|dich)\b[^.!?\n]{0,30}\ban\b|melde[n]?\s+(ich\s+)?(sie|euch)\b|rechtliche schritte|\bklage\b)/i;
// Wunsch, keine Mails mehr zu bekommen (auch höflich formuliert).
const OPT_OUT = /(aus (ihrem|dem|ihrer) (verteiler|liste|mailingliste)|keine weiteren (angebote|nachrichten|mails|e-mails|werbung|zusendungen)|keine (werbung|angebote|mails|e-mails) (mehr )?(zu|senden|schicken)|bitte (keine|nicht mehr) (\w+ ){0,2}(zusenden|zusenden|senden|schicken|anschreiben|mailen)|nicht mehr (zusenden|senden|schicken|anschreiben|mailen)|austragen|abmelden|abbestellen|streichen sie (uns|mich)|nehmen sie (uns|mich) (bitte )?(aus|von))/i;
const NO_AGENCY = /(arbeiten wir nicht|arbeite ich nicht|keine zusammenarbeit)[^.]{0,60}(zusammen|personaldienst|vermittl|agentur)/i;
const LATER = /(noch\s?mal|erneut|wieder|später)\s+(schreiben|melden|anschreiben|kontaktieren|anrufen|nachfragen)|(schreiben|melden|kontaktieren|nachfragen)\s+sie\s+(\w+\s+){0,4}(noch\s?mal|erneut|wieder)/i;

// Automatic acknowledgements (especially applicant/privacy notices) are not
// complaints merely because their standard boilerplate mentions GDPR or revocation.
export function isAutomaticAcknowledgement(subject:string,body:string):boolean {
  const automaticSubject=/^(?:aw:|re:|fw:|wg:)?\s*(?:automatische antwort|automatic reply|auto(?:matic)?[ -]?response|eingangsbestätigung|bestätigung des eingangs|abwesenheitsnotiz|out of office)/i.test(subject.trim());
  const acknowledgement=/\b(?:bestätigen (?:wir )?(?:ihnen )?den eingang|eingang (?:ihrer|ihrer nachricht|ihrer bewerbung)|vielen dank für ihre (?:bewerbung|nachricht)|your message has been received|we have received your message)\b/i.test(body);
  return automaticSubject || acknowledgement;
}
export function analyzeReply(subject: string, body: string, now = new Date()) {
  const current = currentReplyText(body);
  const text = `${subject}\n${current}`;
  const inbox = classifyInboxMessage({ from: "", subject, bodyText: current });
  const cls = heuristicClassification(subject, current);
  const autoAcknowledgement=isAutomaticAcknowledgement(subject,current);
  let klass = cls.replyClass as string;
  // Only the actual new reply can cause a block: Outlook often quotes the
  // unsubscribe link of our own previous message in the email history.
  if (autoAcknowledgement && !/(?:bitte|please)\s+(?:nicht mehr|keine weiteren|stop|remove|löschen sie|unterlassen sie)|(?:unerwünschte|unerlaubte)\s+werbung|abmahnung|rechtliche schritte/i.test(current)) klass = "out_of_office";
  else if (COMPLAINT.test(current)) klass = "legal_complaint";
  else if (OPT_OUT.test(current)) klass = "unsubscribe";
  else if (inbox.category === "rueckruf") klass = "meeting_intent";
  else if (inbox.category === "information") klass = "needs_information";
  else if (inbox.category === "vermittler") klass = "objection_existing_solution";
  else if (NO_AGENCY.test(current)) klass = "not_interested";
  else if (klass === "unknown" && (LATER.test(text) || parseFollowUpDate(current, now))) klass = "objection_timing";
  const action = ACTION[klass] || ACTION.unknown;
  let due: Date | null = null;
  if (action.days !== null && !autoAcknowledgement) {
    due = klass === "objection_timing" || klass === "out_of_office" ? parseFollowUpDate(`${subject}\n${current}`, now) : null;
    if (!due) due = new Date(now.getTime() + action.days * 86400000);
  }
  return { replyClass: klass, label: LABEL[klass] || LABEL.unknown, action: action.text, due, confidence: cls.confidence, suppress: klass === "legal_complaint" || klass === "unsubscribe" };
}
