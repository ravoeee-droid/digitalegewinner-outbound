"use client";

import { FormEvent, useState } from "react";

type FoundLead = {
  id: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  website: string;
  city: string;
  industry: string;
  intentScore: number;
  stage: string;
  dealValue: number;
  notes: string;
  lat?: number;
  lng?: number;
};

type Store = { leads?: Array<Record<string, unknown>>; campaigns?: unknown[]; mailboxes?: unknown[]; settings?: Record<string, unknown> };
type RadarImport = {
  legacyLead?: Record<string, unknown>;
  scores?: { websiteScore: number; contactScore: number; fitScore: number; opportunityScore: number; intentScore: number; priorityScore: number };
  warnings?: string[];
  error?: string;
};
type PflegeAnalysis = {
  recruiting?: {
    maturityScore: number;
    opportunityScore: number;
    level: string;
    gaps: string[];
    signals: string[];
    talkingPoints: string[];
    emailHook: string;
    recommendedOffer: string;
  };
  error?: string;
};

export default function PflegeLeadFinderWidget() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("Pflegedienst ");
  const [results, setResults] = useState<FoundLead[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function search(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/leads/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, pageSize: 20 }),
      });
      const json = await response.json() as { leads?: FoundLead[]; error?: string };
      if (!response.ok) throw new Error(json.error || "Suche fehlgeschlagen");
      setResults(json.leads || []);
      setMessage(`${json.leads?.length || 0} Pflege-Unternehmen gefunden.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Suche fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function importLead(found: FoundLead) {
    setBusy(true);
    setMessage(`Pflege-Research läuft für ${found.company} …`);
    try {
      const stateResponse = await fetch("/api/state", { cache: "no-store" });
      const stateJson = await stateResponse.json() as { state?: Store };
      const state: Store = stateJson.state || {};
      const current = state.leads || [];
      if (current.some((lead) => String(lead.company || "").toLowerCase() === found.company.toLowerCase())) {
        throw new Error("Unternehmen ist bereits im Pflege-Radar.");
      }

      const researchResponse = await fetch("/api/radar/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...found, source: "google-places", workspace: "pflege" }),
      });
      const research = await researchResponse.json() as RadarImport;
      if (!researchResponse.ok || !research.legacyLead) throw new Error(research.error || "Research-Import fehlgeschlagen.");

      let lead: Record<string, unknown> = { ...research.legacyLead, vertical: "pflege" };
      let recruitingOpportunity = 0;
      let recruitingMaturity = 0;
      let recruitingLevel = "offen";

      if (found.website) {
        try {
          const careResponse = await fetch("/api/pflege/analyze", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: found.website, company: found.company }),
          });
          const care = await careResponse.json() as PflegeAnalysis;
          if (careResponse.ok && care.recruiting) {
            recruitingOpportunity = care.recruiting.opportunityScore;
            recruitingMaturity = care.recruiting.maturityScore;
            recruitingLevel = care.recruiting.level;
            lead = {
              ...lead,
              recruitingOpportunityScore: recruitingOpportunity,
              recruitingMaturityScore: recruitingMaturity,
              recruitingLevel,
              recruitingGaps: care.recruiting.gaps,
              recruitingSignals: care.recruiting.signals,
              recruitingTalkingPoints: care.recruiting.talkingPoints,
              recommendedOffer: care.recruiting.recommendedOffer,
              notes: [
                String(lead.notes || ""),
                care.recruiting.emailHook,
                `Empfohlenes Angebot: ${care.recruiting.recommendedOffer}`,
              ].filter(Boolean).join(" · "),
            };
          }
        } catch {}
      } else {
        recruitingOpportunity = 92;
        recruitingMaturity = 8;
        recruitingLevel = "kritisch";
        lead = {
          ...lead,
          recruitingOpportunityScore: recruitingOpportunity,
          recruitingMaturityScore: recruitingMaturity,
          recruitingLevel,
          recruitingGaps: ["Keine Website bei Google Places erkannt"],
          recommendedOffer: "Karriere-Website + Employer Branding + Schnellbewerbungs-Funnel + Social Recruiting",
          notes: [String(lead.notes || ""), "Keine Website erkannt – sehr hoher digitaler Recruiting-Hebel."].filter(Boolean).join(" · "),
        };
      }

      const discoveredEmail = String(lead.email || "");
      if (discoveredEmail) {
        try {
          const verifyResponse = await fetch("/api/email/verify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: discoveredEmail }),
          });
          if (verifyResponse.ok) {
            const verifyJson = await verifyResponse.json() as { status?: string };
            lead = { ...lead, emailStatus: verifyJson.status || "" };
          }
        } catch {}
      }

      const save = await fetch("/api/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...state, leads: [lead, ...current] }),
      });
      if (!save.ok) throw new Error("Lead wurde analysiert, konnte aber nicht gespeichert werden.");

      const basePriority = research.scores?.priorityScore || 0;
      const combinedPriority = Math.round(Math.max(basePriority, recruitingOpportunity));
      setMessage(`${found.company} importiert · Pflege Opportunity ${recruitingOpportunity || "—"}/100 · Priority ${combinedPriority}/100 · Reife ${recruitingMaturity || "—"}/100 (${recruitingLevel})${discoveredEmail ? ` · ${discoveredEmail}` : " · E-Mail offen"}`);
      setResults((items) => items.filter((item) => item.id !== found.id));
      window.setTimeout(() => location.reload(), 900);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button onClick={() => setOpen(true)} style={{ position: "fixed", right: 145, bottom: 24, zIndex: 80, border: "1px solid #2b6854", background: "#0d1d19", color: "#7ef0bd", padding: "12px 15px", borderRadius: 13, fontWeight: 850, cursor: "pointer", boxShadow: "0 18px 45px rgba(0,0,0,.35)" }}>⌁ Pflege Lead Finder</button>
    {open && <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(3,6,10,.78)", backdropFilter: "blur(8px)", display: "grid", placeItems: "center", padding: 20 }}>
      <div onClick={(event) => event.stopPropagation()} style={{ width: "min(980px,100%)", maxHeight: "88vh", overflow: "auto", background: "#0b121b", border: "1px solid #263547", borderRadius: 22, padding: 24, color: "#eef4ff", fontFamily: "Inter,system-ui" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, color: "#65e7ae", fontWeight: 850, letterSpacing: ".15em" }}>PFLEGE RECRUITING INTELLIGENCE</div>
            <h2 style={{ margin: "7px 0", fontSize: 28 }}>Pflegedienste finden → Recruiting-Lücken → Opportunity Score</h2>
            <p style={{ margin: 0, color: "#8290a5", fontSize: 13 }}>Google Places, öffentliche Geschäftskontakte, Website-Radar und Pflege-spezifische Bewerberanalyse. Jeder Import bekommt konkrete Gesprächsaufhänger und ein empfohlenes Angebot.</p>
          </div>
          <button onClick={() => setOpen(false)} style={{ border: 0, background: "#182230", color: "#fff", width: 36, height: 36, borderRadius: 10, cursor: "pointer" }}>×</button>
        </div>
        <form onSubmit={search} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, margin: "20px 0" }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} required placeholder="z. B. Pflegedienst Stuttgart" style={{ border: "1px solid #29394b", background: "#080e15", color: "#fff", borderRadius: 11, padding: "13px 14px" }} />
          <button disabled={busy} style={{ border: 0, borderRadius: 11, padding: "0 18px", background: "#5de9a7", color: "#062117", fontWeight: 900, cursor: "pointer" }}>{busy ? "Lädt…" : "Suchen"}</button>
        </form>
        {message && <div style={{ marginBottom: 13, color: "#91a0b4", fontSize: 12 }}>{message}</div>}
        <div style={{ display: "grid", gap: 9 }}>
          {results.map((result) => <div key={result.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "center", border: "1px solid #1e2b3a", borderRadius: 13, padding: 14 }}>
            <div>
              <strong style={{ display: "block", fontSize: 13 }}>{result.company}</strong>
              <small style={{ display: "block", marginTop: 5, color: "#748297" }}>{result.city} · {result.industry} {result.website ? `· ${result.website}` : "· keine Website erkannt"}</small>
            </div>
            <button disabled={busy} onClick={() => void importLead(result)} style={{ border: "1px solid #2a6d50", borderRadius: 10, padding: "9px 12px", background: "#10251c", color: "#64eaaa", fontWeight: 850, cursor: "pointer" }}>Pflege-Research + Import</button>
          </div>)}
        </div>
      </div>
    </div>}
  </>;
}
