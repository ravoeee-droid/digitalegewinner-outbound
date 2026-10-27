"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./CRMWorkspace.module.css";
import LeadVideoAction from "./LeadVideoAction";

type Contact = { id: string; company_id: string; name: string; role: string; phone: string; email: string; is_primary: boolean; source: string };
type ContactDraft = { contactId?: string; name: string; role: string; phone: string; email: string; isPrimary: boolean };

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
  segment: Segment;
  company_phone: string;
  do_not_contact: boolean;
  contacts: Contact[];
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
type Segment = "pflege" | "pv" | "other";
type Quick = "all" | "due" | "meetings" | "hot" | "noaction";
const SEGMENTS: Array<{ key: Segment; label: string }> = [
  { key: "pflege", label: "Pflege-Recruiting" },
  { key: "pv", label: "PV-Trust" },
  { key: "other", label: "Weitere" },
];
type Patch = Partial<{ stage: string; setupValue: number; monthlyValue: number; probability: number; nextAction: string; nextActionAt: string | null; notes: string; outcome: string }>;

const FOCUS = ["Info angefragt", "Info versendet", "Interesse", "Termin", "Angebot", "Verhandlung", "Gewonnen"];
const OUTCOMES = ["Nicht erreicht", "Erreicht", "Info angefragt", "Interesse", "Termin", "Angebot", "Gewonnen", "Verloren"];

// Nur ein Entwurf: Das Öffnen des E-Mail-Clients darf niemals als Versand gezählt werden.
function infoMailDraft(o: Opp, address = o.email) {
  const pv = o.segment === "pv";
  const subject = pv ? "Wie Ihr Solarbetrieb eigene PV-Anfragen gewinnt" : "Informationen zu unserem Recruiting-System für Pflegebetriebe";
  const body = pv
    ? `Guten Tag,

vielen Dank für unser Gespräch. Wie versprochen finden Sie hier einen kurzen Überblick über PV-Trust.

Statt immer wieder Leads von Drittanbietern einzukaufen, bauen wir für Ihren Solarbetrieb ein eigenes System auf, über das regionale Interessenten direkt bei Ihnen anfragen. So profitieren langfristig Ihre eigene Marke, Ihr Vertrauen vor Ort und Ihre Unabhängigkeit.

Gern zeige ich Ihnen in einem kurzen Gespräch, wie das konkret für Ihren Betrieb aussehen könnte.

Viele Grüße
Digitale Gewinner`
    : `Guten Tag,

vielen Dank für unser Gespräch. Wie versprochen erhalten Sie einen kurzen Überblick über unser Recruiting-System für Pflegebetriebe.

Wir bauen eine langfristig nutzbare Karriere- und Bewerberstrecke für Ihren Betrieb auf. Anders als bei einer einzelnen Stellenanzeigen-Kampagne bleibt die Infrastruktur erhalten und kann bei zukünftigem Personalbedarf weiter genutzt und ausgebaut werden.

Gern zeige ich Ihnen in einem kurzen Gespräch, wie das konkret für Ihren Betrieb aussehen könnte.

Viele Grüße
Digitale Gewinner`;
  return `mailto:${encodeURIComponent(address)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
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

export default function CRMWorkspace({ embedded = false, initialSegment = "pflege" }: { embedded?: boolean; initialSegment?: Segment }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState("all");
  const [segment, setSegment] = useState<Segment>(initialSegment);
  const [quick, setQuick] = useState<Quick>("all");
  const [allStages, setAllStages] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contactDraft, setContactDraft] = useState<ContactDraft | null>(null);
  const [contactBusy, setContactBusy] = useState(false);
  const [contactError, setContactError] = useState("");
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
    setContactDraft(null);
    setContactError("");
  }, [selectedId]);

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
  const segmentRows = useMemo(() => all.filter((o) => o.segment === segment), [all, segment]);
  const open = useMemo(() => segmentRows.filter((o) => o.status === "open" || o.stage === "Gewonnen" || o.status === "won"), [segmentRows]);
  const active = useMemo(() => open.filter((o) => o.status === "open" && o.stage !== "Gewonnen" && o.stage !== "Verloren"), [open]);
  const won = useMemo(() => segmentRows.filter((o) => o.status === "won" || o.stage === "Gewonnen"), [segmentRows]);
  const segmentTotals = useMemo(() => Object.fromEntries(SEGMENTS.map(({ key }) => [
    key, all.filter((o) => o.segment === key && o.status === "open" && o.stage !== "Gewonnen" && o.stage !== "Verloren").length
  ])) as Record<Segment, number>, [all]);

  function chooseSegment(next: Segment) {
    if (next === segment) return;
    setSegment(next);
    setProduct("all");
    setQuick("all");
    setSelectedId(null);
    // Deep-Link für Pflege/PV, ohne beim Umschalten die komplette App neu zu laden.
    const url = new URL(window.location.href);
    url.searchParams.set("segment", next);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
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

  // Fokus-Stufen immer zeigen, dazu jede Stufe, in der tatsächlich Chancen liegen – sonst wirkt das Board leer.
  const stages = useMemo(() => {
    const names = snap?.stages || [];
    if (allStages) return names;
    const used = new Set(filtered.map((o) => o.stage));
    return names.filter((s) => FOCUS.includes(s) || used.has(s));
  }, [snap, allStages, filtered]);

  const byStage = useMemo(() => {
    const map = new Map<string, Opp[]>();
    for (const s of stages) map.set(s, []);
    for (const o of filtered) map.get(o.stage)?.push(o);
    for (const list of map.values()) list.sort((a, b) => Number(isDue(b)) - Number(isDue(a)) || (a.next_action_at && b.next_action_at ? new Date(a.next_action_at).getTime() - new Date(b.next_action_at).getTime() : 0) || b.call_score - a.call_score);
    return map;
  }, [filtered, stages]);

  const selected = useMemo(() => all.find((o) => o.id === selectedId) || null, [all, selectedId]);
  const selectedEmail = selected?.contacts.find((contact) => contact.is_primary && contact.email)?.email ||
    selected?.contacts.find((contact) => contact.email)?.email || selected?.email || "";

  function editContact(contact?: Contact) {
    if (!selected) return;
    setContactError("");
    setContactDraft(contact ? {
      contactId: contact.id, name: contact.name, role: contact.role, phone: contact.phone,
      email: contact.email, isPrimary: contact.is_primary,
    } : { name: "", role: "", phone: "", email: "", isPrimary: !selected.contacts.some((c) => c.is_primary) });
  }

  async function persistContact() {
    if (!selected || !contactDraft || contactBusy) return;
    if (!contactDraft.name.trim() && !contactDraft.phone.trim() && !contactDraft.email.trim()) {
      setContactError("Bitte mindestens Namen, Telefonnummer oder E-Mail eintragen.");
      return;
    }
    setContactBusy(true);
    setContactError("");
    try {
      const response = await fetch("/api/revenue-opportunities/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ opportunityId: selected.id, ...contactDraft }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Ansprechpartner konnte nicht gespeichert werden.");
      await load();
      setContactDraft(null);
      setToast("Ansprechpartner gespeichert");
    } catch (error) {
      setContactError(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setContactBusy(false);
    }
  }

  const dueList = useMemo(() => filtered.filter(isDue).sort((a, b) => new Date(a.next_action_at as string).getTime() - new Date(b.next_action_at as string).getTime()), [filtered]);
  const meetings = active.filter((o) => o.stage === "Termin").length;
  const overdue = active.filter(isDue).length;

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
        {!embedded && <div><span className={styles.eyebrow}>CRM / GESCHÄFTSBEREICH</span><h1>{segment === "pflege" ? "Pflege-Pipeline" : segment === "pv" ? "PV-Trust-Pipeline" : "Weitere Chancen"}</h1></div>}
        <div className={styles.kpis}>
          <div><span>Offene Chancen</span><strong>{snap ? active.length : "–"}</strong></div>
          <div className={overdue ? styles.warn : undefined}><span>Jetzt fällig</span><strong>{overdue}</strong></div>
          <div><span>Termine</span><strong>{meetings}</strong></div>
          <div><span>Gewichtete Pipeline</span><strong>{euro(active.reduce((sum, o) => sum + o.weighted_value, 0))}</strong></div>
          <div><span>Gewonnen</span><strong>{euro(won.reduce((sum, o) => sum + o.annual_value, 0))}</strong></div>
        </div>
      </header>

      <nav className={styles.segmentBar} aria-label="CRM-Geschäftsbereich">
        {SEGMENTS.map(({ key, label }) => (
          <button key={key} type="button" className={`${styles.segmentButton} ${segment === key ? styles.segmentActive : ""}`}
            aria-current={segment === key ? "page" : undefined} onClick={() => chooseSegment(key)}>
            {label} <span className={styles.segmentCount}>{segmentTotals[key]}</span>
          </button>
        ))}
      </nav>

      {segment === "pv" && <div style={{ marginBottom: 14 }}><a href="/outbound/whatsapp" style={{ display: "inline-flex", padding: "9px 15px", border: "1px solid rgba(94,234,160,.45)", borderRadius: 10, textDecoration: "none", color: "#5eeaa0", fontWeight: 800, fontSize: 13 }}>📱 WhatsApp 30er-Sprint · tägliche PV-Kontaktliste</a></div>}

      <div className={styles.bar}>
        <input ref={search} className={styles.search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Suchen: Firma, Ort, Telefon …  ( / )" aria-label="Suchen" />
        <select value={product} onChange={(e) => setProduct(e.target.value)} aria-label="Produkt">
          <option value="all">Alle Produkte im Bereich</option>
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
          {selected.do_not_contact && <p className={styles.blocked}>Kontakt gesperrt – nicht anrufen oder anschreiben.</p>}
          <div className={styles.quickRow}>
            {!selected.do_not_contact && (selected.company_phone || selected.phone) && <a href={`tel:${selected.company_phone || selected.phone}`}>☎ Firmenzentrale</a>}
            {!selected.do_not_contact && selectedEmail && <a href={`mailto:${selectedEmail}`}>✉ Mail</a>}
            {selected.website && <a href={selected.website.startsWith("http") ? selected.website : `https://${selected.website}`} target="_blank" rel="noreferrer">Website ↗</a>}
            <a href={`/a/${encodeURIComponent(selected.lead_id)}`} target="_blank" rel="noreferrer">Analyse ↗</a>
          </div>

          {selected.lead_id && (selected.segment === "pv" || selected.segment === "pflege") && <LeadVideoAction key={selected.lead_id} leadId={selected.lead_id} blocked={selected.do_not_contact} />}

          <section className={styles.contactSection} aria-label="Ansprechpartner und Kontaktdaten">
            <div className={styles.contactHead}>
              <strong>Ansprechpartner <span>{selected.contacts.length}</span></strong>
              <button type="button" onClick={() => editContact()}>+ Hinzufügen</button>
            </div>
            {selected.contacts.length === 0 && <p className={styles.contactEmpty}>Noch kein Kontakt hinterlegt. Ansprechpartner und Durchwahl hier ergänzen.</p>}
            {selected.contacts.map((contact) => (
              <div className={styles.contactCard} key={contact.id}>
                <div className={styles.contactTitle}>
                  <div>
                    <strong>{contact.name || "Name noch nicht ermittelt"}</strong>
                    {contact.is_primary && <span className={styles.primaryContact}>Hauptkontakt</span>}
                    <small>{contact.role || "Funktion noch nicht erfasst"}</small>
                  </div>
                  <button type="button" onClick={() => editContact(contact)} aria-label={`Kontakt ${contact.name || "ohne Namen"} bearbeiten`}>Bearbeiten</button>
                </div>
                <div className={styles.contactMethods}>
                  {contact.phone ? (selected.do_not_contact ? <span>☎ {contact.phone}</span> : <a href={`tel:${contact.phone}`}>☎ {contact.phone}</a>) : <span>Keine Durchwahl</span>}
                  {contact.email ? (selected.do_not_contact ? <span>✉ {contact.email}</span> : <a href={`mailto:${contact.email}`}>✉ {contact.email}</a>) : <span>Keine E-Mail</span>}
                </div>
              </div>
            ))}
            {selected.contacts.length === 0 && selected.phone && <p className={styles.contactEmpty}>Bekannte Rufnummer: {selected.phone}</p>}

            {contactDraft && (
              <div className={styles.contactEditor}>
                <strong>{contactDraft.contactId ? "Ansprechpartner bearbeiten" : "Neuen Ansprechpartner erfassen"}</strong>
                <label>Name
                  <input value={contactDraft.name} onChange={(e) => setContactDraft({ ...contactDraft, name: e.target.value })} placeholder="Vor- und Nachname" maxLength={180} />
                </label>
                <label>Funktion / Position
                  <input value={contactDraft.role} onChange={(e) => setContactDraft({ ...contactDraft, role: e.target.value })} placeholder="z. B. Geschäftsführung, PDL" maxLength={160} />
                </label>
                <div className={styles.contactFields}>
                  <label>Direktwahl / Handy
                    <input type="tel" value={contactDraft.phone} onChange={(e) => setContactDraft({ ...contactDraft, phone: e.target.value })} placeholder="+49 ..." maxLength={80} />
                  </label>
                  <label>E-Mail
                    <input type="email" value={contactDraft.email} onChange={(e) => setContactDraft({ ...contactDraft, email: e.target.value })} placeholder="kontakt@firma.de" maxLength={320} />
                  </label>
                </div>
                <label className={styles.primaryCheck}><input type="checkbox" checked={contactDraft.isPrimary} onChange={(e) => setContactDraft({ ...contactDraft, isPrimary: e.target.checked })} /> Als Hauptkontakt verwenden</label>
                {contactError && <p role="alert" className={styles.error}>{contactError}</p>}
                <div className={styles.contactEditorActions}>
                  <button type="button" onClick={() => setContactDraft(null)} disabled={contactBusy}>Abbrechen</button>
                  <button type="button" onClick={() => void persistContact()} disabled={contactBusy}>{contactBusy ? "Speichert …" : "Kontakt speichern"}</button>
                </div>
              </div>
            )}
          </section>
          {summary(selected) && <p className={styles.signal}>{summary(selected)}</p>}
          <label className={styles.field}>Gesprächsnotizen
            <textarea key={`n-${selected.id}`} rows={3} defaultValue={selected.notes} placeholder="Gesprächspartner, Bedarf, Einwände, nächste Schritte …" onBlur={(e) => e.target.value !== selected.notes && void save(selected.id, { notes: e.target.value }, { notes: e.target.value })} />
          </label>

          <label className={styles.field}>Stufe
            <select value={selected.stage} onChange={(e) => void save(selected.id, { stage: e.target.value }, { stage: e.target.value })}>
              {(snap?.stages || []).map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>

          <div className={styles.outcomes} role="group" aria-label="Ergebnis eintragen">
            {OUTCOMES.map((o) => <button key={o} type="button" onClick={() => void save(selected.id, { outcome: o })}>{o}</button>)}
          </div>

          {(selected.stage === "Info angefragt" || selected.stage === "Info versendet") && (
            <div className={styles.infoMailActions}>
              <strong>✉ Info-Mail</strong>
              {selected.stage === "Info angefragt" ? (
                <>
                  {selectedEmail && !selected.do_not_contact ? <a href={infoMailDraft(selected, selectedEmail)}>Info-Mail-Entwurf öffnen</a> : <span className={styles.infoMailHint}>{selected.do_not_contact ? "Kontakt gesperrt – kein Versand." : "Noch keine E-Mail-Adresse hinterlegt – erst Adresse ermitteln."}</span>}
                  <button type="button" onClick={() => void save(selected.id, { outcome: "Info versendet" })}>✓ Versand bestätigen</button>
                  <small>Nur nach tatsächlichem Versand bestätigen. Danach wird automatisch eine Wiedervorlage in 2 Werktagen gesetzt.</small>
                </>
              ) : (
                <small>Versand manuell bestätigt. Die telefonische Wiedervorlage steht bei „Nächste Aktion“.</small>
              )}
            </div>
          )}

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
