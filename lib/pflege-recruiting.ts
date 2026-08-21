import type { WebsiteAuditResult } from "@/lib/website-audit";

export type PflegeRecruitingAnalysis = {
  version: 1;
  maturityScore: number;
  opportunityScore: number;
  level: "kritisch" | "ausbaufähig" | "solide" | "stark";
  detected: {
    careerEntry: boolean;
    applyCta: boolean;
    employerPositioning: boolean;
    employeeProof: boolean;
    lowFrictionApply: boolean;
    mobileReady: boolean;
    socialPresence: boolean;
    trustSignals: boolean;
  };
  gaps: string[];
  signals: string[];
  talkingPoints: string[];
  emailHook: string;
  recommendedOffer: string;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function analyzePflegeRecruiting(audit: WebsiteAuditResult): PflegeRecruitingAnalysis {
  const snapshotText = [
    audit.snapshot.title,
    audit.snapshot.description,
    ...audit.snapshot.h1,
    ...audit.snapshot.h2,
    ...audit.snapshot.ctas,
  ].join(" ").toLowerCase();

  const careerEntry = /(karriere|jobs?\b|stellenangebote?|offene stellen|bewerb|pflegefachkraft|pflegefachperson|pflegekraft|examiniert|fachkraft)/i.test(snapshotText);
  const applyCta = audit.snapshot.ctas.some((cta) => /(bewerb|job|karriere|stelle|mitarbeiten|team|kennenlernen)/i.test(cta));
  const employerPositioning = /(arbeitgeber|team|benefits?|vorteile|warum (wir|zu uns)|bei uns|mitarbeiter|kolleg|wertschätzung|dienstplan|fortbildung|weiterbildung)/i.test(snapshotText);
  const employeeProof = audit.metrics.hasTestimonials || /(mitarbeiterstimme|teamstimme|unser team|kolleg|mitarbeiter|erfahrungen? aus dem team)/i.test(snapshotText);
  const lowFrictionApply = (applyCta && audit.metrics.formCount > 0) || audit.metrics.hasWhatsapp;
  const mobileReady = audit.metrics.hasViewport;
  const socialPresence = audit.metrics.socialLinks > 0;
  const trustSignals = audit.metrics.hasTestimonials || audit.metrics.hasCaseStudies || audit.scores.trust >= 65;

  let maturity = 0;
  if (careerEntry) maturity += 18;
  if (applyCta) maturity += 16;
  if (employerPositioning) maturity += 16;
  if (employeeProof) maturity += 14;
  if (lowFrictionApply) maturity += 16;
  if (mobileReady) maturity += 8;
  if (socialPresence) maturity += 5;
  if (trustSignals) maturity += 7;
  const maturityScore = clamp(maturity);

  const websitePenalty = audit.scores.overall < 45 ? 12 : audit.scores.overall < 60 ? 7 : 0;
  const opportunityScore = clamp(100 - maturityScore + websitePenalty);
  const level = maturityScore < 35 ? "kritisch" : maturityScore < 60 ? "ausbaufähig" : maturityScore < 80 ? "solide" : "stark";

  const gaps: string[] = [];
  if (!careerEntry) gaps.push("Kein klarer Karriere-/Job-Einstieg auf der analysierten Seite sichtbar");
  if (!applyCta) gaps.push("Kein eindeutiger Bewerbungs-CTA sichtbar");
  if (!employerPositioning) gaps.push("Arbeitgebervorteile und Differenzierung sind nicht klar erkennbar");
  if (!employeeProof) gaps.push("Mitarbeiterstimmen oder glaubwürdiger Arbeitgeber-Proof fehlen bzw. sind nicht sichtbar");
  if (!lowFrictionApply) gaps.push("Kein klarer reibungsarmer Schnellbewerbungsweg erkennbar");
  if (!mobileReady) gaps.push("Mobile Basis ist technisch nicht sauber erkennbar");
  if (!socialPresence) gaps.push("Social-Media-Verknüpfung ist auf der analysierten Seite nicht sichtbar");
  if (!trustSignals) gaps.push("Vertrauenssignale sind für kalte Bewerber schwach ausgeprägt");

  const signals = [
    `Recruiting-Reife ${maturityScore}/100`,
    `Recruiting-Opportunity ${opportunityScore}/100`,
    `Website ${audit.scores.overall}/100`,
    careerEntry ? "Karriere-Signal erkannt" : "Karriere-Signal offen",
    lowFrictionApply ? "Schnellbewerbung erkennbar" : "Bewerbungsreibung wahrscheinlich",
  ];

  const talkingPoints = gaps.slice(0, 4).map((gap, index) => {
    const prefixes = ["Bewerber-Einstieg", "Conversion", "Employer Branding", "Vertrauen"];
    return `${prefixes[index] || "Recruiting"}: ${gap}.`;
  });

  const primaryGap = gaps[0] || "Die Recruiting-Basis ist bereits solide; der nächste Hebel liegt in Conversion und Reichweite";
  const emailHook = `Ich habe mir den Bewerber-Einstieg von ${audit.company} kurz angesehen. Recruiting-Opportunity: ${opportunityScore}/100. Auffälligster Punkt: ${primaryGap}.`;
  const recommendedOffer = opportunityScore >= 70
    ? "Karriere-Landingpage + Employer Branding + Schnellbewerbungs-Funnel + Social Recruiting"
    : opportunityScore >= 45
      ? "Employer-Branding-Optimierung + Bewerber-Funnel + Social Recruiting"
      : "Recruiting-Conversion-Audit + gezielte Social-Recruiting-Kampagne";

  return {
    version: 1,
    maturityScore,
    opportunityScore,
    level,
    detected: { careerEntry, applyCta, employerPositioning, employeeProof, lowFrictionApply, mobileReady, socialPresence, trustSignals },
    gaps,
    signals,
    talkingPoints,
    emailHook,
    recommendedOffer,
  };
}
