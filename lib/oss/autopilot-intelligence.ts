import type { FirecrawlDocument } from "./firecrawl-client";
import type { StagehandResearch } from "./stagehand-client";

export type AutopilotSignal = {
  id: string;
  label: string;
  detail: string;
  weight: number;
  kind: "intent" | "website-gap" | "contact" | "trust" | "risk";
};

export type AutopilotIntelligence = {
  score: number;
  temperature: "cold" | "warm" | "hot" | "very-hot";
  signals: AutopilotSignal[];
  nextBestAction: string;
  opener: string;
  summary: string;
};

function text(document?: FirecrawlDocument) {
  return [document?.markdown, document?.html, JSON.stringify(document?.metadata || {})]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function add(signals: AutopilotSignal[], signal: AutopilotSignal, condition: boolean) {
  if (condition && !signals.some(item => item.id === signal.id)) signals.push(signal);
}

export function buildAutopilotIntelligence(input: {
  company?: string;
  url: string;
  firecrawl?: FirecrawlDocument;
  stagehand?: StagehandResearch;
}): AutopilotIntelligence {
  const body = text(input.firecrawl);
  const s = input.stagehand;
  const signals: AutopilotSignal[] = [];
  const jobs = s?.openJobs || [];
  const issues = s?.conversionIssues || [];
  const contacts = s?.contacts || [];

  add(signals, {
    id: "hiring",
    label: "Aktive Personalsuche",
    detail: jobs.length ? `${jobs.length} konkrete Stelle(n) erkannt` : "Karriere-/Stellen-Signal auf der Website erkannt",
    weight: 24,
    kind: "intent",
  }, jobs.length > 0 || /stellenangebot|karriere|bewerben|pflegefachkraft|mitarbeiter gesucht|wir suchen/.test(body));

  add(signals, {
    id: "application-cta",
    label: "Bewerber-CTA vorhanden",
    detail: "Es gibt bereits Bewerbungsabsicht – ideal für Conversion-Optimierung.",
    weight: 9,
    kind: "intent",
  }, Boolean(s?.hasApplicationCta) || /jetzt bewerben|bewerben sie sich|online bewerben/.test(body));

  add(signals, {
    id: "career-gap",
    label: "Karriere-Conversion-Lücke",
    detail: "Hiring-Signal ohne starken geführten Bewerberpfad.",
    weight: 18,
    kind: "website-gap",
  }, (jobs.length > 0 || /karriere|stellenangebot|wir suchen/.test(body)) && !Boolean(s?.hasApplicationCta));

  add(signals, {
    id: "website-issues",
    label: "Konkrete Website-Probleme",
    detail: issues.slice(0, 2).join(" · ") || "Conversion-/UX-Schwächen erkannt.",
    weight: Math.min(20, 8 + issues.length * 4),
    kind: "website-gap",
  }, issues.length > 0);

  add(signals, {
    id: "direct-contact",
    label: "Direkter Ansprechpartner",
    detail: contacts[0]?.name ? `${contacts[0].name}${contacts[0].role ? ` · ${contacts[0].role}` : ""}` : "Direkte Kontaktmöglichkeit erkannt",
    weight: 12,
    kind: "contact",
  }, contacts.length > 0 || /mailto:|tel:/.test(body));

  add(signals, {
    id: "dated-site",
    label: "Veraltete Website-Indizien",
    detail: "Technik/Inhalte wirken potenziell veraltet – guter Website-Opener.",
    weight: 11,
    kind: "website-gap",
  }, /copyright\s*(20(1[0-9]|2[0-3]))|flash player|http:\/\//.test(body));

  add(signals, {
    id: "trust",
    label: "Vertrauensbasis vorhanden",
    detail: `${Math.max(1, s?.trustSignals?.length || 0)} Trust-Signal(e) können im Entwurf erhalten/verstärkt werden.`,
    weight: 4,
    kind: "trust",
  }, Boolean(s?.trustSignals?.length));

  add(signals, {
    id: "thin-content",
    label: "Dünne Angebotskommunikation",
    detail: "Wenig verwertbarer Hauptinhalt – Potenzial für klarere Positionierung.",
    weight: 10,
    kind: "website-gap",
  }, Boolean(input.firecrawl?.markdown) && String(input.firecrawl?.markdown || "").length < 1800);

  const raw = signals.reduce((sum, item) => sum + item.weight, 8);
  const score = Math.max(0, Math.min(100, raw));
  const temperature = score >= 75 ? "very-hot" : score >= 55 ? "hot" : score >= 35 ? "warm" : "cold";
  const company = input.company || s?.companyName || "das Unternehmen";
  const strongest = [...signals].sort((a, b) => b.weight - a.weight).slice(0, 2);
  const reason = strongest.map(item => item.label.toLowerCase()).join(" + ") || "Website-Potenzial";

  let nextBestAction = "Mit einem kurzen personalisierten Website-Hinweis starten und Reaktion messen.";
  if (temperature === "very-hot") nextBestAction = "Jetzt anrufen: konkretes Problem nennen, kostenlosen Entwurf anbieten und direkt einen festen Review-Termin vereinbaren.";
  else if (temperature === "hot") nextBestAction = "Heute personalisierte Mail + Loom/Entwurf senden und innerhalb von 24 Stunden telefonisch nachfassen.";
  else if (temperature === "warm") nextBestAction = "Mit einem konkreten Website-Fund ansprechen; erst bei Reaktion Entwurf/Loom produzieren.";

  const opener = strongest.length
    ? `Mir ist bei ${company} aufgefallen, dass ${strongest[0].label.toLowerCase()}${strongest[1] ? ` und ${strongest[1].label.toLowerCase()}` : ""}. Genau dafür habe ich einen konkreten Ansatz vorbereitet.`
    : `Ich habe mir die Website von ${company} angesehen und einen konkreten Ansatz vorbereitet, wie sie mehr Anfragen bzw. Bewerbungen erzeugen kann.`;

  return {
    score,
    temperature,
    signals: signals.sort((a, b) => b.weight - a.weight),
    nextBestAction,
    opener,
    summary: `${company}: Score ${score}/100 · ${temperature} · stärkster Hebel: ${reason}.`,
  };
}
