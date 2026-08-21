"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Stage = "Neu" | "Kontaktiert" | "Engaged" | "Termin" | "Angebot" | "Gewonnen" | "Verloren";
type Section = "cockpit" | "calls" | "leads" | "campaigns" | "inbox" | "video" | "pipeline" | "analytics" | "setup";
type Lead = {
  id: string; company: string; contact: string; city: string; industry: string; website: string; email: string; phone: string;
  stage: Stage; deal_value: number; notes: string; priority_score: number; fit_score: number; opportunity_score: number; intent_score: number;
  website_score: number; metadata: Record<string, unknown>; updated_at: string;
};
type Overview = {
  stats: { companies: number; leads: number; hot: number; appointments: number; won: number; pipeline: number };
  calls: { today: number; connected: number; talk_seconds: number };
  leads: Lead[];
  activities: Array<{ id: number; lead_id: string; type: string; summary: string; meta: Record<string, unknown>; created_at: string }>;
};
type Step = { waitDays: number; subject: string; body: string; variants?: Array<{ label: string; subject: string; body: string }> };
type Campaign = { id: string; name: string; audience: string; status: "Entwurf" | "Aktiv" | "Pausiert"; dailyLimit: number; steps: Step[]; sent: number; replies: number; positive: number; appointments: number };
type Mailbox = { id: string; name: string; email: string; provider: string; dailyLimit: number; sentToday: number; warmupDay: number; health: number; enabled: boolean; spf?: boolean; dkim?: boolean; dmarc?: boolean };
type LegacyLead = { id: string; company?: string; website?: string; videoUrl?: string; videoStatus?: string; websiteScore?: number; [key: string]: unknown };
type Store = { leads: LegacyLead[]; campaigns: Campaign[]; mailboxes: Mailbox[]; settings: { companyName: string; senderName: string; calendarUrl: string; timezone: string }; [key: string]: unknown };
type Health = { ready?: boolean; coreReady?: boolean; outboundReady?: boolean; leadFinderReady?: boolean; aiReady?: boolean; videoReady?: boolean; configured?: number; total?: number };
type InboxItem = { id: number; leadId: string; company: string; contact: string; from: string; subject: string; mailboxId: string; createdAt: string; stage: string };
type FoundLead = { id: string; company: string; contact: string; email: string; phone: string; website: string; city: string; industry: string; lat?: number; lng?: number };
type IntegrationItem = { key: string; configured: boolean; updatedAt?: string };
type AuditResult = {
  leadId: string; company: string; finalUrl: string;
  scores: { overall: number; conversion: number; trust: number; seo: number; technical?: number; content?: number };
  sales: { opportunitySummary: string; opener: string; emailHook: string; loomTalkingPoints?: string[] };
  priorities?: Array<{ rank: number; title: string; action: string }>;
};

const stages: Stage[] = ["Neu", "Kontaktiert", "Engaged", "Termin", "Angebot", "Gewonnen", "Verloren"];
const nav: Array<{ id: Section; label: string; icon: string }> = [
  { id: "cockpit", label: "Cockpit", icon: "◉" },
  { id: "calls", label: "Call Session", icon: "☎" },
  { id: "leads", label: "Pflege Radar", icon: "⌁" },
  { id: "campaigns", label: "Kampagnen", icon: "✦" },
  { id: "inbox", label: "Inbox", icon: "✉" },
  { id: "video", label: "Video", icon: "▶" },
  { id: "pipeline", label: "Pipeline", icon: "▦" },
  { id: "analytics", label: "Analytics", icon: "↗" },
  { id: "setup", label: "Setup", icon: "⚙" },
];
const starterCampaign: Campaign = {
  id: "pflege-launch-2026", name: "Pflege Recruiting · Entscheider Outreach", audience: "Pflegedienste mit akutem Personalbedarf", status: "Entwurf", dailyLimit: 30,
  sent: 0, replies: 0, positive: 0, appointments: 0,
  steps: [
    { waitDays: 0, subject: "Kurze Idee für {{company}}", body: "Hallo {{first_name}},\n\nich habe mir {{company}} kurz angesehen und eine persönliche Analyse vorbereitet: {{analysis_link}}\n\nDabei geht es konkret darum, qualifizierte Pflegefachkräfte außerhalb klassischer Jobbörsen zu erreichen und den Bewerbungsweg deutlich einfacher zu machen.\n\nViele Grüße\n{{sender_name}}" },
    { waitDays: 3, subject: "Re: Kurze Idee für {{company}}", body: "Hallo {{first_name}}, kurze Nachfrage: Soll ich Ihnen die drei wichtigsten Recruiting-Hebel aus der Analyse direkt zusammenfassen?" },
    { waitDays: 7, subject: "Re: Pflege-Recruiting bei {{company}}", body: "Falls Mitarbeitergewinnung gerade keine Priorität hat, reicht ein kurzes 'später'. Dann hake ich nicht weiter nach." },
  ],
};
const emptyOverview: Overview = { stats: { companies: 0, leads: 0, hot: 0, appointments: 0, won: 0, pipeline: 0 }, calls: { today: 0, connected: 0, talk_seconds: 0 }, leads: [], activities: [] };
const emptyStore: Store = { leads: [], campaigns: [starterCampaign], mailboxes: [], settings: { companyName: "Digitale Gewinner", senderName: "Raphael Hermann", calendarUrl: "", timezone: "Europe/Berlin" } };
const integrationFields = [
  ["openai_api_key", "OpenAI", "KI-Kampagnen & Texte"], ["google_maps_api_key", "Google Maps", "Pflege Lead Finder"], ["email_verifier_api_key", "E-Mail Verifier", "Optionale Verifizierung"],
  ["google_client_id", "Google OAuth Client ID", "Google Mailbox"], ["google_client_secret", "Google OAuth Secret", "Google Mailbox"],
  ["microsoft_client_id", "Microsoft OAuth Client ID", "Microsoft Mailbox"], ["microsoft_client_secret", "Microsoft OAuth Secret", "Microsoft Mailbox"],
  ["video_renderer_url", "Video Renderer URL", "Personalisierte Videos"], ["video_renderer_secret", "Video Renderer Secret", "Personalisierte Videos"],
] as const;

function euro(value: number) { return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value || 0); }
function phone(value: string) { return value.replace(/[^\d+]/g, ""); }
function talkTime(seconds: number) { const m = Math.floor(seconds / 60); return `${m} Min`; }
function stageClass(stage: Stage) { return `launch-stage launch-stage-${stage.toLowerCase()}`; }
function outcomeStage(outcome: string): Stage {
  if (outcome === "Termin") return "Termin";
  if (outcome === "Angebot senden") return "Angebot";
  if (outcome === "Interesse" || outcome === "Rückruf") return "Engaged";
  if (outcome === "Kein Interesse") return "Verloren";
  return "Kontaktiert";
}

export default function PflegeLaunchOS() {
  const [section, setSection] = useState<Section>("cockpit");
  const [overview, setOverview] = useState<Overview>(emptyOverview);
  const [store, setStore] = useState<Store>(emptyStore);
  const [health, setHealth] = useState<Health>({});
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [activeLeadId, setActiveLeadId] = useState("");
  const [callNote, setCallNote] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [leadQuery, setLeadQuery] = useState("Pflegedienst Baden-Württemberg");
  const [foundLeads, setFoundLeads] = useState<FoundLead[]>([]);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([]);

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3200); };

  async function loadOverview() {
    const response = await fetch("/api/crm/launch", { cache: "no-store" });
    const json = await response.json() as Overview & { error?: string };
    if (!response.ok) throw new Error(json.error || "CRM konnte nicht geladen werden.");
    setOverview(json);
    if (!activeLeadId && json.leads.length) setActiveLeadId(json.leads.find((lead) => lead.phone && lead.metadata?.phone_ready !== false && !["Gewonnen", "Verloren"].includes(lead.stage))?.id || json.leads[0].id);
  }

  async function loadState() {
    const response = await fetch("/api/state", { cache: "no-store" });
    const json = await response.json() as { state?: Partial<Store> };
    if (!response.ok) return;
    const incoming = json.state || {};
    setStore({
      ...emptyStore,
      ...incoming,
      leads: Array.isArray(incoming.leads) ? incoming.leads : [],
      campaigns: Array.isArray(incoming.campaigns) && incoming.campaigns.length ? incoming.campaigns : [starterCampaign],
      mailboxes: Array.isArray(incoming.mailboxes) ? incoming.mailboxes : [],
      settings: { ...emptyStore.settings, ...(incoming.settings || {}) },
    });
  }

  async function loadHealth() {
    try { const response = await fetch("/api/system/health", { cache: "no-store" }); if (response.ok) setHealth(await response.json() as Health); } catch {}
  }
  async function loadIntegrations() {
    try { const response = await fetch("/api/integrations", { cache: "no-store" }); if (response.ok) setIntegrations(((await response.json()) as { items?: IntegrationItem[] }).items || []); } catch {}
  }
  async function loadInbox() {
    setBusy("inbox");
    try { const response = await fetch("/api/inbox", { cache: "no-store" }); const json = await response.json() as { items?: InboxItem[]; error?: string }; if (!response.ok) throw new Error(json.error || "Inbox konnte nicht geladen werden."); setInbox(json.items || []); }
    catch (error) { notify(error instanceof Error ? error.message : "Inbox Fehler"); }
    finally { setBusy(""); }
  }
  async function refreshAll() { await Promise.all([loadOverview(), loadState(), loadHealth(), loadIntegrations()]); }

  useEffect(() => { void refreshAll().catch((error) => notify(error instanceof Error ? error.message : "System konnte nicht geladen werden.")); }, []);
  useEffect(() => { if (section === "inbox") void loadInbox(); }, [section]);

  const callQueue = useMemo(() => overview.leads.filter((lead) => lead.phone && lead.metadata?.phone_ready !== false && !["Gewonnen", "Verloren"].includes(lead.stage)), [overview.leads]);
  const activeLead = useMemo(() => callQueue.find((lead) => lead.id === activeLeadId) || callQueue[0] || null, [callQueue, activeLeadId]);
  const activeMailboxes = useMemo(() => store.mailboxes.filter((mailbox) => mailbox.enabled), [store.mailboxes]);
  const configured = useMemo(() => new Set(integrations.filter((item) => item.configured).map((item) => item.key)), [integrations]);
  const launchChecks = [
    ["Pflege-Leads", callQueue.length > 0, `${callQueue.length} direkt anrufbar`],
    ["CloudTalk", true, "Phone + Click-to-Dial aktiv"],
    ["Mailbox", activeMailboxes.length > 0, activeMailboxes.length ? `${activeMailboxes.length} aktiv` : "für E-Mail-Kampagnen fehlt noch eine"],
    ["Kalender", Boolean(store.settings.calendarUrl), store.settings.calendarUrl ? "Terminlink hinterlegt" : "optional für Call-Start"],
  ] as const;

  async function patchLead(leadId: string, data: Record<string, unknown>) {
    const response = await fetch("/api/crm/launch", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId, ...data }) });
    const json = await response.json() as { error?: string };
    if (!response.ok) throw new Error(json.error || "Lead konnte nicht aktualisiert werden.");
    await Promise.all([loadOverview(), loadState()]);
  }

  function dial(lead: Lead) {
    const number = phone(lead.phone);
    if (!number) return notify("Keine Telefonnummer vorhanden.");
    setActiveLeadId(lead.id);
    window.dispatchEvent(new CustomEvent("cloudtalk:dial", { detail: { leadId: lead.id, company: lead.company, phone: number } }));
    const anchor = document.createElement("a"); anchor.href = `ct+tel:${number}`; anchor.style.display = "none"; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    notify(`CloudTalk startet: ${lead.company}`);
  }

  async function saveOutcome(outcome: string) {
    if (!activeLead) return;
    setBusy("outcome");
    const currentIndex = callQueue.findIndex((lead) => lead.id === activeLead.id);
    const nextId = callQueue[currentIndex + 1]?.id || callQueue[0]?.id || "";
    try {
      const note = [callNote.trim(), callbackAt && outcome === "Rückruf" ? `Rückruf: ${callbackAt}` : ""].filter(Boolean).join(" · ");
      await patchLead(activeLead.id, { stage: outcomeStage(outcome), outcome, notesAppend: note, callbackAt: outcome === "Rückruf" ? callbackAt : "" });
      setCallNote(""); setCallbackAt(""); setActiveLeadId(nextId); notify(`${outcome} gespeichert · nächster Lead bereit`);
    } catch (error) { notify(error instanceof Error ? error.message : "Ergebnis konnte nicht gespeichert werden."); }
    finally { setBusy(""); }
  }

  async function changeStage(lead: Lead, stage: Stage) {
    try { await patchLead(lead.id, { stage }); notify(`${lead.company}: ${stage}`); } catch (error) { notify(error instanceof Error ? error.message : "Status konnte nicht gespeichert werden."); }
  }

  async function searchLeads(event: FormEvent) {
    event.preventDefault(); setBusy("search");
    try { const response = await fetch("/api/leads/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: leadQuery, pageSize: 20 }) }); const json = await response.json() as { leads?: FoundLead[]; error?: string }; if (!response.ok) throw new Error(json.error || "Suche fehlgeschlagen."); setFoundLeads(json.leads || []); notify(`${json.leads?.length || 0} Unternehmen gefunden.`); }
    catch (error) { notify(error instanceof Error ? error.message : "Suche fehlgeschlagen."); }
    finally { setBusy(""); }
  }

  async function importLead(found: FoundLead) {
    setBusy(found.id);
    try {
      const response = await fetch("/api/radar/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...found, source: "google-places", workspace: "default" }) });
      const json = await response.json() as { scores?: { priorityScore?: number }; error?: string };
      if (!response.ok) throw new Error(json.error || "Import fehlgeschlagen.");
      setFoundLeads((current) => current.filter((item) => item.id !== found.id)); await refreshAll(); notify(`${found.company} importiert · Priority ${json.scores?.priorityScore || 0}/100`);
    } catch (error) { notify(error instanceof Error ? error.message : "Import fehlgeschlagen."); }
    finally { setBusy(""); }
  }

  async function runAudit(lead: Lead) {
    if (!lead.website) return notify("Für diesen Lead fehlt eine Website.");
    setBusy(`audit-${lead.id}`);
    try {
      const response = await fetch("/api/website/audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: lead.website, company: lead.company }) });
      const json = await response.json() as { audit?: Omit<AuditResult, "leadId">; error?: string };
      if (!response.ok || !json.audit) throw new Error(json.error || "Audit fehlgeschlagen.");
      const result = { ...json.audit, leadId: lead.id } as AuditResult; setAudit(result);
      await patchLead(lead.id, { notesAppend: `Website Radar ${result.scores.overall}/100 · ${result.sales.opportunitySummary}` });
    } catch (error) { notify(error instanceof Error ? error.message : "Audit fehlgeschlagen."); }
    finally { setBusy(""); }
  }

  async function createAiCampaign() {
    setBusy("campaign-ai");
    try {
      const response = await fetch("/api/ai/campaign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audience: "Ambulante Pflegedienste und Pflegeanbieter mit akutem Fachkräftebedarf", offer: "Planbare Mitarbeitergewinnung mit Social Recruiting, Karriere-Funnel und Arbeitgeberpositionierung", sender: store.settings.senderName }) });
      const json = await response.json() as { name?: string; audience?: string; steps?: Step[]; error?: string };
      if (!response.ok || !json.steps) throw new Error(json.error || "KI-Kampagne fehlgeschlagen.");
      const campaign: Campaign = { id: `pflege-ai-${Date.now()}`, name: json.name || "Pflege Recruiting Kampagne", audience: json.audience || "Pflegedienste", status: "Entwurf", dailyLimit: 30, steps: json.steps, sent: 0, replies: 0, positive: 0, appointments: 0 };
      await saveStore({ ...store, campaigns: [campaign, ...store.campaigns] }); notify("KI-Kampagne erstellt.");
    } catch (error) { notify(error instanceof Error ? error.message : "KI-Kampagne fehlgeschlagen."); }
    finally { setBusy(""); }
  }

  async function launchCampaign(campaign: Campaign) {
    if (!activeMailboxes.length) return notify("Vor dem E-Mail-Start eine Mailbox aktivieren.");
    const leads = overview.leads.filter((lead) => lead.email && !["Gewonnen", "Verloren"].includes(lead.stage)).map((lead) => ({ id: lead.id, company: lead.company, contact: lead.contact, email: lead.email, phone: lead.phone, website: lead.website, city: lead.city, industry: lead.industry, stage: lead.stage, dealValue: lead.deal_value, notes: lead.notes, intentScore: lead.intent_score }));
    if (!leads.length) return notify("Keine versandfähigen Leads vorhanden.");
    setBusy(campaign.id);
    try {
      const response = await fetch("/api/campaigns/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaign, leads, mailboxes: store.mailboxes, senderName: store.settings.senderName }) });
      const json = await response.json() as { queued?: number; skipped?: number; error?: string };
      if (!response.ok) throw new Error(json.error || "Kampagnenstart fehlgeschlagen.");
      await saveStore({ ...store, campaigns: store.campaigns.map((item) => item.id === campaign.id ? { ...item, status: "Aktiv" as const } : item) });
      notify(`${json.queued || 0} Schritte eingeplant · ${json.skipped || 0} übersprungen`);
    } catch (error) { notify(error instanceof Error ? error.message : "Kampagnenstart fehlgeschlagen."); }
    finally { setBusy(""); }
  }

  async function saveStore(next: Store) {
    const response = await fetch("/api/state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
    if (!response.ok) throw new Error("Setup konnte nicht gespeichert werden."); setStore(next);
  }

  async function generateVideo(lead: Lead) {
    setBusy(`video-${lead.id}`);
    try { const response = await fetch("/api/video/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId: lead.id }) }); const json = await response.json() as { status?: string; error?: string }; if (!response.ok) throw new Error(json.error || "Video konnte nicht gestartet werden."); await loadState(); notify(json.status === "ready" ? "Video ist fertig." : "Video-Render wurde gestartet."); }
    catch (error) { notify(error instanceof Error ? error.message : "Video Fehler"); }
    finally { setBusy(""); }
  }

  async function noShow(lead: Lead) {
    setBusy(`noshow-${lead.id}`);
    try { const response = await fetch("/api/appointments/no-show", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId: lead.id, firstDelayMinutes: 5, secondDelayHours: 24 }) }); const json = await response.json() as { queued?: number; error?: string }; if (!response.ok) throw new Error(json.error || "No-Show Rescue fehlgeschlagen."); await patchLead(lead.id, { stage: "Engaged", notesAppend: "No-Show Rescue gestartet · 2 Follow-ups" }); notify(`${json.queued || 2} No-Show Follow-ups eingeplant.`); }
    catch (error) { notify(error instanceof Error ? error.message : "No-Show Rescue fehlgeschlagen."); }
    finally { setBusy(""); }
  }

  async function saveIntegration(event: FormEvent<HTMLFormElement>, key: string) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const value = String(form.get("value") || "").trim(); if (!value) return;
    setBusy(`integration-${key}`);
    try { const response = await fetch("/api/integrations", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, value }) }); const json = await response.json() as { error?: string }; if (!response.ok) throw new Error(json.error || "Speichern fehlgeschlagen."); event.currentTarget.reset(); await Promise.all([loadIntegrations(), loadHealth()]); notify("Verschlüsselt gespeichert."); }
    catch (error) { notify(error instanceof Error ? error.message : "Speichern fehlgeschlagen."); }
    finally { setBusy(""); }
  }

  function connectMailbox(provider: "google" | "microsoft") {
    const mailboxId = window.prompt("Credential-ID für das Postfach", "mb-raphael"); if (!mailboxId) return;
    location.href = `/api/oauth/${provider}/start?mailboxId=${encodeURIComponent(mailboxId)}&name=${encodeURIComponent(store.settings.senderName)}`;
  }

  async function addMailbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const email = String(form.get("email") || "").trim(); if (!email.includes("@")) return;
    const mailbox: Mailbox = { id: String(form.get("id") || `mb-${Date.now()}`), name: String(form.get("name") || store.settings.senderName), email, provider: String(form.get("provider") || "Google"), dailyLimit: 5, sentToday: 0, warmupDay: 1, health: 60, enabled: true, spf: false, dmarc: false };
    try { await saveStore({ ...store, mailboxes: [...store.mailboxes, mailbox] }); event.currentTarget.reset(); notify("Mailbox angelegt · Startlimit 5/Tag"); } catch (error) { notify(error instanceof Error ? error.message : "Mailbox Fehler"); }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await saveStore({ ...store, settings: { companyName: String(form.get("companyName") || "Digitale Gewinner"), senderName: String(form.get("senderName") || "Raphael Hermann"), calendarUrl: String(form.get("calendarUrl") || ""), timezone: String(form.get("timezone") || "Europe/Berlin") } }); notify("Setup gespeichert."); }
    catch (error) { notify(error instanceof Error ? error.message : "Setup Fehler"); }
  }

  const videoState = (leadId: string) => store.leads.find((lead) => lead.id === leadId);
  const connectRate = overview.calls.today ? Math.round((overview.calls.connected / overview.calls.today) * 100) : 0;

  return <main className="launch-shell">
    <aside className="launch-sidebar">
      <button className="launch-brand" onClick={() => setSection("cockpit")}><span>DG</span><div><strong>Digitale Gewinner</strong><small>PFLEGE RECRUITING OS</small></div></button>
      <nav>{nav.map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}><span>{item.icon}</span>{item.label}{item.id === "inbox" && inbox.length > 0 && <b>{inbox.length}</b>}</button>)}</nav>
      <div className="launch-sidebar-foot"><i /><div><strong>{health.ready ? "System bereit" : "System aktiv"}</strong><small>{health.configured ?? 0}/{health.total ?? 0} technische Checks</small></div></div>
    </aside>

    <section className="launch-main">
      <header className="launch-topbar"><div><small>DIGITALE GEWINNER · PFLEGE</small><h1>{nav.find((item) => item.id === section)?.label}</h1></div><div className="launch-top-actions"><button onClick={() => void refreshAll()}>↻</button><button className="launch-phone" onClick={() => window.dispatchEvent(new Event("cloudtalk:open"))}>☎ CloudTalk</button><span className="launch-live">● LIVE</span></div></header>

      <div className="launch-content">
        {section === "cockpit" && <>
          <section className="launch-hero"><div><span className="launch-kicker">HEUTE · VERTRIEBSFOKUS</span><h2>Vom ersten Call bis zum Termin in einem einzigen Workflow.</h2><p>Kein Tool-Hopping mehr: Pflegebetriebe priorisieren, mit CloudTalk anrufen, Ergebnis speichern, Analyse oder Video senden und sauber in der Pipeline weiterführen.</p><div className="launch-actions"><button className="launch-primary" onClick={() => setSection("calls")}>☎ Call Session starten</button><button className="launch-secondary" onClick={() => setSection("leads")}>Pflegebetriebe finden</button></div></div><div className="launch-goal"><span>HEUTE</span><strong>{overview.calls.today}</strong><small>von 100 Calls</small><div><i style={{ width: `${Math.min(100, overview.calls.today)}%` }} /></div></div></section>
          <div className="launch-metrics"><article><span>Call-ready</span><strong>{callQueue.length}</strong><small>geprüfte Telefonnummern</small></article><article><span>Gespräche heute</span><strong>{overview.calls.connected}</strong><small>{connectRate}% Connect Rate</small></article><article><span>Termine</span><strong>{overview.stats.appointments}</strong><small>aktuell in Pipeline</small></article><article><span>Pipeline</span><strong>{euro(overview.stats.pipeline)}</strong><small>offener Deal-Wert</small></article></div>
          <div className="launch-grid launch-grid-main"><section className="launch-card"><div className="launch-card-head"><div><span className="launch-kicker">NEXT BEST ACTION</span><h3>{activeLead?.company || "Ersten Pflegebetrieb auswählen"}</h3></div><button onClick={() => setSection("calls")}>Zur Queue →</button></div>{activeLead ? <div className="launch-next"><div><strong>{activeLead.priority_score}</strong><small>PRIORITY</small></div><div><p>{activeLead.city || "Deutschland"} · {activeLead.industry || "Pflege"}</p><b>{activeLead.phone}</b><small>{activeLead.notes || "Noch keine Gesprächsnotiz."}</small></div><button className="launch-call" onClick={() => dial(activeLead)}>☎ Jetzt anrufen</button></div> : <div className="launch-empty">Noch kein anrufbereiter Lead. Öffne das Pflege Radar.</div>}</section><section className="launch-card"><div className="launch-card-head"><div><span className="launch-kicker">LAUNCH CHECK</span><h3>Bereit für Akquise</h3></div></div><div className="launch-checks">{launchChecks.map(([label, ok, detail]) => <div key={label}><span className={ok ? "ok" : "warn"}>{ok ? "✓" : "!"}</span><div><strong>{label}</strong><small>{detail}</small></div></div>)}</div></section></div>
        </>}

        {section === "calls" && <div className="launch-call-layout">
          <section className="launch-card launch-call-focus">{activeLead ? <><div className="launch-card-head"><div><span className="launch-kicker">FOCUS CALL</span><h3>{activeLead.company}</h3><p>{activeLead.city || "Deutschland"} · Priority {activeLead.priority_score}/100</p></div><span className={stageClass(activeLead.stage)}>{activeLead.stage}</span></div><div className="launch-contact"><div><span>ENTSCHEIDER</span><strong>{activeLead.contact || "Noch offen"}</strong></div><div><span>TELEFON</span><strong>{activeLead.phone}</strong></div><div><span>E-MAIL</span><strong>{activeLead.email || "Noch offen"}</strong></div></div><button className="launch-call launch-call-big" onClick={() => dial(activeLead)}>☎ Mit CloudTalk anrufen</button><div className="launch-script"><span>OPENER</span><p>„Guten Tag, Raphael Hermann hier. Ich habe gesehen, dass Sie aktuell Pflegefachkräfte suchen. Ist das bei Ihnen noch ein akutes Thema?“</p><div><b>1</b><small>Welche Position ist gerade am dringendsten?</small><b>2</b><small>Wie gewinnen Sie aktuell Bewerber?</small><b>3</b><small>Nur bei echtem Bedarf Analyse oder Termin anbieten.</small></div></div><label className="launch-field"><span>Gesprächsnotiz</span><textarea value={callNote} onChange={(event) => setCallNote(event.target.value)} placeholder="Pain, Einwand, Ansprechpartner, nächster Schritt …" /></label><label className="launch-field"><span>Rückrufzeit (optional)</span><input value={callbackAt} onChange={(event) => setCallbackAt(event.target.value)} placeholder="z. B. Montag 10:30" /></label><div className="launch-outcomes">{["Nicht erreicht", "Rückruf", "Interesse", "Termin", "Angebot senden", "Kein Interesse", "Falsche Nummer"].map((outcome) => <button disabled={busy === "outcome"} key={outcome} onClick={() => void saveOutcome(outcome)}>{outcome}</button>)}</div></> : <div className="launch-empty large">Keine anrufbereiten Leads vorhanden.</div>}</section>
          <aside className="launch-card launch-queue"><div className="launch-card-head"><div><span className="launch-kicker">QUEUE</span><h3>{callQueue.length} offen</h3></div></div>{callQueue.slice(0, 30).map((lead, index) => <button className={activeLead?.id === lead.id ? "active" : ""} key={lead.id} onClick={() => setActiveLeadId(lead.id)}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{lead.company}</strong><small>{lead.city || "—"} · {lead.phone}</small></div><b>{lead.priority_score}</b></button>)}</aside>
        </div>}

        {section === "leads" && <>
          <section className="launch-card"><div className="launch-card-head"><div><span className="launch-kicker">LEAD INTELLIGENCE</span><h3>Neue Pflegebetriebe finden</h3><p>Google Places → Research → Kontakt → Priority Score → CRM</p></div></div><form className="launch-search" onSubmit={searchLeads}><input value={leadQuery} onChange={(event) => setLeadQuery(event.target.value)} placeholder="z. B. Pflegedienst Stuttgart" /><button className="launch-primary" disabled={busy === "search"}>{busy === "search" ? "Sucht…" : "Suchen"}</button></form>{foundLeads.length > 0 && <div className="launch-found">{foundLeads.map((lead) => <article key={lead.id}><div><strong>{lead.company}</strong><small>{lead.city} · {lead.website || "keine Website erkannt"}</small></div><button disabled={busy === lead.id} onClick={() => void importLead(lead)}>{busy === lead.id ? "Research…" : "Research + Import"}</button></article>)}</div>}</section>
          <section className="launch-card"><div className="launch-card-head"><div><span className="launch-kicker">CRM</span><h3>{overview.leads.length} Pflege-Leads</h3></div></div><div className="launch-table"><table><thead><tr><th>Unternehmen</th><th>Kontakt</th><th>Priority</th><th>Stage</th><th>Aktionen</th></tr></thead><tbody>{overview.leads.map((lead) => <tr key={lead.id}><td><strong>{lead.company}</strong><small>{lead.city || "—"} · {lead.industry || "Pflege"}</small></td><td>{lead.phone || lead.email || "—"}<small>{lead.email}</small></td><td><b className="launch-score">{lead.priority_score}</b></td><td><select value={lead.stage} onChange={(event) => void changeStage(lead, event.target.value as Stage)}>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></td><td><div className="launch-row-actions">{lead.phone && <button onClick={() => { setActiveLeadId(lead.id); setSection("calls"); }}>☎ Call</button>}{lead.website && <button disabled={busy === `audit-${lead.id}`} onClick={() => void runAudit(lead)}>◎ Audit</button>}</div></td></tr>)}</tbody></table></div></section>
        </>}

        {section === "campaigns" && <div className="launch-grid launch-grid-main"><section className="launch-card"><div className="launch-card-head"><div><span className="launch-kicker">OUTBOUND SEQUENCES</span><h3>E-Mail-Kampagnen</h3><p>Call-first, E-Mail als Verstärker und Follow-up.</p></div><button onClick={() => void createAiCampaign()} disabled={busy === "campaign-ai"}>✦ KI-Kampagne</button></div>{store.campaigns.map((campaign) => <article className="launch-campaign" key={campaign.id}><div><span className={campaign.status === "Aktiv" ? "launch-pill ok" : "launch-pill"}>{campaign.status}</span><h3>{campaign.name}</h3><p>{campaign.audience}</p></div><div className="launch-sequence">{campaign.steps.map((step, index) => <span key={index}><b>{index + 1}</b><small>{index ? `+${step.waitDays} Tage` : "Start"}</small></span>)}</div><button className="launch-primary" disabled={busy === campaign.id} onClick={() => void launchCampaign(campaign)}>{busy === campaign.id ? "Startet…" : "Kampagne starten"}</button></article>)}</section><section className="launch-card"><div className="launch-card-head"><div><span className="launch-kicker">SENDER HEALTH</span><h3>{activeMailboxes.length} aktive Mailboxen</h3></div></div>{store.mailboxes.length ? <div className="launch-mailboxes">{store.mailboxes.map((mailbox) => <article key={mailbox.id}><span className={mailbox.enabled ? "ok" : "warn"}>✉</span><div><strong>{mailbox.email}</strong><small>{mailbox.provider} · {mailbox.dailyLimit}/Tag · Health {mailbox.health}%</small></div></article>)}</div> : <div className="launch-empty">Noch keine Mailbox angelegt. Im Setup verbinden.</div>}<button className="launch-secondary full" onClick={() => setSection("setup")}>Mailbox Setup öffnen</button></section></div>}

        {section === "inbox" && <section className="launch-card"><div className="launch-card-head"><div><span className="launch-kicker">UNIFIED REPLY INBOX</span><h3>Antworten aus allen Mailboxen</h3><p>Replies stoppen Sequenzen und werden dem Lead zugeordnet.</p></div><button onClick={() => void loadInbox()}>{busy === "inbox" ? "Lädt…" : "↻ Aktualisieren"}</button></div><div className="launch-inbox">{inbox.length ? inbox.map((item) => <article key={item.id}><span>✉</span><div><strong>{item.company}</strong><small>{item.from} · {item.subject || "(ohne Betreff)"}</small></div><div><b>{item.stage}</b><small>{new Date(item.createdAt).toLocaleString("de-DE")}</small></div></article>) : <div className="launch-empty large">Noch keine Antworten synchronisiert.</div>}</div></section>}

        {section === "video" && <section className="launch-card"><div className="launch-card-head"><div><span className="launch-kicker">PERSONALIZED VIDEO</span><h3>Video-Analysen für warme Leads</h3><p>Erst nach Relevanz oder als hochwertiges Follow-up einsetzen.</p></div></div><div className="launch-video-grid">{overview.leads.filter((lead) => lead.website).map((lead) => { const state = videoState(lead.id); return <article key={lead.id}><div><span className="launch-score">{lead.website_score || lead.priority_score}</span><div><strong>{lead.company}</strong><small>{lead.website}</small></div></div><p>{state?.videoUrl ? "✓ Video fertig" : state?.videoStatus === "queued" ? "Render läuft" : "Noch kein Video"}</p><div>{state?.videoUrl && <a href={`/a/${encodeURIComponent(lead.id)}`} target="_blank" rel="noreferrer">Microsite ↗</a>}<button disabled={busy === `video-${lead.id}`} onClick={() => void generateVideo(lead)}>{busy === `video-${lead.id}` ? "Startet…" : state?.videoUrl ? "Neu rendern" : "Video erstellen"}</button></div></article>})}</div></section>}

        {section === "pipeline" && <section className="launch-card"><div className="launch-card-head"><div><span className="launch-kicker">SALES PIPELINE</span><h3>Vom Erstkontakt zum Kunden</h3></div></div><div className="launch-kanban">{stages.map((stage) => <div key={stage}><header><strong>{stage}</strong><span>{overview.leads.filter((lead) => lead.stage === stage).length}</span></header>{overview.leads.filter((lead) => lead.stage === stage).map((lead) => <article key={lead.id}><small>{lead.city || "PFLEGE"}</small><h4>{lead.company}</h4><p>{lead.contact || lead.email || lead.phone || "Kontakt offen"}</p><b>{euro(lead.deal_value)}</b><select value={lead.stage} onChange={(event) => void changeStage(lead, event.target.value as Stage)}>{stages.map((next) => <option key={next}>{next}</option>)}</select>{stage === "Termin" && lead.email && <button disabled={busy === `noshow-${lead.id}`} onClick={() => void noShow(lead)}>↻ No-Show Rescue</button>}</article>)}</div>)}</div></section>}

        {section === "analytics" && <><div className="launch-metrics"><article><span>Calls heute</span><strong>{overview.calls.today}</strong><small>Ziel 100</small></article><article><span>Connect Rate</span><strong>{connectRate}%</strong><small>{overview.calls.connected} Gespräche</small></article><article><span>Talk Time</span><strong>{talkTime(overview.calls.talk_seconds)}</strong><small>heute</small></article><article><span>Gewonnen</span><strong>{overview.stats.won}</strong><small>Deals</small></article></div><section className="launch-card"><div className="launch-card-head"><div><span className="launch-kicker">ACTIVITY</span><h3>Was im System passiert</h3></div></div><div className="launch-activity">{overview.activities.map((item) => <article key={item.id}><span>{item.type.startsWith("call") ? "☎" : item.type.includes("research") ? "⌁" : "•"}</span><div><strong>{item.summary}</strong><small>{new Date(item.created_at).toLocaleString("de-DE")}</small></div></article>)}</div></section></>}

        {section === "setup" && <div className="launch-setup-grid"><section className="launch-card"><div className="launch-card-head"><div><span className="launch-kicker">BASIS</span><h3>Absender & Termin</h3></div></div><form className="launch-form" onSubmit={saveSettings}><label>Unternehmen<input name="companyName" defaultValue={store.settings.companyName} /></label><label>Absender<input name="senderName" defaultValue={store.settings.senderName} /></label><label>Kalender-URL<input name="calendarUrl" defaultValue={store.settings.calendarUrl} placeholder="https://cal.com/..." /></label><label>Zeitzone<input name="timezone" defaultValue={store.settings.timezone} /></label><button className="launch-primary">Speichern</button></form></section><section className="launch-card"><div className="launch-card-head"><div><span className="launch-kicker">MAILBOX</span><h3>Absender verbinden</h3></div></div><div className="launch-oauth"><button disabled={!configured.has("google_client_id") || !configured.has("google_client_secret")} onClick={() => connectMailbox("google")}>Google verbinden</button><button disabled={!configured.has("microsoft_client_id") || !configured.has("microsoft_client_secret")} onClick={() => connectMailbox("microsoft")}>Microsoft verbinden</button></div><form className="launch-form compact" onSubmit={addMailbox}><label>ID<input name="id" placeholder="mb-raphael" /></label><label>Name<input name="name" defaultValue={store.settings.senderName} /></label><label>E-Mail<input name="email" type="email" required /></label><label>Provider<select name="provider"><option>Google</option><option>Microsoft</option><option>SMTP</option></select></label><button className="launch-primary">Mailbox anlegen</button></form></section><section className="launch-card launch-integrations"><div className="launch-card-head"><div><span className="launch-kicker">INTEGRATION VAULT</span><h3>Technik einmal sauber verbinden</h3><p>Secrets werden verschlüsselt gespeichert.</p></div></div>{integrationFields.map(([key, label, detail]) => <form key={key} onSubmit={(event) => void saveIntegration(event, key)}><span className={configured.has(key) ? "ok" : "warn"}>{configured.has(key) ? "✓" : "!"}</span><div><strong>{label}</strong><small>{detail}</small></div><input name="value" type={key.includes("secret") || key.includes("key") ? "password" : "text"} placeholder={configured.has(key) ? "Neuen Wert zum Ersetzen" : "Wert eintragen"} /><button disabled={busy === `integration-${key}`}>Speichern</button></form>)}</section><section className="launch-card"><div className="launch-card-head"><div><span className="launch-kicker">SYSTEM READINESS</span><h3>Launch-Status</h3></div></div><div className="launch-checks">{[["Core", health.coreReady], ["Outbound", health.outboundReady], ["Lead Finder", health.leadFinderReady], ["KI", health.aiReady], ["Video", health.videoReady], ["CloudTalk", true]].map(([label, ok]) => <div key={String(label)}><span className={ok ? "ok" : "warn"}>{ok ? "✓" : "!"}</span><div><strong>{label}</strong><small>{ok ? "READY" : "SETUP offen"}</small></div></div>)}</div></section></div>}
      </div>
    </section>

    {audit && <div className="launch-modal" onClick={() => setAudit(null)}><section onClick={(event) => event.stopPropagation()}><header><div><span className="launch-kicker">WEBSITE RADAR</span><h2>{audit.company}</h2></div><button onClick={() => setAudit(null)}>×</button></header><div className="launch-audit-scores">{[["Gesamt", audit.scores.overall], ["Conversion", audit.scores.conversion], ["Trust", audit.scores.trust], ["SEO", audit.scores.seo]].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{value}</strong><small>/100</small></article>)}</div><div className="launch-audit-copy"><span>VERTRIEBSCHANCE</span><p>{audit.sales.opportunitySummary}</p><span>OPENER</span><p>{audit.sales.opener}</p><span>E-MAIL HOOK</span><p>{audit.sales.emailHook}</p></div>{audit.priorities?.length ? <div className="launch-priorities">{audit.priorities.slice(0, 4).map((priority) => <article key={priority.rank}><b>{priority.rank}</b><div><strong>{priority.title}</strong><small>{priority.action}</small></div></article>)}</div> : null}</section></div>}
    {toast && <div className="launch-toast">{toast}</div>}
  </main>;
}
