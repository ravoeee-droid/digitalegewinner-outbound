"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./germany-coverage-radar.module.css";

type StateCoverage = {
  code: string;
  name: string;
  sectors: number;
  tasksTotal: number;
  tasksDone: number;
  coveragePercent: number;
  pagesScanned: number;
  rawHits: number;
  companies: number;
  enriched: number;
  callReady: number;
  contacted: number;
  adSignal: number;
  pendingLeadIds: string[];
  lastRunAt: string | null;
};

type CoveragePayload = {
  states: StateCoverage[];
  global: {
    companies: number;
    unmapped: number;
    enriched: number;
    callReady: number;
    contacted: number;
    adSignal: number;
    tasksTotal: number;
    tasksDone: number;
    coveragePercent: number;
  };
  error?: string;
};

type Props = { onCrmChanged?: () => void | Promise<void> };

type Shape = { code: string; d: string; x: number; y: number };
const SHAPES: Shape[] = [
  { code: "SH", d: "M226 25 L336 32 L365 78 L337 121 L259 116 L220 78 Z", x: 292, y: 73 },
  { code: "HH", d: "M270 118 L304 116 L316 143 L291 158 L263 143 Z", x: 289, y: 138 },
  { code: "MV", d: "M350 77 L463 74 L512 116 L487 169 L398 178 L355 142 Z", x: 430, y: 127 },
  { code: "NI", d: "M132 130 L257 111 L352 143 L390 207 L352 263 L243 270 L151 236 L112 184 Z", x: 252, y: 201 },
  { code: "HB", d: "M154 176 L183 170 L195 194 L177 216 L149 205 Z", x: 173, y: 193 },
  { code: "BB", d: "M385 166 L487 166 L514 219 L497 302 L432 328 L376 291 L365 219 Z", x: 443, y: 248 },
  { code: "BE", d: "M426 225 L456 222 L469 246 L452 270 L423 260 Z", x: 447, y: 247 },
  { code: "NW", d: "M58 251 L154 232 L232 270 L230 351 L177 391 L91 369 L43 315 Z", x: 137, y: 315 },
  { code: "ST", d: "M285 255 L371 248 L410 299 L387 365 L318 376 L275 326 Z", x: 343, y: 313 },
  { code: "HE", d: "M183 345 L267 329 L323 374 L310 452 L250 475 L188 431 Z", x: 251, y: 404 },
  { code: "TH", d: "M307 362 L390 352 L430 397 L403 452 L337 463 L298 422 Z", x: 365, y: 409 },
  { code: "SN", d: "M405 372 L502 366 L531 414 L503 475 L421 468 L389 427 Z", x: 460, y: 421 },
  { code: "RP", d: "M105 381 L184 372 L218 424 L198 503 L134 524 L88 466 Z", x: 153, y: 451 },
  { code: "SL", d: "M77 484 L119 477 L141 512 L119 543 L79 531 L64 507 Z", x: 103, y: 511 },
  { code: "BW", d: "M139 503 L224 481 L292 523 L286 625 L235 669 L170 646 L127 576 Z", x: 213, y: 570 },
  { code: "BY", d: "M288 468 L401 451 L500 486 L526 559 L475 636 L375 662 L292 625 L267 543 Z", x: 397, y: 555 },
];

function pct(value: number, total: number) { return total > 0 ? Math.min(100, Math.round(value / total * 100)) : 0; }
function fmt(value: number) { return new Intl.NumberFormat("de-DE").format(value || 0); }
function stateClass(value: number, selected: boolean) {
  const level = value >= 100 ? styles.stateDone : value >= 65 ? styles.stateHigh : value >= 25 ? styles.stateMid : value > 0 ? styles.stateLow : styles.stateEmpty;
  return `${styles.statePath} ${level} ${selected ? styles.stateSelected : ""}`;
}

export default function GermanyCoverageRadar({ onCrmChanged }: Props) {
  const [data, setData] = useState<CoveragePayload | null>(null);
  const [selectedCode, setSelectedCode] = useState("BW");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/leads/coverage", { cache: "no-store" });
    const json = await response.json() as CoveragePayload;
    if (!response.ok) throw new Error(json.error || "Deutschland-Radar konnte nicht geladen werden.");
    setData(json);
    return json;
  }

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : "Coverage konnte nicht geladen werden.")); }, []);

  const selected = useMemo(() => data?.states.find((state) => state.code === selectedCode) || data?.states[0] || null, [data, selectedCode]);

  async function scan(rounds: number) {
    if (!selected || busy) return;
    setBusy("scan"); setError("");
    try {
      let current = data;
      for (let round = 0; round < rounds; round += 1) {
        setMessage(`${selected.name}: Sektor ${round + 1}/${rounds} wird gescannt …`);
        const response = await fetch("/api/leads/coverage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "scan", state: selected.name }),
        });
        const json = await response.json() as { error?: string; complete?: boolean; sector?: string; uniqueFound?: number; coverage?: CoveragePayload };
        if (!response.ok) throw new Error(json.error || "Scan fehlgeschlagen.");
        if (json.coverage) { current = json.coverage; setData(json.coverage); }
        setMessage(json.complete ? `${selected.name}: Discovery-Pass vollständig.` : `${json.sector || selected.name}: ${fmt(json.uniqueFound || 0)} eindeutige Pflegedienste erkannt / aktualisiert.`);
        if (json.complete) break;
      }
      await onCrmChanged?.();
      if (!current) await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Scan fehlgeschlagen."); }
    finally { setBusy(""); }
  }

  async function enrich() {
    if (!selected || busy) return;
    let ids = selected.pendingLeadIds.slice(0, 3);
    if (!ids.length) {
      const refreshed = await load();
      ids = refreshed.states.find((state) => state.code === selected.code)?.pendingLeadIds.slice(0, 3) || [];
    }
    if (!ids.length) { setMessage("In diesem Bundesland ist aktuell keine Enrichment-Queue offen."); return; }
    setBusy("enrich"); setError(""); setMessage(`${ids.length} Leads: Voll-Enrichment läuft …`);
    try {
      const response = await fetch("/api/crm/enrichment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadIds: ids, ai: true }),
      });
      const json = await response.json() as { error?: string; results?: Array<{ ok?: boolean }> };
      if (!response.ok) throw new Error(json.error || "Enrichment fehlgeschlagen.");
      const good = json.results?.filter((item) => item.ok).length || 0;
      setMessage(`${good}/${ids.length} Leads voll enriched · Website, Recruiting, Ads, Kontakte und Sales-Brief aktualisiert.`);
      await load();
      await onCrmChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Enrichment fehlgeschlagen."); }
    finally { setBusy(""); }
  }

  if (!data) return <section className={styles.root}><div className={styles.loading}>Deutschland-Radar wird geladen …</div>{error && <div className={styles.error}>{error}</div>}</section>;

  return <section className={styles.root}>
    <div className={styles.head}>
      <div><span>DEUTSCHLAND · PFLEGE COVERAGE ENGINE</span><h2>Jeder Pflegedienst. Bundesland für Bundesland.</h2><p>Discovery → CRM → Voll-Enrichment → call-ready → kontaktiert. Keine zufälligen Leadlisten mehr, sondern systematische Marktabdeckung.</p></div>
      <div className={styles.globalRing}><strong>{data.global.coveragePercent}%</strong><small>Discovery Grid</small></div>
    </div>

    <div className={styles.globalProgress}><div><span>Deutschland Discovery</span><strong>{fmt(data.global.tasksDone)} / {fmt(data.global.tasksTotal)} Suchsektoren</strong></div><div className={styles.bar}><i style={{ width: `${data.global.coveragePercent}%` }} /></div></div>

    <div className={styles.kpis}>
      <article><span>Im CRM</span><strong>{fmt(data.global.companies)}</strong><small>{data.global.unmapped ? `${fmt(data.global.unmapped)} ältere Leads noch ohne Bundesland` : "sauber territorialisiert"}</small></article>
      <article><span>Enriched</span><strong>{fmt(data.global.enriched)}</strong><small>{pct(data.global.enriched, data.global.companies)}% Datenabdeckung</small></article>
      <article><span>Call-ready</span><strong>{fmt(data.global.callReady)}</strong><small>Telefon + Research fertig</small></article>
      <article><span>Ad-Signal</span><strong>{fmt(data.global.adSignal)}</strong><small>Meta / Google / Tracking erkannt</small></article>
      <article><span>Kontaktiert</span><strong>{fmt(data.global.contacted)}</strong><small>{pct(data.global.contacted, data.global.companies)}% des CRM bearbeitet</small></article>
    </div>

    <div className={styles.workspace}>
      <div className={styles.mapPanel}>
        <div className={styles.mapTitle}><div><span>LIVE COVERAGE MAP</span><strong>Deutschland</strong></div><small>Bundesland anklicken</small></div>
        <svg className={styles.map} viewBox="0 0 560 700" role="img" aria-label="Deutschlandkarte mit Fortschritt je Bundesland">
          {SHAPES.map((shape) => {
            const state = data.states.find((item) => item.code === shape.code);
            const progress = state?.coveragePercent || 0;
            return <g key={shape.code} className={styles.stateGroup} onClick={() => setSelectedCode(shape.code)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedCode(shape.code); }}>
              <path className={stateClass(progress, selectedCode === shape.code)} d={shape.d} />
              <text x={shape.x} y={shape.y} textAnchor="middle" className={styles.stateLabel}>{shape.code}</text>
              <text x={shape.x} y={shape.y + 16} textAnchor="middle" className={styles.statePct}>{progress}%</text>
            </g>;
          })}
        </svg>
        <div className={styles.legend}><span><i className={styles.dotEmpty} />offen</span><span><i className={styles.dotLow} />gestartet</span><span><i className={styles.dotMid} />läuft</span><span><i className={styles.dotDone} />Discovery komplett</span></div>
      </div>

      {selected && <div className={styles.detail}>
        <div className={styles.detailHead}><div><span>{selected.code} · BUNDESLAND</span><h3>{selected.name}</h3><p>{selected.sectors} Suchsektoren · {selected.pagesScanned} Google-Places-Seiten geprüft</p></div><strong>{selected.coveragePercent}%</strong></div>

        <div className={styles.stageList}>
          <div className={styles.stage}><div><span>01 · DISCOVERY</span><strong>{selected.tasksDone}/{selected.tasksTotal} Suchaufträge</strong></div><div className={styles.bar}><i style={{ width: `${selected.coveragePercent}%` }} /></div><small>{fmt(selected.rawHits)} Roh-Treffer bisher</small></div>
          <div className={styles.stage}><div><span>02 · CRM</span><strong>{fmt(selected.companies)} Unternehmen</strong></div><div className={styles.bar}><i style={{ width: `${selected.coveragePercent ? 100 : 0}%` }} /></div><small>Google Place ID dedupliziert · territoriale Zuordnung gespeichert</small></div>
          <div className={styles.stage}><div><span>03 · ENRICHMENT</span><strong>{fmt(selected.enriched)} / {fmt(selected.companies)}</strong></div><div className={styles.bar}><i style={{ width: `${pct(selected.enriched, selected.companies)}%` }} /></div><small>Website, Kontakte, Karriere, Social, Meta/Google Ads & Tracking</small></div>
          <div className={styles.stage}><div><span>04 · CALL-READY</span><strong>{fmt(selected.callReady)}</strong></div><div className={styles.bar}><i style={{ width: `${pct(selected.callReady, selected.companies)}%` }} /></div><small>voll recherchiert + Telefonnummer + Sales-Priorisierung</small></div>
          <div className={styles.stage}><div><span>05 · KONTAKTIERT</span><strong>{fmt(selected.contacted)} / {fmt(selected.companies)}</strong></div><div className={styles.bar}><i style={{ width: `${pct(selected.contacted, selected.companies)}%` }} /></div><small>Call / Gespräch / Pipeline-Status im CRM dokumentiert</small></div>
        </div>

        <div className={styles.adBox}><span>WERBE-INTELLIGENCE</span><strong>{fmt(selected.adSignal)} Leads mit Werbe-Signal</strong><p>Meta Pixel, Google Ads Tag und öffentliche Transparency-Checks fließen in den Intent- und Opportunity-Score ein.</p></div>

        <div className={styles.actions}>
          <button className={styles.primary} onClick={() => void scan(1)} disabled={Boolean(busy) || selected.coveragePercent >= 100}>{busy === "scan" ? "Scan läuft …" : "Nächsten Sektor scannen"}</button>
          <button onClick={() => void scan(5)} disabled={Boolean(busy) || selected.coveragePercent >= 100}>5 Sektoren durchziehen</button>
          <button onClick={() => void enrich()} disabled={Boolean(busy) || !selected.pendingLeadIds.length}>{busy === "enrich" ? "Enrichment läuft …" : `3 Leads voll enrichen (${selected.pendingLeadIds.length} offen)`}</button>
        </div>
        {message && <div className={styles.message}>{message}</div>}
        {error && <div className={styles.error}>{error}</div>}
      </div>}
    </div>

    <div className={styles.stateTable}>
      <div className={styles.tableHead}><span>Bundesland</span><span>Discovery</span><span>CRM</span><span>Enriched</span><span>Call-ready</span><span>Kontaktiert</span></div>
      {data.states.map((state) => <button key={state.code} className={selectedCode === state.code ? styles.rowActive : ""} onClick={() => setSelectedCode(state.code)}>
        <span><b>{state.code}</b>{state.name}</span><span>{state.coveragePercent}%</span><span>{fmt(state.companies)}</span><span>{fmt(state.enriched)}</span><span>{fmt(state.callReady)}</span><span>{fmt(state.contacted)}</span>
      </button>)}
    </div>
  </section>;
}
