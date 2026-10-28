"use client";

import { ChangeEvent, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./us-pv-pilot.module.css";

type LeadRecord = {
  company: string;
  email_candidate: string;
  city?: string;
  state?: string;
  website?: string;
  place_id?: string;
  [key: string]: unknown;
};

export default function UsPvPilotPage() {
  const [records, setRecords] = useState<LeadRecord[]>([]);
  const [limit, setLimit] = useState(10);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const preview = useMemo(() => records.slice(0, limit), [records, limit]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(""); setResult("");
    try {
      const parsed = JSON.parse(await file.text()) as { records?: LeadRecord[] } | LeadRecord[];
      const next = Array.isArray(parsed) ? parsed : parsed.records;
      if (!Array.isArray(next) || !next.length) throw new Error("Keine Leads in der Datei gefunden.");
      setRecords(next); setFileName(file.name); setLimit(Math.min(10, next.length));
    } catch (cause) {
      setRecords([]); setFileName(""); setError(cause instanceof Error ? cause.message : "Datei konnte nicht gelesen werden.");
    }
  }

  async function prepare() {
    setBusy(true); setError(""); setResult("");
    try {
      const response = await fetch("/api/us-pv-pilot/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ records, limit }),
      });
      const json = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(json.error || "Vorbereitung fehlgeschlagen.");
      setResult(json.message || "Pilot vorbereitet.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Vorbereitung fehlgeschlagen.");
    } finally { setBusy(false); }
  }

  return (
    <main className={styles.page}>
      <header>
        <span>US MARKET · PV-TRUST</span>
        <h1>California Solar Calculator Pilot</h1>
        <p>Importiert ausschließlich die ausgewählten US-Solar-Leads und legt eine klar abgegrenzte Kampagne als Entwurf an. Kein automatischer Versand.</p>
      </header>

      <section className={styles.panel}>
        <div className={styles.step}><b>1</b><div><strong>Shortlist auswählen</strong><small>Erwartet die geprüfte JSON-Datei mit <code>records</code>.</small></div></div>
        <label className={styles.file}>
          <input type="file" accept="application/json,.json" onChange={chooseFile} />
          <span>{fileName || "JSON-Datei auswählen"}</span>
        </label>

        {records.length > 0 && <>
          <div className={styles.controls}>
            <label>Erster Batch <input type="number" min={1} max={Math.min(100, records.length)} value={limit} onChange={(event) => setLimit(Math.max(1, Math.min(100, records.length, Number(event.target.value) || 1)))} /></label>
            <span>{records.length} geprüfte Leads in der Datei</span>
          </div>
          <div className={styles.table}>
            {preview.map((lead, index) => <div key={`${lead.place_id || lead.email_candidate}-${index}`}><b>{index + 1}</b><span><strong>{lead.company}</strong><small>{lead.city}, {lead.state} · {lead.email_candidate}</small></span></div>)}
          </div>
          <button className={styles.primary} type="button" disabled={busy} onClick={prepare}>{busy ? "Wird vorbereitet …" : `${limit} Leads importieren & Entwurf anlegen`}</button>
        </>}
        {error && <p className={styles.error}>{error}</p>}
        {result && <div className={styles.success}><strong>{result}</strong><Link href="/pflege?view=campaigns">Kampagne prüfen →</Link></div>}
      </section>
    </main>
  );
}

