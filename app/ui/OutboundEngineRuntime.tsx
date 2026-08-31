"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Channel = "call" | "email" | "video" | "linkedin";
type ChannelState = { target: number; ready: number; done: number; total: number };
type Task = {
  id: string;
  channel: Channel;
  rank: number;
  status: string;
  score: number;
  lead_id: string;
  company_id: string;
  payload: Record<string, unknown>;
};
type Snapshot = {
  date: string;
  channels: Record<Channel, ChannelState>;
  tasks: Task[];
  workers: {
    openOutreach: { configured: boolean; url: string; source: string };
    linkedin: { configured: boolean; autoSend: boolean };
    video: { configured: boolean };
  };
};

const meta: Record<Channel, { label: string; icon: string; hint: string }> = {
  call: { label: "Cold Calls", icon: "☎", hint: "Top-Leads zuerst anrufen" },
  email: { label: "E-Mails", icon: "✉", hint: "personalisierte 1A-Outreach" },
  video: { label: "Videos", icon: "▶", hint: "nur Top-30 rendern" },
  linkedin: { label: "LinkedIn", icon: "in", hint: "OpenOutreach-Agentenqueue" },
};

function value(payload: Record<string, unknown>, key: string) {
  const raw = payload?.[key];
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
}

function reasons(payload: Record<string, unknown>) {
  const raw = payload?.reasons;
  return Array.isArray(raw) ? raw.map(String).filter(Boolean).slice(0, 3) : [];
}

export default function OutboundEngineRuntime() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [channel, setChannel] = useState<Channel>("call");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const run = useCallback(async (body?: Record<string, unknown>) => {
    setBusy(body?.action ? String(body.action) : "load");
    setError("");
    try {
      const response = await fetch("/api/outbound-engine", body ? {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      } : { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Aktion fehlgeschlagen");
      setSnapshot((data?.snapshot || data) as Snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Outbound Engine konnte nicht geladen werden.");
    } finally {
      setBusy("");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void run(); }, 0);
    return () => window.clearTimeout(timer);
  }, [run]);

  const tasks = useMemo(() => (snapshot?.tasks || []).filter((task) => task.channel === channel), [snapshot, channel]);

  async function mark(task: Task, status: string) {
    await run({ action: "task-status", id: task.id, status });
  }

  return (
    <main style={{ minHeight: "100vh", background: "#07090d", color: "#f7f8fa", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", padding: "28px" }}>
      <div style={{ maxWidth: 1540, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, flexWrap: "wrap", marginBottom: 26 }}>
          <div>
            <Link href="/" style={{ color: "#8f98a6", textDecoration: "none", fontSize: 13 }}>← Pflege Sales OS</Link>
            <div style={{ marginTop: 18, color: "#d5ff59", fontSize: 12, fontWeight: 800, letterSpacing: ".12em" }}>DAILY OUTBOUND ENGINE</div>
            <h1 style={{ margin: "10px 0 8px", fontSize: "clamp(38px,6vw,76px)", letterSpacing: "-.055em", lineHeight: .95 }}>120 Calls. 100 Mails.<br />Eine Queue.</h1>
            <p style={{ margin: 0, maxWidth: 800, color: "#a9b1bd", lineHeight: 1.6, fontSize: 15 }}>
              A+-Pflegeleads werden einmal qualifiziert und danach kanalübergreifend priorisiert. Videos und LinkedIn bekommen nur die stärksten Leads, damit Rendering, API-Kosten und Aufmerksamkeit nicht verschwendet werden.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => void run({ action: "build" })} disabled={Boolean(busy)} style={buttonStyle(false)}>↻ Tagesplan bauen</button>
            <Link href="/outreach" style={{ ...buttonStyle(true), textDecoration: "none" }}>E-Mail Queue →</Link>
          </div>
        </header>

        {error && <div style={{ marginBottom: 18, padding: 14, border: "1px solid rgba(255,110,110,.3)", background: "rgba(255,80,80,.08)", borderRadius: 14, color: "#ffb3b3" }}>{error}</div>}

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 18 }}>
          {(Object.keys(meta) as Channel[]).map((key) => {
            const state = snapshot?.channels?.[key] || { target: key === "call" ? 120 : key === "email" ? 100 : 30, ready: 0, done: 0, total: 0 };
            const percent = Math.min(100, Math.round((state.total / Math.max(1, state.target)) * 100));
            return (
              <button key={key} onClick={() => setChannel(key)} style={{ textAlign: "left", padding: 18, borderRadius: 20, border: channel === key ? "1px solid rgba(213,255,89,.45)" : "1px solid rgba(255,255,255,.1)", background: channel === key ? "rgba(213,255,89,.07)" : "rgba(255,255,255,.035)", color: "inherit", cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center" }}>
                  <span style={{ fontWeight: 800, fontSize: 13 }}>{meta[key].icon} {meta[key].label}</span>
                  <span style={{ color: state.total >= state.target ? "#bffb84" : "#f2d98c", fontSize: 11 }}>{state.total}/{state.target}</span>
                </div>
                <div style={{ marginTop: 14, fontSize: 36, fontWeight: 850, letterSpacing: "-.05em" }}>{state.ready}</div>
                <div style={{ color: "#7f8998", fontSize: 11 }}>bereit · {state.done} erledigt</div>
                <div style={{ marginTop: 12, height: 6, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,.08)" }}><div style={{ height: "100%", width: `${percent}%`, background: "linear-gradient(90deg,#d5ff59,#5df0b8)" }} /></div>
                <div style={{ marginTop: 9, color: "#8f98a6", fontSize: 11 }}>{meta[key].hint}</div>
              </button>
            );
          })}
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1.55fr) minmax(300px,.45fr)", gap: 14 }}>
          <div style={{ border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.03)", borderRadius: 22, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: 16, borderBottom: "1px solid rgba(255,255,255,.08)" }}>
              <div><strong>{meta[channel].label} Queue</strong><div style={{ marginTop: 3, fontSize: 11, color: "#7f8998" }}>höchste Abschlusswahrscheinlichkeit zuerst</div></div>
              {channel === "linkedin" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => void run({ action: "linkedin-drafts", limit: 30 })} disabled={Boolean(busy)} style={miniButton}>Texte vorbereiten</button>
                <button onClick={() => void run({ action: "linkedin-dispatch", limit: 10 })} disabled={Boolean(busy) || !snapshot?.workers.linkedin.configured} style={miniButton}>Worker starten</button>
              </div>}
            </div>
            <div style={{ maxHeight: "68vh", overflowY: "auto" }}>
              {tasks.map((task) => {
                const p = task.payload || {};
                const r = reasons(p);
                return (
                  <article key={task.id} style={{ display: "grid", gridTemplateColumns: "58px minmax(0,1fr) auto", gap: 14, padding: "16px", borderBottom: "1px solid rgba(255,255,255,.06)", alignItems: "start" }}>
                    <div style={{ width: 48, height: 48, borderRadius: 14, display: "grid", placeItems: "center", background: "rgba(213,255,89,.09)", color: "#d5ff59", fontWeight: 900 }}>{task.rank}</div>
                    <div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <strong style={{ fontSize: 14 }}>{value(p, "company") || "Lead"}</strong>
                        <span style={{ padding: "4px 7px", borderRadius: 999, background: "rgba(255,255,255,.07)", color: "#aeb6c2", fontSize: 10 }}>{value(p, "tier") || "qualifiziert"}</span>
                        <span style={{ color: "#d5ff59", fontSize: 11, fontWeight: 800 }}>{task.score}/100</span>
                      </div>
                      <div style={{ marginTop: 5, color: "#7f8998", fontSize: 11 }}>{value(p, "city") || "Deutschland"} {value(p, "jobCount") ? `· ${value(p, "jobCount")} offene Stelle(n)` : ""}</div>
                      {r.length > 0 && <div style={{ marginTop: 9, fontSize: 12, lineHeight: 1.5, color: "#b9c0ca" }}>{r.join(" · ")}</div>}
                      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {value(p, "phone") && <a href={`tel:${value(p, "phone")}`} style={linkPill}>☎ {value(p, "phone")}</a>}
                        {value(p, "email") && <a href={`mailto:${value(p, "email")}`} style={linkPill}>✉ Mail</a>}
                        {value(p, "linkedin") && <a href={value(p, "linkedin")} target="_blank" rel="noreferrer" style={linkPill}>in Profil</a>}
                        {value(p, "website") && <a href={value(p, "website")} target="_blank" rel="noreferrer" style={linkPill}>↗ Website</a>}
                      </div>
                      {value(p, "message") && <div style={{ marginTop: 10, padding: 11, borderRadius: 12, background: "#0b0e13", color: "#aeb6c2", fontSize: 11, lineHeight: 1.5 }}>{value(p, "message")}</div>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                      <span style={{ fontSize: 10, color: task.status === "done" || task.status === "sent" ? "#84f5c8" : "#8f98a6" }}>{task.status.toUpperCase()}</span>
                      {!["done", "sent", "completed"].includes(task.status) && <button onClick={() => void mark(task, channel === "email" || channel === "linkedin" ? "sent" : "done")} style={miniButton}>✓ erledigt</button>}
                    </div>
                  </article>
                );
              })}
              {!tasks.length && <div style={{ padding: 42, textAlign: "center", color: "#7f8998" }}>{busy ? "Queue wird aufgebaut …" : "Für diesen Kanal sind noch keine passenden Leads vorhanden."}</div>}
            </div>
          </div>

          <aside style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={panel}>
              <div style={eyebrow}>OPENOUTREACH</div>
              <h3 style={panelTitle}>ICP-Learning Sidecar</h3>
              <p style={panelText}>OpenOutreach liefert zusätzliche Entscheider + LinkedIn-URLs und bleibt als separater Worker angebunden. Dein CRM bleibt die Quelle der Wahrheit.</p>
              <StatusLine ok={Boolean(snapshot?.workers.openOutreach.configured)} label="Lead Worker" />
              <StatusLine ok={Boolean(snapshot?.workers.linkedin.configured)} label="LinkedIn Worker" />
              <StatusLine ok={Boolean(snapshot?.workers.linkedin.autoSend)} label="Auto-Send" neutral={!snapshot?.workers.linkedin.autoSend} />
            </div>
            <div style={panel}>
              <div style={eyebrow}>KOSTENLOGIK</div>
              <h3 style={panelTitle}>Teuer nur bei Top-Leads</h3>
              <p style={panelText}>Alle 120 werden angerufen. 100 erhalten E-Mail-Priorität. Nur die Top 30 bekommen Video und LinkedIn. Engagement kann später die Reihenfolge hochstufen.</p>
            </div>
            <div style={panel}>
              <div style={eyebrow}>WORKER-MODUS</div>
              <h3 style={panelTitle}>{snapshot?.workers.linkedin.autoSend ? "Automatisch aktiv" : "Queue-first"}</h3>
              <p style={panelText}>{snapshot?.workers.linkedin.configured ? "Der LinkedIn-Worker ist verbunden. Ohne Auto-Send werden Aktionen erst an die Worker-Queue übergeben." : "LinkedIn ist im Sales OS integriert, aber der externe Browser-Worker braucht noch seine URL/Session."}</p>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function StatusLine({ ok, label, neutral = false }: { ok: boolean; label: string; neutral?: boolean }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderTop: "1px solid rgba(255,255,255,.06)", fontSize: 12 }}><span style={{ color: "#aeb6c2" }}>{label}</span><b style={{ color: neutral ? "#f2d98c" : ok ? "#84f5c8" : "#ffadad" }}>{neutral ? "MANUELL" : ok ? "VERBUNDEN" : "FEHLT"}</b></div>;
}

const panel: React.CSSProperties = { padding: 18, borderRadius: 20, border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.035)" };
const eyebrow: React.CSSProperties = { color: "#d5ff59", fontSize: 10, fontWeight: 850, letterSpacing: ".12em" };
const panelTitle: React.CSSProperties = { margin: "8px 0", fontSize: 18, letterSpacing: "-.02em" };
const panelText: React.CSSProperties = { margin: "0 0 14px", color: "#8f98a6", fontSize: 12, lineHeight: 1.55 };
const miniButton: React.CSSProperties = { border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.06)", color: "#eef1f4", padding: "7px 10px", borderRadius: 10, cursor: "pointer", fontSize: 11, fontWeight: 700 };
const linkPill: React.CSSProperties = { ...miniButton, display: "inline-flex", textDecoration: "none", color: "#d5ff59" };
function buttonStyle(secondary: boolean): React.CSSProperties { return { border: secondary ? "1px solid rgba(255,255,255,.12)" : "1px solid rgba(213,255,89,.35)", background: secondary ? "rgba(255,255,255,.05)" : "rgba(213,255,89,.1)", color: secondary ? "#eef1f4" : "#d5ff59", padding: "10px 14px", borderRadius: 12, cursor: "pointer", fontSize: 12, fontWeight: 800 }; }
