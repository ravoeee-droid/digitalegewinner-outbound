"use client";

import { useState } from "react";

type Lead = {
  id: string;
  company: string;
  city: string;
  industry: string;
  website: string;
  email: string;
  phone: string;
  stage: string;
  priority_score: number;
  fit_score: number;
  opportunity_score: number;
  intent_score: number;
  updated_at: string;
};

type Activity = { id: number; type: string; summary: string; lead_id: string; created_at: string };
type Overview = {
  stats: { companies: number; leads: number; hot: number; avg_priority: number };
  leads: Lead[];
  activities: Activity[];
};

const empty: Overview = { stats: { companies: 0, leads: 0, hot: 0, avg_priority: 0 }, leads: [], activities: [] };

function badge(score: number) {
  const background = score >= 80 ? "#3a161b" : score >= 65 ? "#33260e" : "#152230";
  const color = score >= 80 ? "#ff8e9a" : score >= 65 ? "#ffd275" : "#91c7f4";
  return { background, color, border: `1px solid ${color}55`, borderRadius: 999, padding: "5px 9px", fontSize: 11, fontWeight: 900 } as const;
}

export default function SalesOSWidget() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<Overview>(empty);
  const [error, setError] = useState("");

  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/crm/overview", { cache: "no-store" });
      const json = await response.json() as Overview & { error?: string };
      if (!response.ok) throw new Error(json.error || "CRM konnte nicht geladen werden.");
      setOverview(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "CRM konnte nicht geladen werden.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button onClick={() => { setOpen(true); void load(); }} style={{ position: "fixed", right: 24, bottom: 78, zIndex: 80, border: "1px solid #335f4e", background: "#10241d", color: "#7cf0b8", padding: "12px 15px", borderRadius: 13, fontWeight: 900, cursor: "pointer", boxShadow: "0 18px 45px rgba(0,0,0,.35)" }}>⚡ Sales OS</button>
    {open && <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(3,6,10,.82)", backdropFilter: "blur(9px)", display: "grid", placeItems: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(1100px,100%)", maxHeight: "90vh", overflow: "auto", background: "#09111a", border: "1px solid #26384b", borderRadius: 24, padding: 24, color: "#eef6ff", fontFamily: "Inter,system-ui" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 18 }}>
          <div><div style={{ fontSize: 10, fontWeight: 900, letterSpacing: ".16em", color: "#61e6a5" }}>DIGITALE GEWINNER · SALES OPERATING SYSTEM</div><h2 style={{ margin: "8px 0 5px", fontSize: 30 }}>CRM + Research Intelligence</h2><p style={{ margin: 0, color: "#8494a8", fontSize: 13 }}>Normalisierte Firmen, Kontakte, Leads, Research Runs und Activities. Priority kombiniert Fit, Opportunity, Contactability und Intent.</p></div>
          <div style={{ display: "flex", gap: 8 }}><button onClick={() => void load()} disabled={busy} style={{ border: "1px solid #2e4458", background: "#101b27", color: "#c7d9ea", borderRadius: 10, padding: "9px 11px", cursor: "pointer", fontWeight: 800 }}>{busy ? "Lädt…" : "↻ Aktualisieren"}</button><button onClick={() => setOpen(false)} style={{ border: 0, background: "#182432", color: "#fff", width: 38, height: 38, borderRadius: 10, cursor: "pointer" }}>×</button></div>
        </div>

        {error && <div style={{ marginTop: 16, border: "1px solid #5f2f38", background: "#251218", color: "#ff9aa5", borderRadius: 12, padding: 12, fontSize: 12 }}>{error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginTop: 20 }}>
          {[["Firmen", overview.stats.companies], ["Aktive Leads", overview.stats.leads], ["Priority ≥70", overview.stats.hot], ["Ø Priority", `${overview.stats.avg_priority}/100`]].map(([label, value]) => <div key={String(label)} style={{ border: "1px solid #1d2d3c", background: "#0c1721", borderRadius: 14, padding: 15 }}><small style={{ color: "#71849a", fontWeight: 800 }}>{label}</small><strong style={{ display: "block", marginTop: 5, fontSize: 27 }}>{value}</strong></div>)}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.55fr .85fr", gap: 14, marginTop: 16 }}>
          <section style={{ border: "1px solid #1d2d3c", borderRadius: 16, overflow: "hidden" }}>
            <div style={{ padding: "13px 15px", borderBottom: "1px solid #1d2d3c", fontWeight: 900 }}>🔥 Priority Queue</div>
            <div style={{ display: "grid" }}>
              {overview.leads.length === 0 && <div style={{ padding: 20, color: "#74869a", fontSize: 13 }}>Noch keine normalisierten Radar-Leads. Importiere im Lead Finder den ersten Lead.</div>}
              {overview.leads.map(lead => <div key={lead.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, padding: 14, borderBottom: "1px solid #142332" }}>
                <div><strong style={{ fontSize: 13 }}>{lead.company}</strong><div style={{ marginTop: 5, fontSize: 11, color: "#768aa0" }}>{[lead.city, lead.industry, lead.email || lead.phone].filter(Boolean).join(" · ")}</div><div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}><span style={{ ...badge(lead.opportunity_score), fontSize: 10 }}>Opportunity {lead.opportunity_score}</span><span style={{ ...badge(lead.fit_score), fontSize: 10 }}>Fit {lead.fit_score}</span><span style={{ ...badge(lead.intent_score), fontSize: 10 }}>Intent {lead.intent_score}</span></div></div>
                <div style={{ textAlign: "right" }}><span style={badge(lead.priority_score)}>Priority {lead.priority_score}</span><div style={{ marginTop: 9, fontSize: 10, color: "#718296" }}>{lead.stage}</div></div>
              </div>)}
            </div>
          </section>

          <section style={{ border: "1px solid #1d2d3c", borderRadius: 16, overflow: "hidden" }}>
            <div style={{ padding: "13px 15px", borderBottom: "1px solid #1d2d3c", fontWeight: 900 }}>Activity Stream</div>
            <div>{overview.activities.length === 0 && <div style={{ padding: 18, color: "#74869a", fontSize: 12 }}>Noch keine Activities.</div>}{overview.activities.map(activity => <div key={activity.id} style={{ padding: 13, borderBottom: "1px solid #142332" }}><strong style={{ display: "block", fontSize: 11 }}>{activity.summary}</strong><small style={{ display: "block", marginTop: 5, color: "#687c91" }}>{new Date(activity.created_at).toLocaleString("de-DE")}</small></div>)}</div>
          </section>
        </div>
      </div>
    </div>}
  </>;
}
