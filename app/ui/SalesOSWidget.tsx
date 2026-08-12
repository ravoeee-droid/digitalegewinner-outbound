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

type Trigger = {
  id: string;
  company: string;
  lead_id: string;
  kind: string;
  weight: number;
  title: string;
  detail: string;
  evidence: string[];
  detected_at: string;
};

type TriggerOverview = {
  stats: { monitors: number; due: number; signals_24h: number; hot_signals: number };
  triggers: Trigger[];
};

const empty: Overview = { stats: { companies: 0, leads: 0, hot: 0, avg_priority: 0 }, leads: [], activities: [] };
const emptyTriggers: TriggerOverview = { stats: { monitors: 0, due: 0, signals_24h: 0, hot_signals: 0 }, triggers: [] };

function badge(score: number) {
  const background = score >= 80 ? "#3a161b" : score >= 65 ? "#33260e" : "#152230";
  const color = score >= 80 ? "#ff8e9a" : score >= 65 ? "#ffd275" : "#91c7f4";
  return { background, color, border: `1px solid ${color}55`, borderRadius: 999, padding: "5px 9px", fontSize: 11, fontWeight: 900 } as const;
}

function triggerLabel(kind: string) {
  const map: Record<string, string> = {
    jobs: "Recruiting",
    career_page: "Karriere",
    location: "Expansion",
    service: "Leistung",
    announcement: "Unternehmen",
    contact: "Kontakt",
    site_change: "Website",
  };
  return map[kind] || kind;
}

export default function SalesOSWidget() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [overview, setOverview] = useState<Overview>(empty);
  const [triggerOverview, setTriggerOverview] = useState<TriggerOverview>(emptyTriggers);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setBusy(true);
    setError("");
    try {
      const [crmResponse, triggerResponse] = await Promise.all([
        fetch("/api/crm/overview", { cache: "no-store" }),
        fetch("/api/triggers/overview", { cache: "no-store" }),
      ]);
      const crm = await crmResponse.json() as Overview & { error?: string };
      const triggers = await triggerResponse.json() as TriggerOverview & { error?: string };
      if (!crmResponse.ok) throw new Error(crm.error || "CRM konnte nicht geladen werden.");
      if (!triggerResponse.ok) throw new Error(triggers.error || "Trigger Radar konnte nicht geladen werden.");
      setOverview(crm);
      setTriggerOverview(triggers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sales OS konnte nicht geladen werden.");
    } finally {
      setBusy(false);
    }
  }

  async function scanTriggers() {
    setScanning(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/triggers/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 4 }) });
      const json = await response.json() as { error?: string; result?: { due?: number; results?: Array<{ created?: number; baseline?: boolean; company?: string; error?: string }> } };
      if (!response.ok) throw new Error(json.error || "Trigger-Scan fehlgeschlagen.");
      const results = json.result?.results || [];
      const signals = results.reduce((sum, row) => sum + Number(row.created || 0), 0);
      const baselines = results.filter(row => row.baseline).length;
      setMessage(`${json.result?.due || 0} Firmen geprüft · ${signals} neue Signale${baselines ? ` · ${baselines} Baselines` : ""}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trigger-Scan fehlgeschlagen.");
    } finally {
      setScanning(false);
    }
  }

  return <>
    <button onClick={() => { setOpen(true); void load(); }} style={{ position: "fixed", right: 24, bottom: 78, zIndex: 80, border: "1px solid #335f4e", background: "#10241d", color: "#7cf0b8", padding: "12px 15px", borderRadius: 13, fontWeight: 900, cursor: "pointer", boxShadow: "0 18px 45px rgba(0,0,0,.35)" }}>⚡ Sales OS</button>
    {open && <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(3,6,10,.82)", backdropFilter: "blur(9px)", display: "grid", placeItems: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(1180px,100%)", maxHeight: "90vh", overflow: "auto", background: "#09111a", border: "1px solid #26384b", borderRadius: 24, padding: 24, color: "#eef6ff", fontFamily: "Inter,system-ui" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 18 }}>
          <div><div style={{ fontSize: 10, fontWeight: 900, letterSpacing: ".16em", color: "#61e6a5" }}>DIGITALE GEWINNER · SALES OPERATING SYSTEM</div><h2 style={{ margin: "8px 0 5px", fontSize: 30 }}>CRM + Trigger Intelligence</h2><p style={{ margin: 0, color: "#8494a8", fontSize: 13 }}>Research findet passende Firmen. Der Trigger Radar erkennt den richtigen Zeitpunkt: Recruiting, Expansion, neue Leistungen und relevante Website-Änderungen.</p></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button onClick={() => void scanTriggers()} disabled={scanning} style={{ border: "1px solid #376c56", background: "#10291f", color: "#76efb4", borderRadius: 10, padding: "9px 11px", cursor: "pointer", fontWeight: 900 }}>{scanning ? "Scan läuft…" : "⚡ Trigger jetzt prüfen"}</button>
            <button onClick={() => void load()} disabled={busy} style={{ border: "1px solid #2e4458", background: "#101b27", color: "#c7d9ea", borderRadius: 10, padding: "9px 11px", cursor: "pointer", fontWeight: 800 }}>{busy ? "Lädt…" : "↻ Aktualisieren"}</button>
            <button onClick={() => setOpen(false)} style={{ border: 0, background: "#182432", color: "#fff", width: 38, height: 38, borderRadius: 10, cursor: "pointer" }}>×</button>
          </div>
        </div>

        {error && <div style={{ marginTop: 16, border: "1px solid #5f2f38", background: "#251218", color: "#ff9aa5", borderRadius: 12, padding: 12, fontSize: 12 }}>{error}</div>}
        {message && <div style={{ marginTop: 16, border: "1px solid #285c48", background: "#0f261d", color: "#7cf0b8", borderRadius: 12, padding: 12, fontSize: 12 }}>{message}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginTop: 20 }}>
          {[["Firmen", overview.stats.companies], ["Aktive Leads", overview.stats.leads], ["Priority ≥70", overview.stats.hot], ["Ø Priority", `${overview.stats.avg_priority}/100`]].map(([label, value]) => <div key={String(label)} style={{ border: "1px solid #1d2d3c", background: "#0c1721", borderRadius: 14, padding: 15 }}><small style={{ color: "#71849a", fontWeight: 800 }}>{label}</small><strong style={{ display: "block", marginTop: 5, fontSize: 27 }}>{value}</strong></div>)}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginTop: 10 }}>
          {[["Aktive Monitore", triggerOverview.stats.monitors], ["Jetzt fällig", triggerOverview.stats.due], ["Signale 24h", triggerOverview.stats.signals_24h], ["Starke Signale", triggerOverview.stats.hot_signals]].map(([label, value]) => <div key={String(label)} style={{ border: "1px solid #234232", background: "#0c1d17", borderRadius: 14, padding: 13 }}><small style={{ color: "#6f9c87", fontWeight: 800 }}>{label}</small><strong style={{ display: "block", marginTop: 5, fontSize: 22, color: "#7cf0b8" }}>{value}</strong></div>)}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.45fr .95fr", gap: 14, marginTop: 16 }}>
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

          <section style={{ border: "1px solid #28513e", borderRadius: 16, overflow: "hidden", background: "#0a1511" }}>
            <div style={{ padding: "13px 15px", borderBottom: "1px solid #234232", fontWeight: 900, color: "#81f4bd" }}>⚡ Sales Trigger Radar</div>
            <div>{triggerOverview.triggers.length === 0 && <div style={{ padding: 18, color: "#718b7e", fontSize: 12 }}>Noch keine Trigger. Der erste Scan erstellt pro Firma eine Baseline; ab dem nächsten Scan werden Änderungen erkannt.</div>}{triggerOverview.triggers.map(trigger => <div key={trigger.id} style={{ padding: 13, borderBottom: "1px solid #193326" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}><strong style={{ display: "block", fontSize: 12 }}>{trigger.company}</strong><span style={{ ...badge(trigger.weight >= 30 ? 80 : 65), whiteSpace: "nowrap" }}>+{trigger.weight} Intent</span></div>
              <div style={{ marginTop: 6, fontSize: 11, fontWeight: 900, color: "#75eab0" }}>{triggerLabel(trigger.kind)} · {trigger.title}</div>
              <div style={{ marginTop: 5, color: "#849a8e", fontSize: 11, lineHeight: 1.45 }}>{trigger.detail}</div>
              {Array.isArray(trigger.evidence) && trigger.evidence.length > 0 && <div style={{ marginTop: 6, color: "#687e72", fontSize: 10 }}>{trigger.evidence.slice(0, 2).join(" · ")}</div>}
              <small style={{ display: "block", marginTop: 6, color: "#5e7468" }}>{new Date(trigger.detected_at).toLocaleString("de-DE")}</small>
            </div>)}</div>
          </section>
        </div>

        <section style={{ border: "1px solid #1d2d3c", borderRadius: 16, overflow: "hidden", marginTop: 14 }}>
          <div style={{ padding: "13px 15px", borderBottom: "1px solid #1d2d3c", fontWeight: 900 }}>Activity Stream</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>{overview.activities.length === 0 && <div style={{ padding: 18, color: "#74869a", fontSize: 12 }}>Noch keine Activities.</div>}{overview.activities.map(activity => <div key={activity.id} style={{ padding: 13, borderBottom: "1px solid #142332", borderRight: "1px solid #142332" }}><strong style={{ display: "block", fontSize: 11 }}>{activity.summary}</strong><small style={{ display: "block", marginTop: 5, color: "#687c91" }}>{new Date(activity.created_at).toLocaleString("de-DE")}</small></div>)}</div>
        </section>
      </div>
    </div>}
  </>;
}
