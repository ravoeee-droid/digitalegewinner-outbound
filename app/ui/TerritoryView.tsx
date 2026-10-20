"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./TerritoryView.module.css";

type EvidenceKind = "portal" | "portal_listing" | "ads" | "hiring" | "funnel" | "references" | "other";
type Evidence = { kind: EvidenceKind; url: string; note: string; addedAt: string; verification: "manual" };
type Candidate = {
  id: string; county: string; state: string; name: string; city: string; website: string;
  phone: string; source_url: string; evidence: Evidence[]; score: number;
  crm_lead_id: string | null; updated_at: string;
};
type Scan = { id: string; county: string; state: string; status: string; found_count: number;
  inserted_count: number; message: string; created_at: string; finished_at: string | null };
type Data = { scans: Scan[]; candidates: Candidate[]; capped: boolean };
const states = [
  "Baden-Württemberg", "Bayern", "Berlin", "Brandenburg", "Bremen", "Hamburg",
  "Hessen", "Mecklenburg-Vorpommern", "Niedersachsen", "Nordrhein-Westfalen",
  "Rheinland-Pfalz", "Saarland", "Sachsen", "Sachsen-Anhalt", "Schleswig-Holstein", "Thüringen",
];
const KINDS: Array<[EvidenceKind, string]> = [
  ["portal", "Leadkauf ausdrücklich bestätigt"],
  ["portal_listing", "Bei einem Leadportal gelistet (kein Kaufnachweis)"],
  ["ads", "Aktive Google- / Meta-Anzeige"],
  ["hiring", "Vertrieb / offene Stellen"],
  ["funnel", "Website- / Conversion-Schwäche"],
  ["references", "Referenzen / Vertrauenssignal"],
  ["other", "Sonstige Information"],
];
function grade(score: number) {
  return score >= 75 ? "A++" : score >= 50 ? "A" : "Research";
}
function shortDate(date: string) {
  return new Date(date).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function TerritoryView({ canEdit }: { canEdit: boolean }) {
  const [county, setCounty] = useState("Rhein-Erft-Kreis");
  const [state, setState] = useState("Nordrhein-Westfalen");
  const [applied, setApplied] = useState({ county: "Rhein-Erft-Kreis", state: "Nordrhein-Westfalen" });
  const [data, setData] = useState<Data | null>(null);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [kind, setKind] = useState<EvidenceKind>("portal");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCity, setAddCity] = useState("");
  const [addWebsite, setAddWebsite] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addSource, setAddSource] = useState("");

  const load = useCallback(async (area: { county: string; state: string }) => {
    const params = new URLSearchParams({ county: area.county, state: area.state });
    const result = await fetch(`/api/territories?${params}`, { cache: "no-store" });
    const json = await result.json();
    if (!result.ok) throw new Error(json.error || "Daten konnten nicht geladen werden.");
    setData(json as Data);
  }, []);

  useEffect(() => {
    void load(applied).catch(e => setError(e instanceof Error ? e.message : "Ladefehler"));
  }, [applied, load]);

  const rows = useMemo(() => (data?.candidates || []).filter(item => {
    const matchFilter = filter === "all" || (filter === "hot" && item.score >= 75)
      || (filter === "needs-review" && !item.crm_lead_id)
      || (filter === "crm" && Boolean(item.crm_lead_id));
    const q = search.trim().toLowerCase();
    return matchFilter && (!q || [item.name, item.city, item.website].join(" ").toLowerCase().includes(q));
  }), [data, filter, search]);

  const selectedRow = (data?.candidates || []).find(item => item.id === selected);
  const total = data?.candidates.length || 0;
  const hot = (data?.candidates || []).filter(item => item.score >= 75).length;
  const imported = (data?.candidates || []).filter(item => item.crm_lead_id).length;
  const portalProof = (data?.candidates || []).filter(item => (item.evidence || []).some(e => e.kind === "portal")).length;

  async function act(payload: Record<string, unknown>, successMessage: string) {
    setBusy(String(payload.action));
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/territories", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Aktion fehlgeschlagen.");
      setNotice(result.message || successMessage);
      await load(applied);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verarbeitung fehlgeschlagen");
      return false;
    } finally { setBusy(""); }
  }

  async function runScan() {
    const next = { county: county.trim(), state };
    if (next.county.length < 3) { setError("Bitte Landkreis eingeben."); return; }
    setApplied(next);
    // Pass requested county into load without relying on an asynchronous React state update.
    setBusy("scan");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/territories", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan", ...next }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Scan fehlgeschlagen");
      setNotice(json.message || `${json.found} Einträge geprüft; ${json.inserted} erstmals gespeichert.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan fehlgeschlagen");
    } finally {
      setBusy("");
      await load(next).catch(() => undefined);
    }
  }

  return (
    <main className="dg-page">
      <header className="dg-head">
        <div className="dg-head-copy">
          <span className="dg-eyebrow">DG Intent Engine · Territory Intelligence</span>
          <h1 className="dg-title">Landkreis-Scanner</h1>
          <p className="dg-lead">PV- und Elektrobetriebe je Gebiet finden, Quellen dokumentieren, nach echtem Bedarf bewerten und direkt ins bestehende CRM übernehmen.</p>
        </div>
        <div className="dg-actions">
          <Link href="/crm" className="dg-btn">CRM öffnen</Link>
          <Link href="/call" className="dg-btn">Call-Cockpit</Link>
        </div>
      </header>

      <section className={`dg-panel ${styles.controls}`} aria-label="Gebietsauswahl">
        <div className={styles.controlsGrid}>
          <label>Landkreis
            <input value={county} onChange={e => setCounty(e.target.value)}
              placeholder="z. B. Rhein-Erft-Kreis" maxLength={100} />
          </label>
          <label>Bundesland
            <select value={state} onChange={e => setState(e.target.value)}>
              {states.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <div className={styles.controlButtons}>
            <button className="dg-btn" type="button" disabled={!!busy} onClick={() => {
              setApplied({ county: county.trim(), state }); setNotice(""); setError("");
            }}>Gebiet anzeigen</button>
            {canEdit && <button className="dg-btn dg-btn-primary" type="button" disabled={!!busy}
              onClick={() => void runScan()}>{busy === "scan" ? "Suche läuft …" : "Landkreis recherchieren"}</button>}
            {canEdit && <button className="dg-btn" type="button" disabled={!!busy}
              onClick={() => setAddOpen(value => !value)}>{addOpen ? "Quellenimport schließen" : "+ Firma aus Portalquelle"}</button>}
          </div>
        </div>
        <p className={styles.disclaimer}>Quelle V1: OpenStreetMap (öffentliche Unternehmens-Einträge). Das ist <strong>keine vollständige Landkreis-Abdeckung</strong>. Leadportal-Kunden, Ads und Stellenanzeigen werden nur mit separat dokumentiertem Nachweis bewertet. Ein Scan startet ausschließlich auf Knopfdruck und kann durch öffentliche API-Limits scheitern.</p>
      </section>

      {addOpen && canEdit && <section className={`dg-panel ${styles.evidenceEditor}`}>
        <div className={styles.resultHead}>
          <div><h2>Firma aus Aroundhome, WattFox oder einer anderen Quelle ergänzen</h2>
          <p>Ohne OSM-Eintrag möglich. Der Originalquellenlink ist Pflicht; die tatsächliche Leadnutzung prüfen wir getrennt.</p></div>
          <button className="dg-btn" type="button" onClick={() => setAddOpen(false)}>Schließen</button>
        </div>
        <form className={styles.evidenceForm} onSubmit={async e => {
          e.preventDefault();
          const ok = await act({ action: "add", county: county.trim(), state, name: addName.trim(),
            city: addCity.trim(), website: addWebsite.trim(), phone: addPhone.trim(),
            sourceUrl: addSource.trim() }, "Firma mit Originalquelle gespeichert.");
          if (ok) { setApplied({ county: county.trim(), state }); setAddOpen(false); setAddName(""); setAddCity(""); setAddWebsite(""); setAddPhone(""); setAddSource(""); }
        }}>
          <label>Firmenname<input required minLength={3} maxLength={240} value={addName}
            onChange={e => setAddName(e.target.value)} placeholder="Name des PV-Betriebs" /></label>
          <label>Stadt<input maxLength={150} value={addCity} onChange={e => setAddCity(e.target.value)} placeholder="Ort" /></label>
          <label>Website<input type="text" maxLength={600} value={addWebsite} onChange={e => setAddWebsite(e.target.value)} placeholder="https://beispiel.de" /></label>
          <label>Telefon<input maxLength={120} value={addPhone} onChange={e => setAddPhone(e.target.value)} placeholder="Öffentliche Geschäftsnummer" /></label>
          <label>Originalquelle (Pflicht)<input type="url" required value={addSource}
            onChange={e => setAddSource(e.target.value)} placeholder="https://www.aroundhome.de/fachfirmen/firma/..." /></label>
          <button className="dg-btn dg-btn-primary" type="submit" disabled={!!busy}>Firma speichern</button>
        </form>
      </section>}

      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}

      <section className={styles.metrics} aria-label="Gebietskennzahlen">
        <div className="dg-panel"><small>Erfasste Firmen</small><strong>{total}</strong><span>im ausgewählten Gebiet</span></div>
        <div className="dg-panel"><small>A++-Kandidaten</small><strong>{hot}</strong><span>Score ab 75</span></div>
        <div className="dg-panel"><small>Portal-Indizien</small><strong>{portalProof}</strong><span>manuell belegte Quellen</span></div>
        <div className="dg-panel"><small>Im CRM</small><strong>{imported}</strong><span>bereits übernommen</span></div>
      </section>

      <section className={`dg-panel ${styles.results}`}>
        <div className={styles.resultHead}>
          <div>
            <h2>Firmen · {applied.county}</h2>
            <p>Originalquelle und Evidenzen jederzeit nachvollziehbar.</p>
          </div>
          <input type="search" aria-label="Firmen filtern" value={search}
            onChange={e => setSearch(e.target.value)} placeholder="Firma oder Ort suchen" />
        </div>
        <div className={styles.chips} role="group" aria-label="Firmenfilter">
          {([["all","Alle"],["hot","A++"],["needs-review","Nicht im CRM"],["crm","Im CRM"]] as const).map(([key, label]) =>
            <button key={key} type="button" className={filter === key ? styles.selectedChip : styles.chip}
              aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
        </div>
        {!data && <p className={styles.empty}>Lade Daten …</p>}
        {data && rows.length === 0 && <div className={styles.empty}>
          <strong>Keine passenden Firmen gespeichert.</strong>
          <p>Bitte Landkreis auswählen und die Recherche starten oder einen anderen Filter wählen.</p>
        </div>}
        {data && rows.length > 0 && <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead><tr><th>Unternehmen</th><th>Score</th><th>Belege</th><th>Kontakt</th><th>Aktion</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.id}>
              <td><strong>{row.name}</strong><small>{row.city || row.county}</small>
                <a href={row.source_url} target="_blank" rel="noopener noreferrer">Originalquelle ↗</a></td>
              <td><span className={`${styles.score} ${row.score >= 75 ? styles.highScore : ""}`}>{row.score}/100 · {grade(row.score)}</span></td>
              <td>{(row.evidence || []).length ? <>
                <strong>{row.evidence.length} Quelle(n)</strong>
                {(row.evidence || []).slice(0,2).map(e => <a key={e.kind + e.url} href={e.url}
                  target="_blank" rel="noopener noreferrer">{KINDS.find(k => k[0] === e.kind)?.[1].split(" (")[0]} ↗</a>)}
              </> : <span className={styles.muted}>Portalnutzung unbekannt</span>}</td>
              <td>{row.website && <a href={row.website} target="_blank" rel="noopener noreferrer">Website ↗</a>}
                {row.phone && <a href={`tel:${row.phone.replace(/[^+\d]/g,"")}`}>{row.phone}</a>}
                {!row.website && !row.phone && <span className={styles.muted}>Noch recherchieren</span>}</td>
              <td><div className={styles.rowActions}>
                {canEdit && <button type="button" className="dg-btn" onClick={() => {
                  setSelected(prev => prev === row.id ? null : row.id); setUrl(""); setNote("");
                }}>{selected === row.id ? "Schließen" : "Nachweis +"}</button>}
                {row.crm_lead_id ? <span className={styles.inCrm}>✓ Im CRM</span> : canEdit &&
                  <button type="button" className="dg-btn dg-btn-primary" disabled={!!busy} onClick={() =>
                    void act({ action: "import", id: row.id }, "Firma wurde ins CRM übernommen.")
                  }>Ins CRM</button>}
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>}
        {data?.capped && <p className={styles.disclaimer}>Die Liste zeigt höchstens 350 Firmen. Für größere Gebiete sollten Pagination und weitere Datenquellen ergänzt werden.</p>}
      </section>

      {selectedRow && canEdit && <section className={`dg-panel ${styles.evidenceEditor}`}>
        <div className={styles.resultHead}><div><h2>Nachweis hinzufügen</h2><p>{selectedRow.name} · manuell dokumentierter Quellenhinweis, keine automatische Bestätigung</p></div>
          <button type="button" className="dg-btn" onClick={() => setSelected(null)}>Schließen</button></div>
        <form className={styles.evidenceForm} onSubmit={async e => {
          e.preventDefault();
          const ok = await act({ action: "evidence", id: selectedRow.id, kind, url: url.trim(), note: note.trim() }, "Nachweis gespeichert.");
          if (ok) { setUrl(""); setNote(""); setSelected(null); }
        }}>
          <label>Signal<select value={kind} onChange={e => setKind(e.target.value as EvidenceKind)}>
            {KINDS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>Direkter Quellenlink<input required type="url" value={url}
            onChange={e => setUrl(e.target.value)} placeholder="https://.../originalanzeige" maxLength={1200} /></label>
          <label>Was beweist die Quelle?<textarea required minLength={4} maxLength={800}
            value={note} onChange={e => setNote(e.target.value)}
            placeholder="z. B. Stellenanzeige erwähnt ausdrücklich zugekaufte Leads." rows={3} /></label>
          <button className="dg-btn dg-btn-primary" type="submit" disabled={!!busy}>Nachweis speichern und Score aktualisieren</button>
        </form>
      </section>}

      <section className={`dg-panel ${styles.history}`}>
        <h2>Letzte Recherchen</h2>
        {!data?.scans?.length && <p>Es wurde noch kein Landkreis gescannt.</p>}
        {(data?.scans || []).map(scan => <div className={styles.historyItem} key={scan.id}>
          <div><strong>{scan.county}</strong><small>{scan.state} · {shortDate(scan.created_at)}</small></div>
          <div><strong>{scan.status === "completed" ? `${scan.found_count} Einträge` : scan.status === "failed" ? "Fehlgeschlagen" : "In Bearbeitung"}</strong>
            <small>{scan.message || `${scan.inserted_count} neu gespeichert`}</small></div>
        </div>)}
      </section>
    </main>
  );
}
