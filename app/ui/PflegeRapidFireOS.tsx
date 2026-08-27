"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./pflege-rapidfire-os.module.css";

type Stage = "Neu" | "Research" | "Bereit" | "Kontaktiert" | "Engaged" | "Qualifiziert" | "Termin" | "Angebot" | "Verhandlung" | "Gewonnen" | "Verloren" | "Wiedervorlage";
type Outcome = "Nicht erreicht" | "Erreicht" | "Interesse" | "Termin" | "Rückruf" | "Angebot senden" | "Kein Interesse";
type View = "fire" | "factory" | "all";

type Enrichment = {
  quality?: number;
  enrichedAt?: string;
  phone?: string;
  email?: string;
  careersPage?: string;
  jobsPage?: string;
  atsProviders?: string[];
  linkedin?: string;
  instagram?: string;
  facebook?: string;
  signals?: string[];
  brief?: { summary?: string; callOpening?: string; emailHook?: string; personalizationPoints?: string[]; likelyDecisionMaker?: string };
};

type Lead = {
  id: string; company: string; contact: string; city: string; industry: string; website: string; email: string; phone: string;
  stage: Stage; deal_value: number; notes: string; priority_score: number; fit_score: number; opportunity_score: number; intent_score: number;
  website_score: number; metadata: Record<string, unknown>; last_call_at: string | null; last_outcome: string; next_action: string;
  next_action_at: string | null; do_not_contact: boolean; probability: number; expected_close_date: string | null; last_contact_at: string | null;
  phone_status: string; updated_at: string;
};

type Call = { id: number; lead_ref: string; status: string; duration_seconds: number; started_at: string | null };
type Payload = {
  stats: { companies: number; leads: number; hot: number; appointments: number; won: number; pipeline: number; weighted_pipeline: number; due_actions: number };
  calls: { today: number; connected: number; meetings: number; interested: number; talk_seconds: number; history: Call[] };
  leads: Lead[];
};
type FoundLead = { id: string; company: string; contact: string; email: string; phone: string; website: string; city: string; industry: string; lat?: number; lng?: number };
type FactoryState = { running: boolean; current: number; total: number; message: string };

type Grade = "A+" | "A" | "B";

const EMPTY: Payload = { stats: { companies: 0, leads: 0, hot: 0, appointments: 0, won: 0, pipeline: 0, weighted_pipeline: 0, due_actions: 0 }, calls: { today: 0, connected: 0, meetings: 0, interested: 0, talk_seconds: 0, history: [] }, leads: [] };
const OUTCOMES: Outcome[] = ["Nicht erreicht", "Erreicht", "Interesse", "Termin", "Angebot senden", "Kein Interesse"];
const CHAIN_RE = /\b(awo|caritas|diakonie|drk|johanniter|malteser|korian|all[oö]heim|compassio|advita|vitolus|renafan|air liquide|linimed|vitanas)\b/i;
const BAD_TYPE_RE = /\b(krankenhaus|klinik|pflegeheim|seniorenheim|hospiz|apotheke|sanit[aä]tshaus|arztpraxis)\b/i;
const GOOD_TYPE_RE = /\b(pflegedienst|ambulant|häuslich|haeuslich|intensivpflege|sozialstation|pflege zuhause|pflege zu hause|mobile pflege)\b/i;

const OBJECTIONS: Record<string, string> = {
  "Kein Interesse": "Verstehe ich. Heißt das konkret: Sie bekommen genug passende Fachkräfte, gute Bewerber springen nicht ab und Sie müssen offenen Stellen nicht ständig selbst hinterherlaufen?",
  "Keine Zeit": "Genau das ist der Punkt. Wenn alles bei der PDL landet, ist Zeit das Problem. Geben Sie mir 30 Sekunden – wenn es nicht trifft, bin ich sofort wieder raus.",
  "Haben Agentur": "Perfekt. Dann nur eine Frage: Liefert die Agentur planbar passende Bewerber und wird wirklich jeder Kontakt sauber nachverfolgt – oder bleiben trotzdem Lücken?",
  "Schicken Sie Mail": "Gern. Damit es keine Standard-Mail wird: Was nervt Sie aktuell mehr – zu wenig Bewerber, unpassende Bewerber oder dass gute Kandidaten im Prozess verloren gehen?",
  "Läuft gut": "Stark. Wenn morgen zwei gute Fachkräfte kündigen: hätten Sie innerhalb von 30 Tagen planbar Ersatz – ohne Jobbörsen-Hoffnung und ohne dass Sie selbst alles nachtelefonieren?",
  "Zu teuer": "Verstanden. Was kostet Sie eine unbesetzte Fachkraft pro Monat – inklusive abgelehnter Touren, Überstunden und Leiharbeit? Genau dagegen muss sich das System rechnen.",
};

function enrichmentOf(lead: Lead): Enrichment { const v = lead.metadata?.enrichment; return v && typeof v === "object" && !Array.isArray(v) ? v as Enrichment : {}; }
function phoneOf(lead: Lead) { return lead.phone || enrichmentOf(lead).phone || ""; }
function emailOf(lead: Lead) { return lead.email || enrichmentOf(lead).email || ""; }
function cleanPhone(v: string) { return v.replace(/[^\d+]/g, ""); }
function due(lead: Lead) { return Boolean(lead.next_action_at && new Date(lead.next_action_at).getTime() <= Date.now()); }
function euro(v: number) { return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(v || 0)); }
function clamp(v: number) { return Math.max(0, Math.min(100, Math.round(v))); }
function contactName(lead: Lead) { return lead.contact.trim() || enrichmentOf(lead).brief?.likelyDecisionMaker || "Herr/Frau [Name]"; }
function isChainName(name: string) { return CHAIN_RE.test(name); }
function validCall(lead: Lead) {
  return Boolean(phoneOf(lead)) && !lead.do_not_contact && lead.phone_status !== "invalid" && !["Termin", "Angebot", "Verhandlung", "Gewonnen", "Verloren"].includes(lead.stage);
}
function rapidScore(lead: Lead) {
  const e = enrichmentOf(lead);
  let s = lead.priority_score * .28 + lead.fit_score * .22 + lead.opportunity_score * .22 + lead.intent_score * .08;
  if (phoneOf(lead)) s += 8;
  if (lead.contact || e.brief?.likelyDecisionMaker) s += 5;
  if (emailOf(lead)) s += 2;
  if (!lead.website) s += 9;
  else if (lead.website_score > 0 && lead.website_score < 45) s += 10;
  else if (lead.website_score > 0 && lead.website_score < 65) s += 6;
  if (!e.careersPage && !e.jobsPage) s += 8;
  if (!e.atsProviders?.length) s += 5;
  if (!(e.linkedin || e.instagram || e.facebook)) s += 4;
  if ((e.quality || 0) >= 70) s += 4;
  if (!lead.last_contact_at) s += 5;
  if (due(lead)) s += 13;
  if (["Engaged", "Qualifiziert", "Wiedervorlage"].includes(lead.stage)) s += 13;
  if (isChainName(lead.company)) s -= 24;
  return clamp(s);
}
function grade(lead: Lead): Grade { const s = rapidScore(lead); return s >= 82 ? "A+" : s >= 72 ? "A" : "B"; }
function painSignals(lead: Lead) {
  const e = enrichmentOf(lead); const p: string[] = [];
  if (!lead.website) p.push("Keine eigene Website erkannt");
  else if (lead.website_score > 0 && lead.website_score < 45) p.push("Website bremst Bewerber sichtbar");
  else if (lead.website_score > 0 && lead.website_score < 65) p.push("Website hat deutliche Conversion-Lücken");
  if (!e.careersPage && !e.jobsPage) p.push("Keine klare Karriere-Strecke erkannt");
  if (!e.atsProviders?.length) p.push("Kein sauberer Bewerberprozess erkannt");
  if (!(e.linkedin || e.instagram || e.facebook)) p.push("Employer Branding kaum sichtbar");
  if (lead.opportunity_score >= 75) p.push("Hoher Recruiting-Hebel");
  for (const signal of e.signals || []) if (signal && !p.includes(signal)) p.push(signal);
  return p.slice(0, 4);
}
function primaryPain(lead: Lead) { return enrichmentOf(lead).brief?.summary || painSignals(lead)[0] || "im digitalen Bewerberprozess noch deutlicher Hebel sichtbar ist"; }
function pitchFor(lead: Lead) {
  const specific = primaryPain(lead);
  return `Hallo ${contactName(lead)}, Raphael Hermann von Digitale Gewinner hier – ich mach’s ganz kurz. Ich spreche täglich mit PDLs wie Ihnen und höre immer wieder dieselben Dinge: zu wenig passende Bewerber, gute Leute springen im Prozess ab und am Ende bleibt zu viel an der PDL selbst hängen. Ich habe mir ${lead.company} kurz angesehen und dabei ist mir aufgefallen, dass ${specific.charAt(0).toLowerCase()}${specific.slice(1)}. Aber bei Ihnen ist es wahrscheinlich komplett anders: alles läuft perfekt und Sie können nächstes Jahr entspannt in Rente gehen, weil Sie keines dieser Probleme kennen – oder?`;
}
function emailHref(lead: Lead) {
  const e = enrichmentOf(lead); const subject = encodeURIComponent(`Kurze Idee für ${lead.company}`);
  const hook = e.brief?.emailHook || `ich habe mir ${lead.company} kurz angesehen und einen konkreten Hebel bei Mitarbeitergewinnung und Bewerberprozess entdeckt.`;
  const body = encodeURIComponent(`Hallo ${contactName(lead)},\n\n${hook}\n\nIch zeige Ihnen gern in 15 Minuten, wie wir Website, Bewerbergewinnung, Nachfassen und Übersicht in einem System zusammenbringen.\n\nViele Grüße\nRaphael Hermann`);
  return `mailto:${emailOf(lead)}?subject=${subject}&body=${body}`;
}
function candidateScore(lead: FoundLead) {
  const text = `${lead.company} ${lead.industry}`;
  let s = 15;
  if (lead.phone) s += 38;
  if (GOOD_TYPE_RE.test(text)) s += 28;
  if (lead.website) s += 8; else s += 12;
  if (isChainName(lead.company)) s -= 38;
  if (BAD_TYPE_RE.test(text)) s -= 45;
  return clamp(s);
}
function candidateGood(lead: FoundLead) { const t = `${lead.company} ${lead.industry}`; return Boolean(lead.phone) && !BAD_TYPE_RE.test(t) && (GOOD_TYPE_RE.test(t) || /pflege/i.test(t)); }

export default function PflegeRapidFireOS() {
  const [data, setData] = useState<Payload>(EMPTY);
  const [view, setView] = useState<View>("fire");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [objection, setObjection] = useState("");
  const [rapid, setRapid] = useState(true);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [region, setRegion] = useState("Baden-Württemberg");
  const [candidates, setCandidates] = useState<FoundLead[]>([]);
  const [factory, setFactory] = useState<FactoryState>({ running: false, current: 0, total: 0, message: "" });

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 2600); }
  async function loadCrm() {
    const r = await fetch("/api/crm/launch", { cache: "no-store" }); const j = await r.json() as Payload & { error?: string };
    if (!r.ok) throw new Error(j.error || "CRM konnte nicht geladen werden."); setData(j); return j;
  }
  async function refresh() { setBusy("refresh"); setError(""); try { await loadCrm(); } catch (e) { setError(e instanceof Error ? e.message : "CRM-Fehler"); } finally { setBusy(""); } }
  useEffect(() => { void refresh(); }, []);

  const allCallReady = useMemo(() => data.leads.filter(validCall).sort((a, b) => rapidScore(b) - rapidScore(a)), [data.leads]);
  const queue = useMemo(() => allCallReady.filter((l) => rapidScore(l) >= 68), [allCallReady]);
  const selected = useMemo(() => data.leads.find((l) => l.id === selectedId) || queue[0] || allCallReady[0] || null, [data.leads, selectedId, queue, allCallReady]);
  const aPlus = useMemo(() => queue.filter((l) => grade(l) === "A+").length, [queue]);
  const aLeads = useMemo(() => queue.filter((l) => grade(l) === "A").length, [queue]);
  const connectRate = data.calls.today ? Math.round(data.calls.connected / data.calls.today * 100) : 0;
  const meetingRate = data.calls.connected ? Math.round(data.calls.meetings / data.calls.connected * 100) : 0;

  function rankedFrom(payload: Payload, excludeId?: string) { return payload.leads.filter((l) => validCall(l) && l.id !== excludeId && rapidScore(l) >= 68).sort((a,b) => rapidScore(b)-rapidScore(a)); }
  async function patchLead(leadId: string, patch: Record<string, unknown>) {
    const r = await fetch("/api/crm/launch", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId, ...patch }) });
    const j = await r.json() as Payload & { error?: string }; if (!r.ok) throw new Error(j.error || "Speichern fehlgeschlagen."); setData(j); return j;
  }
  function dial(lead: Lead) {
    const phone = cleanPhone(phoneOf(lead)); if (!phone) return notify("Telefonnummer fehlt."); setSelectedId(lead.id);
    window.dispatchEvent(new CustomEvent("cloudtalk:dial", { detail: { leadId: lead.id, company: lead.company, phone } }));
    const a = document.createElement("a"); a.href = `ct+tel:${phone}`; a.style.display = "none"; document.body.appendChild(a); a.click(); a.remove();
  }
  function skip() {
    if (!selected) return; const next = queue.find((l) => l.id !== selected.id); setSelectedId(next?.id || null); setNote(""); setObjection("");
  }
  async function recordOutcome(outcome: Outcome) {
    if (!selected || busy === "outcome") return; if (outcome === "Rückruf" && !callbackAt) return notify("Rückrufzeit setzen."); setBusy("outcome");
    try {
      const payload = await patchLead(selected.id, { outcome, notesAppend: note.trim(), callbackAt: callbackAt || "" });
      const next = rankedFrom(payload, selected.id)[0] || null; setNote(""); setCallbackAt(""); setObjection(""); setSelectedId(next?.id || null);
      notify(`${outcome} · nächster Lead`);
      if (rapid && next && outcome !== "Rückruf") window.setTimeout(() => dial(next), 650);
    } catch (e) { notify(e instanceof Error ? e.message : "Ergebnis nicht gespeichert."); } finally { setBusy(""); }
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null; if (el && ["INPUT","TEXTAREA","SELECT"].includes(el.tagName)) return;
      if (event.code === "Space") { event.preventDefault(); if (selected) dial(selected); return; }
      if (event.key.toLowerCase() === "s") { event.preventDefault(); skip(); return; }
      const map: Record<string, Outcome> = { "1": "Nicht erreicht", "2": "Erreicht", "3": "Interesse", "4": "Termin", "5": "Angebot senden", "6": "Kein Interesse" };
      if (map[event.key]) { event.preventDefault(); void recordOutcome(map[event.key]); }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [selected, queue, note, callbackAt, rapid, busy]);

  async function searchQuery(query: string, pageSize = 10) {
    const r = await fetch("/api/leads/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, pageSize }) });
    const j = await r.json() as { leads?: FoundLead[]; error?: string }; if (!r.ok) throw new Error(j.error || "Lead-Suche fehlgeschlagen."); return j.leads || [];
  }
  async function importResearch(candidate: FoundLead) {
    const r = await fetch("/api/radar/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...candidate, source: "rapidfire-v3", workspace: "default" }) });
    const j = await r.json() as { leadId?: string; error?: string }; if (!r.ok) throw new Error(j.error || "Import fehlgeschlagen.");
    if (j.leadId) await fetch("/api/crm/enrichment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadIds: [j.leadId], ai: true }) });
  }
  async function buildFactory(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault(); if (factory.running) return; setError(""); setFactory({ running: true, current: 0, total: 12, message: "Suche nur call-ready Pflegedienste …" });
    try {
      const queries = [
        `ambulanter Pflegedienst ${region}`, `Pflegedienst ${region}`, `häusliche Pflege ${region}`, `Sozialstation ${region}`,
        `Intensivpflegedienst ${region}`, `private ambulante Pflege ${region}`,
      ];
      const batches = await Promise.all(queries.map((q) => searchQuery(q, 10)));
      const existing = new Set(data.leads.map((l) => `${l.company}`.trim().toLowerCase())); const unique = new Map<string, FoundLead>();
      for (const c of batches.flat()) {
        if (!candidateGood(c)) continue; const key = `${c.company.trim().toLowerCase()}|${c.phone.replace(/\D/g, "")}`;
        if (!existing.has(c.company.trim().toLowerCase()) && !unique.has(key)) unique.set(key, c);
      }
      const ranked = [...unique.values()].sort((a,b) => candidateScore(b)-candidateScore(a)); setCandidates(ranked.slice(0, 24)); const top = ranked.slice(0, 12);
      setFactory({ running: true, current: 0, total: top.length, message: `${top.length} starke Kandidaten · Audit + Research läuft …` });
      let done = 0;
      for (let i = 0; i < top.length; i += 3) {
        const batch = top.slice(i, i + 3); await Promise.all(batch.map((c) => importResearch(c).catch(() => undefined))); done += batch.length;
        setFactory({ running: true, current: done, total: top.length, message: `${done}/${top.length} recherchiert und gescored` });
      }
      const payload = await loadCrm(); const freshQueue = rankedFrom(payload); setSelectedId(freshQueue[0]?.id || null); setFactory({ running: false, current: top.length, total: top.length, message: `${top.length} geprüft · ${freshQueue.filter((l) => grade(l) !== "B").length} A/A+ Leads call-ready.` }); setView("fire"); notify("Queue geladen. Losballern.");
    } catch (e) { const m = e instanceof Error ? e.message : "Lead Factory fehlgeschlagen."; setFactory((f) => ({ ...f, running: false, message: m })); setError(m); }
  }

  return <div className={styles.root}><div className={styles.shell}>
    <header className={styles.topbar}><div className={styles.brand}><b>DG</b><div><strong>Digitale Gewinner</strong><span>PFLEGE · RAPID FIRE SALES OS</span></div></div><div className={styles.topActions}><a href="/pro">Pro Workspace</a><button onClick={() => void refresh()} disabled={busy === "refresh"}>Refresh</button><button className={styles.primary} onClick={() => setView("factory")}>+ A-Leads laden</button></div></header>
    {error && <div className={styles.error}>{error}</div>}

    <section className={styles.command}><div><span className={styles.kicker}>HEUTE ZÄHLT NUR OUTPUT</span><h1>100 Calls → 30 Entscheider → 5 Termine → 1 Abschluss.</h1><p>Keine Recherche während der Call-Session. Keine schlechten Leads. Ergebnis klicken, nächster Lead kommt automatisch.</p></div><div className={styles.metrics}><div><span>Calls</span><b>{data.calls.today}<em>/100</em></b></div><div><span>Entscheider</span><b>{data.calls.connected}<em>/30</em></b><small>{connectRate}% Connect</small></div><div><span>Termine</span><b>{data.calls.meetings}<em>/5</em></b><small>{meetingRate}% aus Gesprächen</small></div><div><span>Queue</span><b>{queue.length}</b><small>{aPlus} A+ · {aLeads} A</small></div></div></section>

    <nav className={styles.tabs}><button className={view === "fire" ? styles.active : ""} onClick={() => setView("fire")}>Rapid Fire</button><button className={view === "factory" ? styles.active : ""} onClick={() => setView("factory")}>Lead Factory</button><button className={view === "all" ? styles.active : ""} onClick={() => setView("all")}>Alle Leads</button></nav>

    {view === "fire" && <div className={styles.fireGrid}>
      <section className={styles.queuePanel}><div className={styles.panelHead}><div><span className={styles.kicker}>CALL QUEUE</span><h2>Nur A-/A+-Chancen zuerst.</h2></div><div className={styles.fireToggle}><span>Auto-Next</span><button className={rapid ? styles.rapidOn : ""} onClick={() => setRapid((v) => !v)}>{rapid ? "AN" : "AUS"}</button></div></div>
        <div className={styles.hotkeys}><span><kbd>Space</kbd> Call</span><span><kbd>1</kbd> nicht erreicht</span><span><kbd>3</kbd> Interesse</span><span><kbd>4</kbd> Termin</span><span><kbd>6</kbd> kein Interesse</span><span><kbd>S</kbd> Skip</span></div>
        <div className={styles.queue}>{queue.slice(0, 35).map((lead, index) => { const g = grade(lead); const pains = painSignals(lead); return <button key={lead.id} className={`${styles.lead} ${selected?.id === lead.id ? styles.selected : ""}`} onClick={() => { setSelectedId(lead.id); setObjection(""); }}><div className={`${styles.grade} ${g === "A+" ? styles.aplus : ""}`}>{g}<small>{rapidScore(lead)}</small></div><div className={styles.leadBody}><div><strong>{index + 1}. {lead.company}</strong><small>{contactName(lead)} · {lead.city}</small></div><p>{pains[0] || primaryPain(lead)}</p><div className={styles.tags}>{pains.slice(1,3).map((p) => <span key={p}>{p}</span>)}{due(lead) && <span>FÄLLIG</span>}{!lead.last_contact_at && <span>NEU</span>}</div></div></button>; })}{!queue.length && <div className={styles.empty}>Keine A-Leads in der Queue. <button onClick={() => setView("factory")}>Jetzt neue A-Leads laden →</button></div>}</div>
      </section>

      <aside className={styles.callPanel}>{selected ? <><div className={styles.nextHead}><div><span className={styles.kicker}>JETZT ANRUFEN</span><h2>{selected.company}</h2><p>{contactName(selected)} · {selected.city}</p></div><div className={`${styles.bigGrade} ${grade(selected)==="A+" ? styles.aplus : ""}`}>{grade(selected)}<small>{rapidScore(selected)}</small></div></div>
        <div className={styles.painBox}><label>PAIN</label>{painSignals(selected).map((p) => <span key={p}>{p}</span>)}</div>
        <div className={styles.script}><label>SAG DAS</label><p>{pitchFor(selected)}</p></div>
        <div className={styles.callActions}><button className={styles.call} onClick={() => dial(selected)}>◉ CALL <kbd>Space</kbd></button>{emailOf(selected) ? <a href={emailHref(selected)}>✉ Mail</a> : <button disabled>Mail fehlt</button>}{selected.website ? <a href={selected.website} target="_blank" rel="noreferrer">Website ↗</a> : <button disabled>Keine Website</button>}</div>
        <div className={styles.objectionWrap}><label>EINWAND → KLICK</label><div className={styles.objections}>{Object.keys(OBJECTIONS).map((o) => <button key={o} onClick={() => setObjection(o)}>{o}</button>)}</div>{objection && <div className={styles.answer}>{OBJECTIONS[objection]}</div>}</div>
        <div className={styles.capture}><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pain / Timing / Entscheider / Bedarf – Stichworte reichen" /><div className={styles.callback}><input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} /><button onClick={() => void recordOutcome("Rückruf")}>Rückruf</button></div><div className={styles.outcomes}>{OUTCOMES.map((o, i) => <button key={o} onClick={() => void recordOutcome(o)} disabled={busy === "outcome"}>{o}<kbd>{i < 4 ? i+1 : o === "Angebot senden" ? 5 : o === "Kein Interesse" ? 6 : ""}</kbd></button>)}<button className={styles.skip} onClick={skip}>Skip <kbd>S</kbd></button></div></div>
      </> : <div className={styles.empty}>Queue leer. Lead Factory starten.</div>}</aside>
    </div>}

    {view === "factory" && <section className={styles.factory}><div className={styles.panelHead}><div><span className={styles.kicker}>A-LEAD FACTORY</span><h2>Private, call-ready Pflegedienste statt Datenmüll.</h2><p>Telefonpflicht · Pflege-Fit · Ketten-Penalty · Digital-Pain · Website-Audit · Karriere/ATS/Social · dann Score.</p></div><span className={styles.pill}>12 pro Lauf</span></div><form onSubmit={(e) => void buildFactory(e)} className={styles.factoryForm}><input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Stuttgart / BW / München …" /><button className={styles.primary} disabled={factory.running}>{factory.running ? "Research läuft …" : "12 starke Leads holen"}</button></form>{factory.message && <div className={styles.factoryStatus}><strong>{factory.message}</strong>{factory.total > 0 && <div><i style={{ width: `${Math.round(factory.current / factory.total * 100)}%` }} /></div>}</div>}<div className={styles.candidates}>{candidates.map((c) => <article key={c.id}><div><b>{candidateScore(c)}</b><strong>{c.company}</strong><small>{c.city}</small></div><p>{c.phone} · {c.website ? "Website vorhanden" : "KEINE WEBSITE = hoher Pain"}{isChainName(c.company) ? " · Kette" : " · unabhängig"}</p></article>)}</div></section>}

    {view === "all" && <section className={styles.all}><div className={styles.panelHead}><div><span className={styles.kicker}>ALLE LEADS</span><h2>{data.leads.length} Datensätze.</h2></div></div><div className={styles.table}><div className={styles.tableHead}><span>Score</span><span>Firma</span><span>Stage</span><span>Pain</span><span>Aktion</span></div>{[...data.leads].sort((a,b)=>rapidScore(b)-rapidScore(a)).map((lead)=><div className={styles.tableRow} key={lead.id}><b>{grade(lead)} {rapidScore(lead)}</b><span>{lead.company}<small>{lead.city}</small></span><span>{lead.stage}</span><span>{painSignals(lead)[0] || "Research offen"}</span><button onClick={()=>{setSelectedId(lead.id);setView("fire");}}>Öffnen</button></div>)}</div></section>}

    <footer className={styles.footer}><span>Pipeline {euro(data.stats.pipeline)}</span><span>{data.stats.due_actions} Follow-ups fällig</span><span>DNC wird automatisch aus der Call-Queue ausgeschlossen</span></footer>
  </div>{toast && <div className={styles.toast}>{toast}</div>}</div>;
}
