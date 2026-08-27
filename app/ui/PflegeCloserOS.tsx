"use client";

import { useEffect, useMemo, useState } from "react";
import GermanyCoverageRadar from "./GermanyCoverageRadar";
import styles from "./pflege-closer-os.module.css";

type Stage = "Neu" | "Research" | "Bereit" | "Kontaktiert" | "Engaged" | "Qualifiziert" | "Termin" | "Angebot" | "Verhandlung" | "Gewonnen" | "Verloren" | "Wiedervorlage";
type View = "focus" | "factory" | "all";
type Outcome = "Nicht erreicht" | "Erreicht" | "Interesse" | "Termin" | "Rückruf" | "Angebot senden" | "Kein Interesse";
type AdStatus = "active" | "likely" | "none" | "unknown";

type Enrichment = {
  quality?: number;
  enrichedAt?: string;
  phone?: string;
  email?: string;
  careersPage?: string;
  jobsPage?: string;
  atsProviders?: string[];
  trackingTools?: string[];
  linkedin?: string;
  instagram?: string;
  facebook?: string;
  signals?: string[];
  marketing?: { metaPixel?: boolean; googleAdsTag?: boolean };
  ads?: {
    meta?: { status?: AdStatus; url?: string; evidence?: string };
    google?: { status?: AdStatus; url?: string; evidence?: string };
  };
  brief?: {
    summary?: string;
    callOpening?: string;
    emailHook?: string;
    personalizationPoints?: string[];
  };
};

type Lead = {
  id: string;
  company: string;
  contact: string;
  city: string;
  industry: string;
  website: string;
  email: string;
  phone: string;
  stage: Stage;
  deal_value: number;
  notes: string;
  priority_score: number;
  fit_score: number;
  opportunity_score: number;
  intent_score: number;
  website_score: number;
  metadata: Record<string, unknown>;
  last_call_at: string | null;
  last_outcome: string;
  next_action: string;
  next_action_at: string | null;
  do_not_contact: boolean;
  probability: number;
  expected_close_date: string | null;
  last_contact_at: string | null;
  phone_status: string;
  updated_at: string;
};

type Call = { id: number; lead_ref: string; status: string; duration_seconds: number; started_at: string | null };
type Payload = {
  stats: { companies: number; leads: number; hot: number; appointments: number; won: number; pipeline: number; weighted_pipeline: number; due_actions: number };
  calls: { today: number; connected: number; meetings: number; interested: number; talk_seconds: number; history: Call[] };
  leads: Lead[];
};

const EMPTY: Payload = {
  stats: { companies: 0, leads: 0, hot: 0, appointments: 0, won: 0, pipeline: 0, weighted_pipeline: 0, due_actions: 0 },
  calls: { today: 0, connected: 0, meetings: 0, interested: 0, talk_seconds: 0, history: [] },
  leads: [],
};

const OUTCOMES: Outcome[] = ["Nicht erreicht", "Erreicht", "Interesse", "Termin", "Rückruf", "Angebot senden", "Kein Interesse"];
const OBJECTIONS: Record<string, string> = {
  "Kein Interesse": "Verstehe ich. Genau deshalb frage ich kurz: Heißt das, Sie bekommen aktuell genug passende Pflegefachkräfte, niemand springt im Bewerbungsprozess ab und Sie selbst müssen bei offenen Stellen nicht ständig Feuerwehr spielen?",
  "Keine Zeit": "Genau das höre ich von PDLs am häufigsten. Wenn alles an Ihnen hängen bleibt, ist Zeit ja gerade das Problem. Geben Sie mir 30 Sekunden: Wenn es nicht trifft, bin ich sofort wieder raus.",
  "Haben Agentur": "Perfekt, dann kennen Sie das Thema bereits. Ich will Ihre Agentur gar nicht ersetzen. Mich interessiert nur: Liefert das System Ihnen planbar Bewerber und wird jeder Kontakt sauber nachverfolgt – oder haben Sie trotzdem Lücken?",
  "Schicken Sie Mail": "Mach ich gern. Damit ich Ihnen nicht irgendeine Standard-Mail schicke: Was ist bei Ihnen aktuell nerviger – zu wenig Bewerber, unpassende Bewerber oder dass gute Kandidaten im Prozess abspringen?",
  "Läuft gut": "Das ist stark. Dann nur aus Neugier: Wenn morgen zwei gute Fachkräfte kündigen, hätten Sie innerhalb von 30 Tagen planbar Ersatz – ohne Jobbörsen-Hoffnung und ohne dass Sie selbst alles nachtelefonieren?",
};

function enrichmentOf(lead: Lead): Enrichment {
  const value = lead.metadata?.enrichment;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Enrichment : {};
}
function phoneOf(lead: Lead) { return lead.phone || enrichmentOf(lead).phone || ""; }
function emailOf(lead: Lead) { return lead.email || enrichmentOf(lead).email || ""; }
function due(lead: Lead) { return Boolean(lead.next_action_at && new Date(lead.next_action_at).getTime() <= Date.now()); }
function adStatus(lead: Lead) {
  const e = enrichmentOf(lead);
  const statuses = [e.ads?.meta?.status, e.ads?.google?.status];
  if (statuses.includes("active")) return "active" as const;
  if (statuses.includes("likely") || e.marketing?.metaPixel || e.marketing?.googleAdsTag) return "likely" as const;
  return "none" as const;
}
function validForCall(lead: Lead) {
  return Boolean(phoneOf(lead)) && lead.stage !== "Research" && !lead.do_not_contact && lead.phone_status !== "invalid" && !["Gewonnen", "Verloren"].includes(lead.stage);
}
function firstName(value: string) { return value.trim().split(/\s+/)[0] || "Herr/Frau"; }
function euro(value: number) { return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(value || 0)); }
function clamp(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }
function silverScore(lead: Lead) {
  const e = enrichmentOf(lead);
  let score = lead.priority_score * .34 + lead.fit_score * .2 + lead.opportunity_score * .18 + lead.intent_score * .08;
  if (lead.website_score > 0 && lead.website_score < 55) score += 6;
  if (!e.careersPage) score += 6;
  if (!e.atsProviders?.length) score += 4;
  if (phoneOf(lead)) score += 4;
  if (adStatus(lead) === "active") score += 8;
  else if (adStatus(lead) === "likely") score += 4;
  if (due(lead)) score += 10;
  if (["Engaged", "Qualifiziert", "Wiedervorlage"].includes(lead.stage)) score += 12;
  if (["Termin", "Angebot", "Verhandlung"].includes(lead.stage)) score += 15;
  return clamp(score);
}
function painSignals(lead: Lead) {
  const e = enrichmentOf(lead);
  const pains: string[] = [];
  if (adStatus(lead) === "active" && lead.website_score > 0 && lead.website_score < 65) pains.push("Bezahlter Traffic trifft auf eine schwache Bewerberstrecke");
  else if (adStatus(lead) === "active") pains.push("Aktive Paid-Ads erkannt – Budget ist bereits im Markt");
  else if (adStatus(lead) === "likely") pains.push("Werbe-Tracking erkannt – Paid-Aktivität wahrscheinlich");
  if (lead.website_score > 0 && lead.website_score < 45) pains.push("Website wirkt als Bewerberbremse");
  else if (lead.website_score > 0 && lead.website_score < 65) pains.push("Digitaler Auftritt hat sichtbares Potenzial");
  if (!e.careersPage) pains.push("Keine klare Karriere-Strecke erkannt");
  if (!e.atsProviders?.length) pains.push("Kein sauberer Bewerberprozess erkannt");
  if (!(e.linkedin || e.instagram || e.facebook)) pains.push("Employer Branding kaum sichtbar");
  if (lead.opportunity_score >= 75) pains.push("Hoher Recruiting-Hebel");
  for (const signal of e.signals || []) if (signal && !pains.includes(signal)) pains.push(signal);
  return pains.slice(0, 5);
}
function primaryPain(lead: Lead) {
  const e = enrichmentOf(lead);
  return e.brief?.summary || painSignals(lead)[0] || "bei Ihrem digitalen Bewerberprozess ist noch Potenzial sichtbar";
}
function pitchFor(lead: Lead) {
  const e = enrichmentOf(lead);
  if (e.brief?.callOpening) {
    return `${e.brief.callOpening} Ich spreche täglich mit PDLs wie Ihnen und höre immer wieder: zu wenig passende Bewerber, gute Kandidaten springen ab und am Ende bleibt zu viel an der PDL hängen. Aber bei Ihnen ist es wahrscheinlich komplett anders: alles läuft perfekt und Sie können nächstes Jahr entspannt in Rente gehen, weil Sie keines dieser Probleme kennen – oder?`;
  }
  const specific = primaryPain(lead);
  return `Hallo ${firstName(lead.contact)}, Raphael Hermann von Digitale Gewinner hier – ich mach’s ganz kurz. Ich spreche täglich mit PDLs wie Ihnen und höre eigentlich immer dieselben Dinge: zu wenig passende Bewerber, gute Kandidaten springen irgendwo im Prozess wieder ab und am Ende bleibt viel zu viel davon an der PDL selbst hängen. Ich habe mir ${lead.company} kurz angesehen und dabei ist mir aufgefallen, dass ${specific.charAt(0).toLowerCase()}${specific.slice(1)}. Aber bei Ihnen ist es wahrscheinlich komplett anders: alles läuft perfekt und Sie können nächstes Jahr entspannt in Rente gehen, weil Sie keines dieser Probleme kennen – oder?`;
}
function emailHref(lead: Lead) {
  const email = emailOf(lead);
  const e = enrichmentOf(lead);
  const subject = encodeURIComponent(`Kurze Idee für ${lead.company}`);
  const hook = e.brief?.emailHook || `ich habe mir ${lead.company} kurz angesehen und dabei einen konkreten Hebel bei Mitarbeitergewinnung und Bewerberprozess entdeckt.`;
  const body = encodeURIComponent(`Hallo ${firstName(lead.contact)},\n\n${hook}\n\nIch würde Ihnen gern in 15 Minuten zeigen, wie wir das für Pflegedienste als zusammenhängendes System lösen – ohne noch ein weiteres Tool-Chaos aufzubauen.\n\nViele Grüße\nRaphael Hermann`);
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

export default function PflegeCloserOS() {
  const [data, setData] = useState<Payload>(EMPTY);
  const [view, setView] = useState<View>("focus");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [objection, setObjection] = useState("");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 3300); }
  async function loadCrm() {
    const response = await fetch("/api/crm/launch", { cache: "no-store" });
    const json = await response.json() as Payload & { error?: string };
    if (!response.ok) throw new Error(json.error || "CRM konnte nicht geladen werden.");
    setData(json);
    setSelectedId((current) => current && json.leads.some((lead) => lead.id === current) ? current : null);
    return json;
  }
  async function refresh() {
    setBusy("refresh"); setError("");
    try { await loadCrm(); }
    catch (e) { setError(e instanceof Error ? e.message : "CRM konnte nicht geladen werden."); }
    finally { setBusy(""); }
  }
  useEffect(() => { void refresh(); }, []);

  const platter = useMemo(() => data.leads.filter(validForCall).sort((a, b) => silverScore(b) - silverScore(a)), [data.leads]);
  const selected = useMemo(() => data.leads.find((lead) => lead.id === selectedId) || platter[0] || null, [data.leads, platter, selectedId]);
  const perfect = useMemo(() => platter.filter((lead) => silverScore(lead) >= 78), [platter]);
  const researchQueue = useMemo(() => data.leads.filter((lead) => lead.stage === "Research").length, [data.leads]);
  const dueNow = useMemo(() => data.leads.filter((lead) => due(lead) && !["Gewonnen", "Verloren"].includes(lead.stage)).length, [data.leads]);
  const connectRate = data.calls.today ? Math.round(data.calls.connected / data.calls.today * 100) : 0;

  async function patchLead(leadId: string, patch: Record<string, unknown>) {
    const response = await fetch("/api/crm/launch", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId, ...patch }) });
    const json = await response.json() as Payload & { error?: string };
    if (!response.ok) throw new Error(json.error || "Aktion konnte nicht gespeichert werden.");
    setData(json);
    return json;
  }
  function dial(lead: Lead) {
    const phone = phoneOf(lead).replace(/[^\d+]/g, "");
    if (!phone) return notify("Keine Telefonnummer vorhanden.");
    setSelectedId(lead.id);
    window.dispatchEvent(new CustomEvent("cloudtalk:dial", { detail: { leadId: lead.id, company: lead.company, phone } }));
    const anchor = document.createElement("a");
    anchor.href = `ct+tel:${phone}`; anchor.style.display = "none"; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  }
  async function recordOutcome(outcome: Outcome) {
    if (!selected) return;
    if (outcome === "Rückruf" && !callbackAt) return notify("Bitte Rückrufzeit setzen.");
    setBusy("outcome");
    try {
      await patchLead(selected.id, { outcome, notesAppend: note.trim(), callbackAt: callbackAt || "" });
      setNote(""); setCallbackAt(""); setObjection("");
      const next = platter.find((lead) => lead.id !== selected.id);
      setSelectedId(next?.id || null);
      notify(`${outcome} gespeichert · nächster Lead liegt bereit`);
    } catch (e) { notify(e instanceof Error ? e.message : "Ergebnis konnte nicht gespeichert werden."); }
    finally { setBusy(""); }
  }
  async function copyPitch() {
    if (!selected) return;
    try { await navigator.clipboard.writeText(pitchFor(selected)); notify("Pitch kopiert."); }
    catch { notify("Kopieren nicht möglich."); }
  }

  return <div className={styles.root}><div className={styles.shell}>
    <header className={styles.topbar}>
      <div className={styles.brand}><div className={styles.brandMark}>DG</div><div><strong>Digitale Gewinner</strong><span>PFLEGE · CLOSING OS</span></div></div>
      <div className={styles.topActions}><a className={styles.advancedLink} href="/pro">Pro Workspace ↗</a><button className={styles.quiet} type="button" onClick={() => void refresh()} disabled={busy === "refresh"}>Aktualisieren</button><button className={styles.primary} type="button" onClick={() => setView("factory")}>⌁ Deutschland Lead Radar</button></div>
    </header>

    {error && <div className={styles.error}>{error}</div>}

    <section className={styles.mission}>
      <div className={styles.hero}><span className={styles.eyebrow}>HEUTIGE MISSION</span><h1>30 Entscheider. 5 Termine. 1 Abschluss.</h1><p>Kein Suchen, kein Überlegen: Deutschland-Radar füllt das CRM, Enrichment priorisiert die stärksten Pflege-Leads und beim Call liegen Pain, Pitch, Werbe-Signale und nächste Aktion fertig vor.</p><div className={styles.heroActions}><button className={styles.success} type="button" onClick={() => { setView("focus"); if (selected) dial(selected); }} disabled={!selected}>▶ Nächsten Top-Lead anrufen</button><button className={styles.quiet} type="button" onClick={() => setView("factory")}>Deutschland systematisch erfassen</button></div></div>
      <div className={styles.missionStats}>
        <div className={styles.stat}><span>Calls</span><strong>{data.calls.today}/100</strong><small>gewählte Kontakte heute</small><div className={styles.progress}><i style={{ width: `${Math.min(100, data.calls.today)}%` }} /></div></div>
        <div className={styles.stat}><span>Entscheider</span><strong>{data.calls.connected}/30</strong><small>{connectRate}% Connect Rate</small><div className={styles.progress}><i style={{ width: `${Math.min(100, data.calls.connected / 30 * 100)}%` }} /></div></div>
        <div className={styles.stat}><span>Termine</span><strong>{data.calls.meetings}/5</strong><small>{data.calls.interested} Interesse+</small><div className={styles.progress}><i style={{ width: `${Math.min(100, data.calls.meetings / 5 * 100)}%` }} /></div></div>
        <div className={styles.stat}><span>Research Queue</span><strong>{researchQueue}</strong><small>{dueNow} Follow-ups fällig · {euro(data.stats.pipeline)} Pipeline</small><div className={styles.progress}><i style={{ width: `${Math.min(100, researchQueue * 5)}%` }} /></div></div>
      </div>
    </section>

    <div className={styles.tabs}><button className={view === "focus" ? styles.tabActive : ""} onClick={() => setView("focus")}>Silbertablett</button><button className={view === "factory" ? styles.tabActive : ""} onClick={() => setView("factory")}>Deutschland Lead Radar</button><button className={view === "all" ? styles.tabActive : ""} onClick={() => setView("all")}>Alle Leads</button></div>

    {view === "focus" && <div className={styles.mainGrid}>
      <section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.eyebrow}>SILVER PLATTER</span><h2>Die Leads, die du jetzt anrufen sollst.</h2><p>Nur enriched + call-ready. Score = Fit + Opportunity + Intent + Recruiting-Pain + Werbe-Signal + Erreichbarkeit + Follow-up-Druck.</p></div><span className={`${styles.badge} ${perfect.length ? styles.badgeHot : ""}`}>{perfect.length} Top-Chancen</span></div>
        <div className={styles.leadList}>{platter.slice(0, 24).map((lead) => { const score = silverScore(lead); const pains = painSignals(lead); const ads = adStatus(lead); return <button type="button" key={lead.id} className={`${styles.leadRow} ${selected?.id === lead.id ? styles.leadRowActive : ""}`} onClick={() => { setSelectedId(lead.id); setObjection(""); }}><div className={`${styles.score} ${score >= 78 ? styles.scoreHot : ""}`}>{score}</div><div className={styles.company}><strong>{lead.company}</strong><small>{[lead.contact || "PDL offen", lead.city].filter(Boolean).join(" · ")}</small></div><div className={styles.pain}><strong>{pains[0] || primaryPain(lead)}</strong><small>{pains.slice(1,3).join(" · ") || `Fit ${lead.fit_score} · Opportunity ${lead.opportunity_score}`}</small></div><div className={styles.miniMeta}><strong>{ads === "active" ? "● ADS ACTIVE" : ads === "likely" ? "◐ AD SIGNAL" : lead.stage}</strong><small>● call-ready</small></div></button>; })}{!platter.length && <div className={styles.empty}>Noch keine enriched call-ready Leads. Öffne den Deutschland Lead Radar, scanne ein Gebiet und starte das Enrichment.</div>}</div>
      </section>

      <aside className={styles.callPanel}>{selected ? <>
        <div className={styles.callTop}><div><span className={styles.eyebrow}>NEXT BEST CALL</span><h2>{selected.company}</h2><p>{[selected.contact || "Ansprechpartner recherchiert/offen", selected.city, selected.stage].filter(Boolean).join(" · ")}</p></div><div className={styles.bigScore}>{silverScore(selected)}</div></div>
        <div className={styles.painBox}><label>PAIN + INTENT RADAR · DARÜBER REDEN</label><div className={styles.painTags}>{painSignals(selected).map((pain) => <span key={pain}>{pain}</span>)}{!painSignals(selected).length && <span>Recruiting-Prozess im Gespräch qualifizieren</span>}</div></div>
        <div className={styles.scriptBox}><label>DEIN OPENER · NICHT NACHDENKEN, SAGEN</label><p>{pitchFor(selected)}</p><div className={styles.scriptActions}><button type="button" onClick={() => void copyPitch()}>Pitch kopieren</button><button type="button" onClick={() => setObjection("Schicken Sie Mail")}>Mail-Brücke</button></div></div>
        <div className={styles.callActions}><button className={styles.dial} type="button" onClick={() => dial(selected)}>◉ Jetzt anrufen</button>{emailOf(selected) ? <a href={emailHref(selected)}>✉ Mail</a> : <button type="button" disabled>✉ Mail fehlt</button>}{selected.website ? <a href={selected.website} target="_blank" rel="noreferrer">↗ Website</a> : <button type="button" disabled>Website fehlt</button>}<a href={`/pro?lead=${encodeURIComponent(selected.id)}`}>◈ Vollprofil</a></div>
        <div className={styles.objectionBox}><label>EINWAND? ANTIPPEN → DIREKTE ANTWORT</label><div className={styles.objections}>{Object.keys(OBJECTIONS).map((item) => <button key={item} type="button" onClick={() => setObjection(item)}>{item}</button>)}</div>{objection && <div className={styles.objectionAnswer}>{OBJECTIONS[objection]}</div>}</div>
        <div className={styles.noteBox}><label>CALL NOTIZ + ERGEBNIS</label><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Was sagt die PDL? Schmerz, Bedarf, Timing, Entscheider …" /><div className={styles.callback}><input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} /><button className={styles.quiet} type="button" onClick={() => void recordOutcome("Rückruf")} disabled={busy === "outcome"}>Rückruf setzen</button></div><div className={styles.outcomes}>{OUTCOMES.filter((item) => item !== "Rückruf").map((item) => <button type="button" key={item} onClick={() => void recordOutcome(item)} disabled={busy === "outcome"}>{item}</button>)}</div></div>
      </> : <div className={styles.empty}>Kein Lead ausgewählt.</div>}</aside>
    </div>}

    {view === "factory" && <GermanyCoverageRadar onCrmChanged={loadCrm} />}

    {view === "all" && <section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.eyebrow}>CRM QUICK VIEW</span><h2>Alle Pflege-Leads.</h2><p>Research-Leads bleiben hier sichtbar, erscheinen aber erst nach Enrichment auf dem Silbertablett.</p></div><span className={styles.badge}>{data.leads.length} Leads</span></div><div className={styles.tableWrap}><table className={styles.allTable}><thead><tr><th>Score</th><th>Unternehmen</th><th>Ort</th><th>Stage</th><th>Ads</th><th>Fit</th><th>Opportunity</th><th>Next</th><th>Aktion</th></tr></thead><tbody>{[...data.leads].sort((a,b) => silverScore(b)-silverScore(a)).map((lead) => <tr key={lead.id}><td><b>{silverScore(lead)}</b></td><td><b>{lead.company}</b></td><td>{lead.city}</td><td>{lead.stage}</td><td>{adStatus(lead) === "active" ? "ACTIVE" : adStatus(lead) === "likely" ? "SIGNAL" : "—"}</td><td>{lead.fit_score}</td><td>{lead.opportunity_score}</td><td>{lead.next_action || "—"}</td><td><button type="button" onClick={() => { setSelectedId(lead.id); setView("focus"); }}>Öffnen</button></td></tr>)}</tbody></table></div></section>}
  </div>{toast && <div className={styles.toast}>{toast}</div>}</div>;
}
