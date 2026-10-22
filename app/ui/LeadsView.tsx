"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./LeadsView.module.css";

type Row = { id: string; company: string; city: string; website: string; contact: string; email: string; phone: string; stage: string; score: number; mail_status: string | null; last_sent: string | null; do_not_contact: boolean; shot?: boolean | null; video_token?: string; views?: number; plays?: number; progress?: number; watch?: number; dwell?: number; calendar?: number };
type Data = { counts: { total: number; with_email: number; ready: number; contacted: number }; filter: string; page: number; pages: number; total: number; rows: Row[] };

const FILTERS: Array<[string, string]> = [["alle", "Alle"], ["bereit", "Bereit zum Anschreiben"], ["email", "Mit E-Mail"], ["angeschrieben", "Angeschrieben"], ["ohne_email", "Ohne E-Mail"], ["video", "Video angesehen (anrufen)"]];
const nf = new Intl.NumberFormat("de-DE");

function status(row: Row) {
  if (row.do_not_contact) return { label: "Nicht kontaktieren", tone: "bad" };
  if (row.mail_status === "sent") return { label: "Angeschrieben", tone: "ok" };
  if (row.mail_status === "stopped") return { label: "Antwort erhalten", tone: "ok" };
  if (row.mail_status === "queued" || row.mail_status === "sending") return { label: "In Warteschlange", tone: "warn" };
  if (!row.email) return { label: "E-Mail fehlt", tone: "bad" };
  return { label: "Bereit", tone: "ok" };
}

function videoCell(row: Row) {
  if (!row.video_token) return <span className={styles.muted}>-</span>;
  const analyse = <small><a href={`/api/t/analyse/${encodeURIComponent(row.video_token)}`} target="_blank" rel="noopener noreferrer">Analyse (PDF) für den Termin</a></small>;
  if (!row.shot) return <><span className={styles.muted}>noch kein Screenshot</span>{analyse}</>;
  const steps = [row.views ? "geöffnet" : "", row.plays ? "Play" : "", row.progress ? `${row.progress} % gesehen` : "", row.watch ? `${row.watch} s` : "", row.calendar ? "Kalender" : ""].filter(Boolean);
  return (
    <>
      <a href={`/v/${encodeURIComponent(row.video_token)}`} target="_blank" rel="noopener noreferrer">Seite ansehen</a>
      <small>{steps.length ? steps.join(" · ") : "noch nicht geöffnet"}</small>
      {analyse}
    </>
  );
}

function Blocklist({ onChange }: { onChange: () => void }) {
  const [rows, setRows] = useState<Array<{ id: string; pattern: string; note: string }>>([]);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try { const json = await (await fetch("/api/leads/blocklist", { cache: "no-store" })).json(); setRows(json.rows || []); } catch { /* Anzeige bleibt leer */ }
  }, []);
  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, [load]);
  async function add(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/leads/blocklist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pattern: text }) });
    const json = await response.json();
    setMessage(response.ok ? `Gesperrt. ${json.blocked || 0} Lead(s) aus der Liste genommen.` : json.error || "Speichern fehlgeschlagen");
    if (response.ok) { setText(""); load(); onChange(); }
  }
  async function remove(id: string) { await fetch(`/api/leads/blocklist?id=${id}`, { method: "DELETE" }); load(); }
  return (
    <details className={styles.blocklist}>
      <summary>Sperrliste: Kunden, die keine Mail bekommen ({rows.length})</summary>
      <p>Wer hier steht, wird nie angeschrieben, auch nicht von neuen Lead-Quellen. Ein Eintrag sperrt jeden Lead, dessen Firmenname, Website oder E-Mail den Text enthält.</p>
      <form onSubmit={add}>
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Firmenname, Website oder E-Mail-Teil" aria-label="Neuer Eintrag für die Sperrliste" />
        <button type="submit" className="dg-btn">Sperren</button>
      </form>
      {message && <p role="status">{message}</p>}
      <ul>{rows.map((row) => <li key={row.id}><strong>{row.pattern}</strong><span>{row.note}</span><button type="button" onClick={() => remove(row.id)} aria-label={`${row.pattern} entsperren`}>Entsperren</button></li>)}</ul>
    </details>
  );
}

export default function LeadsView() {
  const [filter, setFilter] = useState("bereit");
  const [segment, setSegment] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/leads/overview?filter=${filter}&q=${encodeURIComponent(search)}&page=${page}&segment=${segment}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Laden fehlgeschlagen");
      setData(json);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Laden fehlgeschlagen");
    }
  }, [filter, search, page, segment]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => { setSearch(q.trim()); setPage(1); }, 350);
    return () => clearTimeout(timer);
  }, [q]);

  const counts = data?.counts;
  const target = 300;

  return (
    <main className="dg-page">
      <header className="dg-head">
        <div className="dg-head-copy">
          <span className="dg-eyebrow">Leads</span>
          <h1 className="dg-title">Ihre Leads</h1>
          <p className="dg-lead">Alle Pflegedienste und Heime, ihr Ansprechpartner und ob schon eine Mail rausging.</p>
        </div>
        <div className="dg-actions">
          <Link href="/crm" className="dg-btn">Im CRM öffnen</Link>
          <Link href="/pflege?view=finder" className="dg-btn dg-btn-primary">Neue Leads suchen</Link>
        </div>
      </header>

      {error && <p className="dg-notice" role="alert">{error}</p>}

      <section className={styles.kpis} aria-label="Lead-Kennzahlen">
        <div className={`dg-panel ${styles.kpi}`}><span>Leads gesamt</span><strong>{counts ? nf.format(counts.total) : "–"}</strong></div>
        <div className={`dg-panel ${styles.kpi}`}><span>Mit E-Mail</span><strong>{counts ? nf.format(counts.with_email) : "–"}</strong><small>{counts && counts.total ? `${Math.round((counts.with_email / counts.total) * 100)} % aller Leads` : ""}</small></div>
        <div className={`dg-panel ${styles.kpi} ${styles.hot}`}><span>Bereit zum Anschreiben</span><strong>{counts ? nf.format(counts.ready) : "–"}</strong><small>{counts ? (counts.ready >= target ? "Reicht für einen Tag mit 300 Mails" : `${nf.format(Math.max(0, target - counts.ready))} fehlen für 300 pro Tag`) : ""}</small></div>
        <div className={`dg-panel ${styles.kpi}`}><span>Bereits angeschrieben</span><strong>{counts ? nf.format(counts.contacted) : "–"}</strong></div>
      </section>

      <section className={`dg-panel ${styles.listPanel}`}>
        <div className={styles.toolbar}>
          <div className={styles.chips} role="group" aria-label="Kampagne">
            {[["", "Alle Kampagnen"], ["pflege", "Pflege"], ["pv", "Photovoltaik"]].map(([key, label]) => (
              <button key={key} type="button" className={segment === key ? styles.chipOn : styles.chip} aria-pressed={segment === key} onClick={() => { setSegment(key); setPage(1); }}>{label}</button>
            ))}
          </div>
          <div className={styles.chips} role="group" aria-label="Filter">
            {FILTERS.map(([key, label]) => (
              <button key={key} type="button" className={filter === key ? styles.chipOn : styles.chip} aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(1); }}>{label}</button>
            ))}
          </div>
          <label className={styles.search}>
            <span className={styles.srOnly}>Leads durchsuchen</span>
            <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Firma, Ort oder E-Mail suchen" />
          </label>
        </div>

        {!data && !error && <p className={styles.empty}>Lade Leads …</p>}
        {data && data.rows.length === 0 && (
          <div className={styles.empty}>
            <strong>{data.counts.total === 0 ? "Noch keine Leads." : "Keine Leads für diesen Filter."}</strong>
            <p>{data.counts.total === 0 ? "Starten Sie die Suche. Die Lead-Suche läuft außerdem werktags alle 3 Stunden automatisch." : "Wählen Sie oben einen anderen Filter."}</p>
            {data.counts.total === 0 && <Link href="/pflege?view=finder" className="dg-btn dg-btn-primary">Neue Leads suchen</Link>}
          </div>
        )}
        {data && data.rows.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Firma</th><th scope="col">Ansprechpartner</th><th scope="col">E-Mail</th><th scope="col">Telefon</th><th scope="col">Video-Seite</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {data.rows.map((row) => {
                  const state = status(row);
                  return (
                    <tr key={row.id}>
                      <td data-label="Firma"><strong>{row.company}</strong><small>{row.city || "Ort unbekannt"}</small></td>
                      <td data-label="Ansprechpartner">{row.contact || <span className={styles.muted}>nicht bekannt</span>}</td>
                      <td data-label="E-Mail">{row.email ? <a href={`mailto:${row.email}`}>{row.email}</a> : <span className={styles.muted}>fehlt</span>}</td>
                      <td data-label="Telefon">{row.phone ? <a href={`tel:${row.phone.replace(/\s+/g, "")}`}>{row.phone}</a> : <span className={styles.muted}>–</span>}</td>
                      <td data-label="Video-Seite">{videoCell(row)}</td>
                      <td data-label="Status"><span className={`${styles.badge} ${styles[state.tone]}`}>{state.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Blocklist onChange={load} />
        {data && data.pages > 1 && (
          <nav className={styles.pager} aria-label="Seiten">
            <button type="button" className="dg-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Zurück</button>
            <span>Seite {data.page} von {data.pages} · {nf.format(data.total)} Leads</span>
            <button type="button" className="dg-btn" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Weiter</button>
          </nav>
        )}
      </section>
    </main>
  );
}
