// Klassifizierung für den zentralen Posteingang. Kein automatischer Antwortversand.
export type InboxCategory = "rueckruf" | "interesse" | "information" | "vermittler" | "einwand" | "absage" | "kontaktstopp" | "automatisch" | "sonstige";
export type InboxInsight = {
  category: InboxCategory;
  label: string;
  priority: "high" | "normal" | "low";
  automatic: boolean;
  nextStep: string;
};

export function currentReplyText(value: string): string {
  const normalized = String(value || "").replace(/\r\n?/g, "\n").trim();
  // Outlook und Gmail zitieren die HTML-Linkbeschriftung und die eigentliche
  // Tracking-URL als "Website<Tracking-URL>". Beides gehört zur alten Mail.
  const markers = [
    /\n\s*Am .{0,240} schrieb .{0,160}:\s*$/im,
    /\n\s*On .{0,240} wrote:\s*$/im,
    /\n\s*(Von|From|Gesendet|Sent):\s*[^\n]{2,240}$/im,
    /\n\s*[-–]{2,}\s*(Original Message|Ursprüngliche Nachricht)\s*[-–]{2,}/im,
    /\n\s*_{5,}/m,
    /\n\s*>\s*(Am .+ schrieb|On .+ wrote|Von:|From:)/im,
  ];
  let end = normalized.length;
  for (const marker of markers) {
    const match = marker.exec(normalized);
    if (match && match.index < end) end = match.index;
  }
  const quoted = /\n\s*>\s*[^\n]+/m.exec(normalized);
  if (quoted && quoted.index < end) end = quoted.index;
  return normalized.slice(0, end).trim().slice(0, 12000);
}

export function classifyInboxMessage(message: { from: string; subject: string; bodyText: string }): InboxInsight {
  const from = String(message.from || "").toLowerCase();
  const subject = String(message.subject || "").trim();
  const body = currentReplyText(message.bodyText);
  const text = (subject + "\n" + body).toLowerCase();

  // Bounces und automatische Empfangs-/Abwesenheitsmeldungen ins Nebenfach.
  if (/^(mailer-daemon|postmaster|noreply|no-reply|donotreply|do-not-reply)@/i.test(from)
    || /^(aw:\s*|re:\s*)?(automatische antwort|automatic reply|out of office|abwesenheitsnotiz|undeliverable|undelivered mail|mail delivery failed|delivery status notification|nicht zustellbar|unzustellbar|zustellung fehlgeschlagen)/i.test(subject)
    || /^(ich bin (?:derzeit |aktuell )?nicht im (?:büro|haus)|i am (?:currently )?out of (?:the )?office|dies ist eine automatisch generierte (?:antwort|nachricht))/i.test(body)
    || /(?:wir haben (?:ihre|deine) nachricht erhalten|wir werden uns schnellstmöglich (?:bei ihnen )?zurückmelden|vielen dank für ihre e-?mail[.,]?\s*(?:diese haben wir erhalten)?)/i.test(body) && /(?:wir haben|diese haben wir|werden uns schnellstmöglich)/i.test(body)) {
    return { category: "automatisch", label: "Automatische Nachricht", priority: "low", automatic: true, nextStep: "Automatische Meldung / Zustellfehler" };
  }

  // Explizite Kontaktverbote dürfen nicht durch Verkaufseinwand-Regeln überspielt werden.
  if (/\b(bitte\s+(?:keine|keinen)\s+(?:weiteren?\s+)?(?:e-?mails?|nachrichten|werbung)|(?:nicht|nie)\s+mehr\s+(?:kontaktieren|anschreiben|mailen)|(?:löschen|entfernen)\s+sie\s+(?:mich|meine\s+daten)|ich\s+möchte\s+(?:keine|keinen)\s+(?:weiteren?\s+)?kontakt|bitte\s+(?:aus|von)\s+(?:dem|ihrem)\s+verteiler\s+(?:nehmen|löschen|entfernen)|(?:bitte\s+)?(?:abmelden|austragen|abbestellen)|unsubscribe|do\s+not\s+(?:email|contact)\s+me|remove\s+me\s+from\s+(?:your|the)\s+(?:list|mailing\s+list)|no\s+more\s+emails?)\b/i.test(body)) {
    return { category: "kontaktstopp", label: "Nicht mehr kontaktieren", priority: "normal", automatic: false, nextStep: "Keine weiteren Mails; Compliance-Sperre prüfen" };
  }

  if (/(bitte (?:um )?(?:einen )?rückruf|rückruf erbeten|rufen sie (?:mich|uns) (?:bitte )?(?:zurück|an)|(?:mich|uns) (?:bitte )?zurückrufen|können sie (?:mich|uns) (?:bitte )?anrufen|ich bitte um rückruf|gerne telefonisch)/i.test(text)) {
    return { category: "rueckruf", label: "Rückruf gewünscht", priority: "high", automatic: false, nextStep: "Persönlich zurückrufen" };
  }

  if (/\b(anwalt|rechtsanwalt|abmahn\w*|dsgvo|unerwünschte werbung|unerlaubte werbung|beschwerde)\b/i.test(body)) {
    return { category: "einwand", label: "Beschwerde / prüfen", priority: "high", automatic: false, nextStep: "Persönlich prüfen, vorerst keine Mail" };
  }

  // Der Einwand "keine Personalvermittlung" ist NICHT dasselbe wie "nicht mehr anschreiben".
  if (/\b(personalvermittlung|personalvermittler|vermittlungsagentur|recruiting.?vermittler|vermittler|vermittlung von personal)\b/i.test(body)) {
    return { category: "vermittler", label: "Missverständnis: Vermittlung", priority: "normal", automatic: false, nextStep: "Nicht mit einer Vermittlung verwechseln; Antwort persönlich prüfen" };
  }

  if (/\b(kein interesse|keinerlei interesse|nicht interessiert|kein bedarf|aktuell kein bedarf|keinen bedarf|bitte nicht|kommt nicht infrage|kommt nicht in frage)\b/i.test(body)) {
    return { category: "absage", label: "Absage / kein Bedarf", priority: "normal", automatic: false, nextStep: "Ablehnung respektieren; keine automatische Folge-Mail" };
  }
  if (/\b(termin|gespräch|telefonat|interessiert|klingt gut|gerne mehr|ja gerne|schicken sie mir)\b/i.test(body)) {
    return { category: "interesse", label: "Interesse / Gespräch", priority: "high", automatic: false, nextStep: "Persönlich antworten oder Termin vereinbaren" };
  }
  if (/\b(mehr informationen|weitere informationen|unterlagen|weitere infos|wie funktioniert|details)\b/i.test(body)) {
    return { category: "information", label: "Informationsanfrage", priority: "high", automatic: false, nextStep: "Passende Informationen schicken" };
  }
  if (/\b(bereits einen anbieter|bereits eine agentur|bestehende lösung|machen wir intern|zu teuer|kein budget|später|nicht zuständig)\b/i.test(body)) {
    return { category: "einwand", label: "Einwand / Rückfrage", priority: "normal", automatic: false, nextStep: "Persönlich einschätzen und nachfassen, falls angemessen" };
  }
  return { category: "sonstige", label: "Antwort prüfen", priority: "normal", automatic: false, nextStep: "Manuell lesen" };
}
