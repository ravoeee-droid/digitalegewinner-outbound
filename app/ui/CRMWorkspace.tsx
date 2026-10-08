"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./CRMWorkspace.module.css";

type Opp = {
  id: string;
  lead_id: string;
  product_key: string;
  stage: string;
  status: string;
  setup_value: number;
  monthly_value: number;
  probability: number;
  next_action: string;
  next_action_at: string | null;
  notes: string;
  updated_at: string;
  company: string;
  city: string;
  industry: string;
  website: string;
  phone: string;
  email: string;
  extreme_hot: boolean;
  annual_value: number;
  weighted_value: number;
  call_score: number;
  signal_summary: unknown;
};
type Activity = { id: number; lead_id: string; type: string; summary: string; created_at: string };
type Snapshot = {
  stages: string[];
  catalog: Record<string, { label: string; shortLabel: string }>;
  stats: { openOpportunities: number; dueActions: number; weightedPotential: number; wonRevenue: number; annualPotential: number };
  opportunities: Opp[];
  activities: Activity[];
};
type Quick = "all" | "due" | "meetings" | "hot" | "noaction";
type Patch = Partial<{ stage: string; setupValue: number; monthlyValue: number; probability: number; nextAction: string; nextActionAt: string | null; notes: string; outcome: string }>;

const FOCUS = ["Interesse", "Termin", "Angebot", "Verhandlung", "Gewonnen"];
const OUTCOMES = ["Nicht erreicht", "Erreicht", "Interesse", "Termin", "Angebot", "Gewonnen", "Verloren"];
const euro = (v: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v || 0);
const when = (iso: string) => new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(new Date(iso));
const isDue = (o: Opp) => Boolean(o.next_action_at) && new Date(o.next_action_at as string).getTime() <= Date.now();
const localInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
function preset(kind: "today" | "tomorrow" | "d3" | "week") {
  const d = new Date();
  if (kind === "today") d.setHours(15, 0, 0, 0);
  if (kind === "tomorrow") { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  if (kind === "d3") { d.setDate(d.getDate() + 3); d.setHours(9, 0, 0, 0); }
  if (kind === "week") { d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); }
  return d.toISOString();
}
function summary(o: Opp) {
  const s = o.signal_summary;
  return Array.isArray(s) ? s.map(String).join(" · ") : typeof s === "string" ? s : "";
}

export default function CRMWorkspace({ embedded = false }: { embedded?: boolean }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState("all");
  const [quick, setQuick] = useState<Quick>("all");
  const [allStages, setAllStages] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/revenue-opportunities", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Pipeline konnte nicht geladen werden.");
      setSnap(j);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pipeline konnte nicht geladen werden.");
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "Escape") setSelectedId(null);
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") { e.preventDefault(); search.current?.focus(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const save = useCallback(async (id: string, patch: Patch, optimistic?: Partial<Opp>) => {
    const before = snap;
    if (optimistic) setSnap((s) => s && { ...s, opportunities: s.opportunities.map((o) => (o.id === id ? { ...o, ...optimistic } : o)) });
    try {
      const r = await fetch("/api/revenue-opportunities", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...patch }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Speichern fehlgeschlagen.");
      setSnap(j);
      setToast("Gespeichert");
    } catch (e) {
      if (before) setSnap(before);
      setToast(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    }
    window.setTimeout(() => setToast(""), 2200);
  }, [snap]);

  const all = useMemo(() => snap?.opportunities || [], [snap]);
  const open = useMemo(() => all.filter((o) => o.status === "open" || o.stage === "Gewonnen"), [all]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return open.filter((o) => {
      if (product !== "all" && o.product_key !== product) return false;
      if (q && !`${o.company} ${o.city} ${o.industry} ${o.email} ${o.phone}`.toLowerCase().includes(q)) return false;
      if (quick === "due") return isDue(o);
      if (quick === "meetings") return o.stage === "Termin";
      if (quick === "hot") return o.extreme_hot || o.call_score >= 80;
      if (quick === "noaction") return o.stage !== "Gewonnen" && !o.next_action_at;
      return true;
    });
  }, [open, query, product, quick]);

  const stages = useMemo(() => {
    const names = snap?.stages || [];
    return allStages ? names : FOCUS.filter((s) => names.includes(s));
  }, [snap, allStages]);

  const byStage = useMemo(() => {
    const map = new Map<string, Opp[]>();
    for (const s of stages) map.set(s, []);
    for (const o of filtered) map.get(o.stage)?.push(o);
    for (const list of map.values()) list.sort((a, b) => Number(isDue(b)) - Number(isDue(a)) || (a.next_action_at && b.next_action_at ? new Date(a.next_action_at).getTime() - new Date(b.next_action_at).getTime() : 0) || b.call_score - a.call_score);
    return map;
  }, [filtered, stages]);

  const selected = useMemo(() => all.find((o) => o.id === selectedId) || null, [all, selectedId]);
  const dueList = useMemo(() => filtered.filter(isDue).sort((a, b) => new Date(a.next_action_at as string).getTime() - new Date(b.next_action_at as string).getTime()), [filtered]);
  const meetings = filtered.filter((o) => o.stage === "Termin").length;
  const overdue = open.filter(isDue).length;

  function onDrop(stage: string, e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/plain");
    const opp = all.find((o) => o.id === id);
    if (opp && opp.stage !== stage) void save(id, { stage }, { stage });
  }

  const products = snap ? Object.entries(snap.catalog) : [];

  return (
    <main className={`${styles.page} ${embedded ? styles.embedded : ""}`}>
      <header className={styles.top}>
        {!embedded && <div><span className={styles.eyebrow}>CRM</span><h1>Pipeline</h1></div>}
        <div className={styles.kpis}>
          <div><span>Offene Chancen</span><strong>{snap?.stats.openOpportunities ?? "–"}</strong></div>
          <div className={overdue ? styles.warn : undefined}><span>Jetzt fällig</span><strong>{overdue}</strong></div>
          <div><span>Termine</span><strong>{meetings}</strong></div>
          <div><span>Gewichtete Pipeline</span><strong>{euro(snap?.stats.weightedPotential || 0)}</strong></div>
          <div><span>Gewonnen</span><strong>{euro(snap?.stats.wonRevenue || 0)}</strong></div>
        </div>
      </header>

      <div className={styles.bar}>
        <input ref={search} className={styles.search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Suchen: Firma, Ort, Telefon …  ( / )" aria-label="Suchen" />
        <select value={product} onChange={(e) => setProduct(e.target.value)} aria-label="Produkt">
          <option value="all">Alle Produkte</option>
          {products.map(([key, p]) => <option key={key} value={key}>{p.shortLabel}</option>)}
        </select>
        <div className={styles.chips} role="group" aria-label="Schnellfilter">
          {([["all", "Alle"], ["due", `Fällig ${overdue || ""}`.trim()], ["meetings", "Termine"], ["hot", "Heiß"], ["noaction", "Ohne nächste Aktion"]] as Array<[Quick, string]>).map(([key, label]) => (
            <button key={key} type="button" className={quick === key ? styles.on : undefined} aria-pressed={quick === key} onClick={() => setQuick(key)}>{label}</button>
          ))}
        </div>
        <label className={styles.toggle}><input type="checkbox" checked={allStages} onChange={(e) => setAllStages(e.target.checked)} /> Alle Stufen</label>
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {!snap && !error && <p className={styles.muted}>Lädt …</p>}

      {quick === "due" ? (
        <section className={styles.list} aria-label="Fällige Aktionen">
          {dueList.length === 0 && <p className={styles.muted}>Nichts fällig. Gut so.</p>}
          {dueList.map((o) => (
            <button key={o.id} type="button" className={styles.row} onClick={() => setSelectedId(o.id)}>
              <strong>{o.company}</strong><span>{o.city}</span><span className={styles.stage}>{o.stage}</span>
              <span className={styles.over}>{o.next_action || "Aktion"} · {when(o.next_action_at as string)}</span>
            </button>
          ))}
        </section>
      ) : (
        <section className={styles.board} aria-label="Kanban">
          {stages.map((stage) => {
            const list = byStage.get(stage) || [];
            const sum = list.reduce((a, o) => a + o.weighted_value, 0);
            return (
              <div key={stage} className={`${styles.col} ${dragOver === stage ? styles.over2 : ""}`} onDragOver={(e) => { e.preventDefault(); setDragOver(stage); }} onDragLeave={() => setDragOver(null)} onDrop={(e) => onDrop(stage, e)}>
                <h2><span>{stage}</span><b>{list.length}</b><em>{euro(sum)}</em></h2>
                <div className={styles.cards}>
                  {list.slice(0, 40).map((o) => (
                    <article key={o.id} className={`${styles.card} ${isDue(o) ? styles.due : ""}`} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", o.id)}>
                      <button type="button" className={styles.open} onClick={() => setSelectedId(o.id)}>
                        <strong>{o.company}</strong>
                        <small>{[o.city, snap?.catalog[o.product_key]?.shortLabel].filter(Boolean).join(" · ")}</small>
                      </button>
                      <div className={styles.meta}>
                        <span>{euro(o.annual_value)}</span>
                        <span className={styles.prob}><i style={{ width: `${o.probability}%` }} /></span>
                        {o.extreme_hot && <span title="Extrem heiß">🔥</span>}
                      </div>
                      {o.next_action_at && <p className={isDue(o) ? styles.over : styles.next}>{o.next_action || "Aktion"} · {when(o.next_action_at)}</p>}
                    </article>
                  ))}
                  {list.length > 40 && <p className={styles.muted}>+ {list.length - 40} weitere (Suche nutzen)</p>}
                  {list.length === 0 && <p className={styles.empty}>Leer</p>}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {selected && (
        <aside className={styles.drawer} aria-label={`Details ${selected.company}`}>
          <div className={styles.drawerHead}>
            <div><strong>{selected.company}</strong><small>{[selected.city, selected.industry].filter(Boolean).join(" · ")}</small></div>
            <button type="button" onClick={() => setSelectedId(null)} aria-label="Schließen">✕</button>
          </div>
          <div className={styles.quickRow}>
            {selected.phone && <a href={`tel:${selected.phone}`}>☎ Anrufen</a>}
            {selected.email && <a href={`mailto:${selected.email}`}>✉ Mail</a>}
            {selected.website && <a href={selected.website.startsWith("http") ? selected.website : `https://${selected.website}`} target="_blank" rel="noreferrer">Website ↗</a>}
            <a href={`/a/${encodeURIComponent(selected.lead_id)}`} target="_blank" rel="noreferrer">Analyse ↗</a>
          </div>
          {summary(selected) && <p className={styles.signal}>{summary(selected)}</p>}

          <label className={styles.field}>Stufe
            <select value={selected.stage} onChange={(e) => void save(selected.id, { stage: e.target.value }, { stage: e.target.value })}>
              {(snap?.stages || []).map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>

          <div className={styles.outcomes} role="group" aria-label="Ergebnis eintragen">
            {OUTCOMES.map((o) => <button key={o} type="button" onClick={() => void save(selected.id, { outcome: o })}>{o}</button>)}
          </div>

          <label className={styles.field}>Nächste Aktion
            <input key={`a-${selected.id}-${selected.next_action}`} defaultValue={selected.next_action} onBlur={(e) => e.target.value !== selected.next_action && void save(selected.id, { nextAction: e.target.value }, { next_action: e.target.value })} />
          </label>
          <label className={styles.field}>Fällig am
            <input key={`d-${selected.id}-${selected.next_action_at}`} type="datetime-local" defaultValue={localInput(selected.next_action_at)} onChange={(e) => { const iso = e.target.value ? new Date(e.target.value).toISOString() : null; void save(selected.id, { nextActionAt: iso }, { next_action_at: iso }); }} />
          </label>
          <div className={styles.presets}>
            {([["today", "Heute 15 Uhr"], ["tomorrow", "Morgen 9 Uhr"], ["d3", "In 3 Tagen"], ["week", "Nächste Woche"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => { const iso = preset(k); void save(selected.id, { nextActionAt: iso }, { next_action_at: iso }); }}>{label}</button>
            ))}
            {selected.next_action_at && <button type="button" onClick={() => void save(selected.id, { nextActionAt: null }, { next_action_at: null })}>Löschen</button>}
          </div>

          <div className={styles.two}>
            <label className={styles.field}>Einmalig (€)
              <input key={`s-${selected.id}-${selected.setup_value}`} type="number" min={0} defaultValue={selected.setup_value} onBlur={(e) => Number(e.target.value) !== selected.setup_value && void save(selected.id, { setupValue: Number(e.target.value) })} />
            </label>
            <label className={styles.field}>Monatlich (€)
              <input key={`m-${selected.id}-${selected.monthly_value}`} type="number" min={0} defaultValue={selected.monthly_value} onBlur={(e) => Number(e.target.value) !== selected.monthly_value && void save(selected.id, { monthlyValue: Number(e.target.value) })} />
            </label>
          </div>
          <label className={styles.field}>Wahrscheinlichkeit: {selected.probability} %
            <input type="range" min={0} max={100} step={5} value={selected.probability} onChange={(e) => setSnap((s) => s && { ...s, opportunities: s.opportunities.map((o) => (o.id === selected.id ? { ...o, probability: Number(e.target.value) } : o)) })} onMouseUp={(e) => void save(selected.id, { probability: Number((e.target as HTMLInputElement).value) })} onTouchEnd={(e) => void save(selected.id, { probability: Number((e.target as HTMLInputElement).value) })} onKeyUp={(e) => void save(selected.id, { probability: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label className={styles.field}>Notizen
            <textarea key={`n-${selected.id}`} rows={5} defaultValue={selected.notes} onBlur={(e) => e.target.value !== selected.notes && void save(selected.id, { notes: e.target.value }, { notes: e.target.value })} />
          </label>

          <h3 className={styles.h3}>Verlauf</h3>
          <ol className={styles.timeline}>
            {(snap?.activities || []).filter((a) => a.lead_id === selected.lead_id).slice(0, 12).map((a) => (
              <li key={a.id}><b>{a.summary}</b><time>{when(a.created_at)}</time></li>
            ))}
            {!(snap?.activities || []).some((a) => a.lead_id === selected.lead_id) && <li className={styles.muted}>Noch keine Aktivität in den letzten Einträgen.</li>}
          </ol>
        </aside>
      )}
      {toast && <div className={styles.toast} role="status">{toast}</div>}
    </main>
  );
}
