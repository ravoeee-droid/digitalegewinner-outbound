"use client";

import { useCallback, useEffect, useState } from "react";

type Draft = {
  id: string; slot: number; company: string; website: string; phone: string; source_url: string;
  draft_text: string; status: string; planned_day: string; consent_ready: boolean; error: string;
};
type Overview = {
  limit: number; prepared: number; ready: number; sent: number;
  providerConfigured: boolean; autoSendEnabled: boolean; rows: Draft[];
};
const panel: React.CSSProperties = { background: "#111e19", border: "1px solid #30463c", borderRadius: 14, padding: 18 };
const muted: React.CSSProperties = { color: "#a8b5ad", fontSize: 13 };
const action: React.CSSProperties = { background: "#3bd37c", color: "#05100a", border: 0, borderRadius: 9, padding: "10px 14px", cursor: "pointer", fontWeight: 800 };

export default function PVWhatsAppSprint() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/pv-whatsapp", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Fehler beim Laden");
    setData(body);
  }, []);
  useEffect(() => { void load().catch(e => setError(String(e))); }, [load]);
  async function prepare() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/pv-whatsapp", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Recherche fehlgeschlagen");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Recherche fehlgeschlagen"); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ display: "grid", gap: 18, paddingTop: 22 }}>
      <header>
        <div style={{ color: "#65d99a", fontSize: 12, fontWeight: 800, letterSpacing: 2 }}>DG OUTBOUND / PV TRUST</div>
        <h1 style={{ margin: "9px 0", fontSize: 31 }}>WhatsApp 30er-Sprint</h1>
        <p style={muted}>Jeden Werktag bis zu 30 neue PV-Betriebe mit einem WhatsApp-Link auf ihrer Website erkennen, prüfen und im CRM vorbereiten.</p>
      </header>
      <section style={{ ...panel, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
          <div><strong style={{ fontSize: 28 }}>{data?.prepared ?? "–"}/30</strong><div style={muted}>Heute vorbereitet</div></div>
          <div><strong style={{ fontSize: 28 }}>{data?.ready ?? "–"}</strong><div style={muted}>Mit dokumentiertem Opt-in</div></div>
          <div><strong style={{ fontSize: 28 }}>{data?.sent ?? "–"}</strong><div style={muted}>Heute versendet</div></div>
        </div>
        <p style={muted}>Automatischer Versand: {data?.providerConfigured && data?.autoSendEnabled ? "technisch aktiviert (nur mit Opt-in)" : "deaktiviert – Meta-Zugang, genehmigte Vorlage und Aktivierung nötig"}. Eine öffentliche Nummer allein erlaubt keine Werbenachricht.</p>
        <div><button type="button" style={{ ...action, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => void prepare()}>{busy ? "Prüfe Websites …" : "Heutigen 30er-Pool vorbereiten"}</button></div>
        {error && <p role="alert" style={{ color: "#ff9b93" }}>{error}</p>}
      </section>
      <section style={{ ...panel, display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 19 }}>Erstnachrichten & WhatsApp-Quellen</h2>
        {!data && !error && <p style={muted}>Lade Daten …</p>}
        {data?.rows.length === 0 && <p style={muted}>Noch keine WhatsApp-Links erfasst. Starte die Recherche.</p>}
        {data?.rows.map(row => (
          <article key={row.id} style={{ padding: "13px 0", borderBottom: "1px solid #30463c", display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 9 }}>
              <strong>{row.slot}. {row.company}</strong>
              <span style={{ color: row.status === "sent" ? "#6ae9a1" : "#b7c0b9", fontSize: 12 }}>
                {row.status === "sent" ? "Versendet" : row.consent_ready ? "Opt-in geprüft" : "Entwurf – kein Opt-in"}
              </span>
            </div>
            <div style={muted}>WhatsApp: +{row.phone} · <a href={row.website.startsWith("http") ? row.website : "https://" + row.website} target="_blank" rel="noreferrer" style={{ color: "#73d9a0" }}>Website</a> · Quelle: {row.source_url.startsWith("https:") ? <a href={row.source_url} target="_blank" rel="noreferrer" style={{ color: "#73d9a0" }}>WhatsApp-Link gefunden</a> : row.source_url}</div>
            <div style={{ padding: "11px 13px", borderRadius: 9, background: "#1c3025", fontSize: 14 }}>{row.draft_text}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="button" onClick={() => void navigator.clipboard.writeText(row.draft_text)} style={{ ...action, background: "#263f30", color: "#d5f6dd", padding: "7px 11px" }}>Text kopieren</button>
              {row.error && <span style={{ color: "#ff9b93", fontSize: 12 }}>{row.error}</span>}
            </div>
          </article>
        ))}
      </section>
      <p style={muted}>Die Vorschau ist kein Versandbeleg und nicht automatisch eine genehmigte Meta-Vorlage. Versand nur nach Opt-in-Verifizierung, Template-Freigabe und aktiver WhatsApp-Business-API-Anbindung.</p>
    </div>
  );
}
