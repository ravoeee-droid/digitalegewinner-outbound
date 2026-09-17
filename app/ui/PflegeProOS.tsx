"use client";

import { ChangeEvent, DragEvent, FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import styles from "./pflege-pro-os.module.css";

type Stage = "Neu" | "Research" | "Bereit" | "Kontaktiert" | "Engaged" | "Qualifiziert" | "Termin" | "Angebot" | "Verhandlung" | "Gewonnen" | "Verloren" | "Wiedervorlage";
type View = "command" | "crm" | "finder" | "calls" | "pipeline" | "followups" | "meetings" | "proposals" | "campaigns" | "inbox" | "intelligence" | "analytics" | "system";

type Enrichment = {
  version?: number;
  enrichedAt?: string;
  quality?: number;
  website?: string;
  domain?: string;
  googlePlaceId?: string;
  googleAddress?: string;
  email?: string;
  phone?: string;
  publicEmails?: string[];
  publicPhones?: string[];
  linkedin?: string;
  instagram?: string;
  facebook?: string;
  tiktok?: string;
  youtube?: string;
  xing?: string;
  contactPage?: string;
  careersPage?: string;
  jobsPage?: string;
  teamPage?: string;
  atsProviders?: string[];
  trackingTools?: string[];
  pagesScanned?: number;
  signals?: string[];
  warnings?: string[];
  brief?: {
    summary?: string;
    callOpening?: string;
    emailHook?: string;
    personalizationPoints?: string[];
    likelyDecisionMaker?: string;
    nextResearchStep?: string;
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
  lost_reason: string;
  last_contact_at: string | null;
  phone_status: string;
  updated_at: string;
};

type Activity = { id: number; lead_id: string; type: string; summary: string; meta: Record<string, unknown>; created_at: string };
type Call = { id: number; lead_ref: string; company: string; direction: string; status: string; external_number: string; started_at: string | null; answered_at: string | null; ended_at: string | null; duration_seconds: number; raw_payload: Record<string, unknown> };
type Payload = {
  stats: { companies: number; leads: number; hot: number; appointments: number; won: number; pipeline: number; weighted_pipeline: number; due_actions: number };
  calls: { today: number; connected: number; meetings: number; interested: number; talk_seconds: number; history: Call[] };
  leads: Lead[];
  activities: Activity[];
  campaignStats?: Record<string, { sent: number; replies: number; positive: number; appointments: number }>;
  campaignVariantStats?: Record<string, Array<{ variant: string; sent: number; replies: number }>>;
  system: { campaigns: number; mailboxes: number; activeMailboxes: number };
};
type FoundLead = { id: string; company: string; contact: string; email: string; phone: string; website: string; city: string; industry: string; lat?: number; lng?: number };
type InboxItem = { id: number; leadId: string; company: string; contact: string; from: string; subject: string; mailboxId: string; createdAt: string; stage: string };
type Step = { waitDays: number; subject: string; body: string; variants?: Array<{ label: string; subject: string; body: string }> };
type Campaign = { id: string; name: string; audience: string; status: "Entwurf" | "Aktiv" | "Pausiert"; dailyLimit: number; steps: Step[]; sent: number; replies: number; positive: number; appointments: number };
type Mailbox = { id: string; name: string; email: string; provider: string; dailyLimit: number; sentToday: number; warmupDay: number; health: number; enabled: boolean; spf?: boolean; dkim?: boolean; dmarc?: boolean };
type Store = { campaigns: Campaign[]; mailboxes: Mailbox[]; settings: { companyName: string; senderName: string; calendarUrl: string; timezone: string; pitchVideoUrl?: string }; [key: string]: unknown };
type ResearchDetail = {
  lead?: { id: string; companyId: string; company: string; city: string; industry: string; website: string; companyPhone: string; metadata: Record<string, unknown> };
  contact?: { id: string | null; name: string; email: string; phone: string; metadata: Record<string, unknown> };
  research?: { id: string; status: string; website_score: number; contact_score: number; fit_score: number; opportunity_score: number; priority_score: number; signals: string[]; audit: Record<string, unknown>; contact: Record<string, unknown>; summary: string; created_at: string } | null;
  activities?: Array<{ id: number; type: string; summary: string; meta: Record<string, unknown>; created_at: string }>;
  calls?: Array<{ id: number; direction: string; status: string; external_number: string; started_at: string | null; answered_at: string | null; ended_at: string | null; duration_seconds: number }>;
};

type NavItem = { id?: View; label: string; mark: string; href?: string; badge?: string };
type NavGroup = { label: string; items: NavItem[] };

type InspectorTab = "overview" | "research" | "timeline" | "deal";

const STAGES: Stage[] = ["Neu", "Research", "Bereit", "Kontaktiert", "Engaged", "Qualifiziert", "Termin", "Angebot", "Verhandlung", "Gewonnen", "Verloren", "Wiedervorlage"];
const PIPELINE: Stage[] = ["Neu", "Kontaktiert", "Engaged", "Qualifiziert", "Termin", "Angebot", "Verhandlung", "Gewonnen"];
const OUTCOMES = ["Nicht erreicht", "Erreicht", "Interesse", "Termin", "Rückruf", "Angebot senden", "Kein Interesse", "Falsche Nummer"] as const;
const EMPTY: Payload = { stats: { companies: 0, leads: 0, hot: 0, appointments: 0, won: 0, pipeline: 0, weighted_pipeline: 0, due_actions: 0 }, calls: { today: 0, connected: 0, meetings: 0, interested: 0, talk_seconds: 0, history: [] }, leads: [], activities: [], system: { campaigns: 0, mailboxes: 0, activeMailboxes: 0 } };
const STARTER: Campaign = {
  id: "pflege-launch-2026",
  name: "Pflege Recruiting · Entscheider Outreach",
  audience: "Pflegedienste mit akutem Personalbedarf",
  status: "Entwurf",
  dailyLimit: 30,
  sent: 0,
  replies: 0,
  positive: 0,
  appointments: 0,
  steps: [
    { waitDays: 0, subject: "Kurze Idee für {{company}}", body: "Hallo {{first_name}},\n\nich habe mir {{company}} kurz angesehen und eine persönliche Analyse vorbereitet: {{analysis_link}}\n\nDabei geht es konkret darum, qualifizierte Pflegefachkräfte außerhalb klassischer Jobbörsen zu erreichen und den Bewerbungsweg deutlich einfacher zu machen.\n\nViele Grüße\n{{sender_name}}" },
    { waitDays: 3, subject: "Re: Kurze Idee für {{company}}", body: "Hallo {{first_name}}, kurze Nachfrage: Soll ich Ihnen die drei wichtigsten Recruiting-Hebel aus der Analyse direkt zusammenfassen?" },
    { waitDays: 7, subject: "Re: Pflege-Recruiting bei {{company}}", body: "Falls Mitarbeitergewinnung gerade keine Priorität hat, reicht ein kurzes 'später'. Dann hake ich nicht weiter nach." },
  ],
};
const EMPTY_STORE: Store = { campaigns: [STARTER], mailboxes: [], settings: { companyName: "Digitale Gewinner", senderName: "Raphael Hermann", calendarUrl: "", timezone: "Europe/Berlin" } };
const NAV: NavGroup[] = [
  { label: "Workspace", items: [
    { id: "command", label: "Command", mark: "⌘" },
    { id: "crm", label: "CRM", mark: "▦", badge: "PRO" },
    { id: "finder", label: "Lead Finder", mark: "⌕" },
    { id: "calls", label: "Calls", mark: "◉" },
    { id: "pipeline", label: "Pipeline", mark: "▥" },
    { id: "followups", label: "Follow-ups", mark: "✓" },
  ] },
  { label: "Outbound", items: [
    { id: "campaigns", label: "Campaigns", mark: "↗" },
    { id: "inbox", label: "Inbox", mark: "✉" },
    { label: "Studio V3", mark: "▶", href: "/studio", badge: "V3" },
  ] },
  { label: "Revenue", items: [
    { id: "meetings", label: "Meetings", mark: "○" },
    { id: "proposals", label: "Proposals", mark: "◇" },
    { id: "intelligence", label: "Intelligence", mark: "◈" },
    { id: "analytics", label: "Analytics", mark: "⌁" },
  ] },
  { label: "System", items: [{ id: "system", label: "Integrationen", mark: "⚙" }] },
];

function euro(value: number) { return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(value || 0)); }
function fmtDate(value: string | null | undefined, withTime = false) { if (!value) return "—"; const date = new Date(value); if (Number.isNaN(date.getTime())) return "—"; return new Intl.DateTimeFormat("de-DE", withTime ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", year: "2-digit" }).format(date); }
function dtLocal(value: string | null | undefined) { if (!value) return ""; const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function cleanPhone(value: string) { return value.replace(/[^\d+]/g, ""); }
function due(lead: Lead) { return Boolean(lead.next_action_at && new Date(lead.next_action_at).getTime() <= Date.now()); }
function firstName(contact: string) { return contact.trim().split(/\s+/)[0] || "Guten Tag"; }
function extractLine(notes: string, label: string) { const line = notes.split(/\r?\n/).find((value) => value.trim().toLowerCase().startsWith(label.toLowerCase())); return line ? line.slice(line.indexOf(":") + 1).trim() : ""; }
function enrichmentOf(lead: Lead): Enrichment {
  const value = lead.metadata?.enrichment;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Enrichment : {};
}
function whyNow(lead: Lead) { const e = enrichmentOf(lead); return e.brief?.summary || extractLine(lead.notes, "Warum passend:") || lead.next_action || (lead.priority_score >= 90 ? "A+ Lead · hoher Recruiting-Fit und direkter Kontakt" : lead.opportunity_score >= 70 ? "Hohes Recruiting-Potenzial" : "Outbound bereit"); }
function opener(lead: Lead) { const e = enrichmentOf(lead); return e.brief?.callOpening || extractLine(lead.notes, "Pitch:") || `Guten Tag, ${firstName(lead.contact)} — ich habe mir ${lead.company} kurz angesehen. Mir ist dabei ein konkreter Hebel aufgefallen, wie Sie qualifizierte Pflegekräfte außerhalb klassischer Jobbörsen erreichen können. Haben Sie gerade zwei Minuten?`; }
function isCallReady(lead: Lead) { return Boolean(lead.phone || enrichmentOf(lead).phone) && lead.metadata?.phone_ready !== false && !lead.do_not_contact && lead.phone_status !== "invalid" && !["Termin", "Angebot", "Verhandlung", "Gewonnen", "Verloren"].includes(lead.stage); }
function callPriority(lead: Lead) { let score = lead.priority_score * 3 + lead.intent_score * 2 + lead.opportunity_score; if (lead.stage === "Engaged") score += 260; if (lead.stage === "Qualifiziert") score += 320; if (lead.stage === "Wiedervorlage") score += 300; if (due(lead)) score += 420; if (!lead.last_contact_at) score += 70; return score; }
function researchQuality(lead: Lead) { return Number(enrichmentOf(lead).quality || 0); }
function isEnriched(lead: Lead) { return Boolean(enrichmentOf(lead).enrichedAt); }
function researchAge(lead: Lead) { const date = enrichmentOf(lead).enrichedAt; return date ? fmtDate(date) : "nicht geprüft"; }
function auditFrom(detail: ResearchDetail | null) { const value = detail?.research?.audit; return value && typeof value === "object" ? value as { scores?: Record<string, number>; findings?: Array<{ severity?: string; category?: string; title?: string; detail?: string; recommendation?: string }>; metrics?: Record<string, unknown>; priorities?: Array<{ title?: string; action?: string; expectedImpact?: string }>; sales?: Record<string, unknown> } : null; }
function clamp(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }

export default function PflegeProOS() {
  const [view, setView] = useState<View>("command");
  const [data, setData] = useState<Payload>(EMPTY);
  const [store, setStore] = useState<Store>(EMPTY_STORE);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [found, setFound] = useState<FoundLead[]>([]);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [stageFilter, setStageFilter] = useState<"all" | Stage>("all");
  const [researchFilter, setResearchFilter] = useState<"all" | "enriched" | "missing" | "weak">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  const [detail, setDetail] = useState<ResearchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [callId, setCallId] = useState<string | null>(null);
  const [callNote, setCallNote] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [leadQuery, setLeadQuery] = useState("Pflegedienst Baden-Württemberg");
  const [createOpen, setCreateOpen] = useState(false);
  const [campaignGenOpen, setCampaignGenOpen] = useState(false);
  const [mailConfig, setMailConfig] = useState<Array<{ id: string; email: string; configured: boolean }>>([]);
  const [mobileNav, setMobileNav] = useState(false);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const pitchVideoInputRef = useRef<HTMLInputElement | null>(null);

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 3200); }
  async function loadCrm() {
    const response = await fetch("/api/crm/launch", { cache: "no-store" });
    const json = await response.json() as Payload & { error?: string };
    if (!response.ok) throw new Error(json.error || "CRM konnte nicht geladen werden.");
    setData(json);
    setCallId((current) => current && json.leads.some((lead) => lead.id === current) ? current : json.leads.filter(isCallReady).sort((a, b) => callPriority(b) - callPriority(a))[0]?.id || null);
  }
  async function loadState() {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) return;
    const json = await response.json() as { state?: Partial<Store> };
    const incoming = json.state || {};
    setStore({ ...EMPTY_STORE, ...incoming, campaigns: Array.isArray(incoming.campaigns) && incoming.campaigns.length ? incoming.campaigns : [STARTER], mailboxes: Array.isArray(incoming.mailboxes) ? incoming.mailboxes : [], settings: { ...EMPTY_STORE.settings, ...(incoming.settings || {}) } });
  }
  async function loadInbox() {
    const response = await fetch("/api/inbox", { cache: "no-store" });
    const json = await response.json() as { items?: InboxItem[]; error?: string };
    if (!response.ok) throw new Error(json.error || "Inbox konnte nicht geladen werden.");
    setInbox(json.items || []);
  }
  async function loadMailConfig() {
    try {
      const response = await fetch("/api/mail/config", { cache: "no-store" });
      const json = await response.json() as { items?: Array<{ id: string; email: string; configured: boolean }> };
      if (response.ok) setMailConfig(json.items || []);
    } catch { /* best-effort: campaigns view just shows 0 sendable mailboxes */ }
  }
  async function loadDetail(leadId: string) {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/crm/enrichment?leadId=${encodeURIComponent(leadId)}`, { cache: "no-store" });
      const json = await response.json() as ResearchDetail & { error?: string };
      if (!response.ok) throw new Error(json.error || "Research konnte nicht geladen werden.");
      setDetail(json);
    } catch (e) { notify(e instanceof Error ? e.message : "Research konnte nicht geladen werden."); setDetail(null); }
    finally { setDetailLoading(false); }
  }
  async function refresh() { setBusy("refresh"); setError(""); try { await Promise.all([loadCrm(), loadState(), loadMailConfig()]); } catch (e) { setError(e instanceof Error ? e.message : "Systemfehler"); } finally { setBusy(""); } }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (view === "inbox") void loadInbox().catch((e: unknown) => notify(e instanceof Error ? e.message : "Inbox Fehler")); }, [view]);
  useEffect(() => { if (inspectorId) void loadDetail(inspectorId); else setDetail(null); }, [inspectorId]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "/" && target?.tagName !== "INPUT" && target?.tagName !== "TEXTAREA" && target?.tagName !== "SELECT") {
        event.preventDefault(); setView("crm"); window.setTimeout(() => searchRef.current?.focus(), 20);
      }
      if (event.key === "Escape") { setInspectorId(null); setCreateOpen(false); setMobileNav(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return data.leads.filter((lead) => {
      if (stageFilter !== "all" && lead.stage !== stageFilter) return false;
      const quality = researchQuality(lead);
      if (researchFilter === "enriched" && !isEnriched(lead)) return false;
      if (researchFilter === "missing" && isEnriched(lead)) return false;
      if (researchFilter === "weak" && quality >= 65) return false;
      if (!q) return true;
      const e = enrichmentOf(lead);
      return [lead.company, lead.contact, lead.email, lead.phone, lead.city, lead.industry, lead.stage, lead.notes, lead.next_action, e.linkedin, e.instagram, e.careersPage, ...(e.signals || [])].join(" ").toLowerCase().includes(q);
    });
  }, [data.leads, deferredQuery, stageFilter, researchFilter]);
  const callQueue = useMemo(() => data.leads.filter(isCallReady).sort((a, b) => callPriority(b) - callPriority(a)), [data.leads]);
  const callLead = useMemo(() => callQueue.find((lead) => lead.id === callId) || callQueue[0] || null, [callQueue, callId]);
  const inspectorLead = useMemo(() => data.leads.find((lead) => lead.id === inspectorId) || null, [data.leads, inspectorId]);
  const selectedCalls = useMemo(() => callLead ? data.calls.history.filter((call) => call.lead_ref === callLead.id).slice(0, 7) : [], [data.calls.history, callLead]);
  const dueLeads = useMemo(() => data.leads.filter((lead) => due(lead) && !["Gewonnen", "Verloren"].includes(lead.stage)).sort((a, b) => new Date(a.next_action_at || 0).getTime() - new Date(b.next_action_at || 0).getTime()), [data.leads]);
  const opportunities = useMemo(() => data.leads.filter((lead) => !["Gewonnen", "Verloren"].includes(lead.stage)).sort((a, b) => b.priority_score - a.priority_score), [data.leads]);
  // store.mailboxes (managed by the Domains & Mail UI) only ever holds a display label and
  // send limit - it has no IMAP/SMTP credentials. Real, sendable mailboxes are the ones
  // configured via /mail (mailConfig, backed by the mailbox_credentials_json secret). Join
  // them by email so campaigns only ever target mailboxes the send-cron can actually use.
  const sendableMailboxes = useMemo(() => {
    const byEmail = new Map(store.mailboxes.map((mailbox) => [mailbox.email.toLowerCase(), mailbox]));
    return mailConfig.filter((entry) => entry.configured).map((entry) => {
      const known = byEmail.get(entry.email.toLowerCase());
      return { id: entry.id, enabled: known?.enabled ?? true, dailyLimit: known?.dailyLimit || 5 };
    });
  }, [mailConfig, store.mailboxes]);
  const activeMailboxes = useMemo(() => sendableMailboxes.filter((mailbox) => mailbox.enabled), [sendableMailboxes]);
  const activePipeline = useMemo(() => data.leads.filter((lead) => lead.stage !== "Verloren"), [data.leads]);
  const enrichmentCoverage = useMemo(() => data.leads.length ? Math.round(data.leads.filter(isEnriched).length / data.leads.length * 100) : 0, [data.leads]);
  const strongResearch = useMemo(() => data.leads.filter((lead) => researchQuality(lead) >= 70).length, [data.leads]);

  async function applyPayload(response: Response) { const json = await response.json() as Payload & { error?: string }; if (!response.ok) throw new Error(json.error || "Änderung fehlgeschlagen."); setData(json); return json; }
  async function patchLead(leadId: string, patch: Record<string, unknown>) { const response = await fetch("/api/crm/launch", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId, ...patch }) }); return applyPayload(response); }
  function openInspector(leadId: string, tab: InspectorTab = "overview") { setInspectorId(leadId); setInspectorTab(tab); }
  function dial(lead: Lead) {
    const number = cleanPhone(lead.phone || enrichmentOf(lead).phone || "");
    if (!number) return notify("Keine Telefonnummer vorhanden.");
    setCallId(lead.id); setView("calls");
    window.dispatchEvent(new CustomEvent("cloudtalk:dial", { detail: { leadId: lead.id, company: lead.company, phone: number } }));
    const anchor = document.createElement("a"); anchor.href = `ct+tel:${number}`; anchor.style.display = "none"; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  }
  async function recordOutcome(outcome: typeof OUTCOMES[number]) {
    if (!callLead) return;
    if (outcome === "Rückruf" && !callbackAt) return notify("Rückrufzeit auswählen.");
    setBusy("outcome");
    const currentIndex = callQueue.findIndex((lead) => lead.id === callLead.id);
    const next = callQueue[currentIndex + 1] || callQueue[0];
    try {
      await patchLead(callLead.id, { outcome, notesAppend: callNote.trim(), callbackAt: callbackAt || "" });
      setCallNote(""); setCallbackAt(""); setCallId(next?.id === callLead.id ? null : next?.id || null); notify(`${outcome} gespeichert · nächster Lead bereit`);
    } catch (e) { notify(e instanceof Error ? e.message : "Ergebnis konnte nicht gespeichert werden."); }
    finally { setBusy(""); }
  }
  async function downloadAuditPdf(lead: Lead) {
    if (!detail?.research?.audit) return notify("Erst Research laden/aktualisieren, dann steht ein PDF zur Verfügung.");
    setBusy("audit-pdf");
    try {
      const response = await fetch("/api/website/audit/pdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audit: detail.research.audit }) });
      if (!response.ok) { const json = await response.json().catch(() => ({})) as { error?: string }; throw new Error(json.error || "PDF konnte nicht erstellt werden."); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${lead.company.replace(/[^a-zA-Z0-9.-]+/g, "-")}-audit.pdf`; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e) { notify(e instanceof Error ? e.message : "PDF konnte nicht erstellt werden."); }
    finally { setBusy(""); }
  }
  async function verifyEmail(lead: Lead) {
    const email = lead.email || enrichmentOf(lead).email; if (!email) return notify("Keine E-Mail-Adresse hinterlegt.");
    setBusy("verify-email");
    try {
      const response = await fetch("/api/email/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const json = await response.json() as { status?: string; checks?: { mx?: boolean; disposable?: boolean; roleAccount?: boolean }; error?: string };
      if (!response.ok) throw new Error(json.error || "E-Mail-Prüfung fehlgeschlagen.");
      const label = json.status === "valid" ? "gültig" : json.status === "risky" ? "riskant (Rollen-Postfach)" : "ungültig (keine MX-Records / Wegwerf-Domain)";
      notify(`${email}: ${label}`);
    } catch (e) { notify(e instanceof Error ? e.message : "E-Mail-Prüfung fehlgeschlagen."); }
    finally { setBusy(""); }
  }
  async function enrich(ids: string[]) {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (!uniqueIds.length) return;
    setBusy("enrich");
    let done = 0, failed = 0;
    try {
      for (let index = 0; index < uniqueIds.length; index += 5) {
        const batch = uniqueIds.slice(index, index + 5);
        const response = await fetch("/api/crm/enrichment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadIds: batch, ai: true }) });
        const json = await response.json() as { results?: Array<{ ok?: boolean }>; error?: string };
        if (!response.ok) throw new Error(json.error || "Research fehlgeschlagen.");
        for (const result of json.results || []) result.ok ? done++ : failed++;
      }
      await loadCrm();
      if (inspectorId && uniqueIds.includes(inspectorId)) await loadDetail(inspectorId);
      setSelectedIds(new Set());
      notify(`${done} Research${done === 1 ? "" : "es"} aktualisiert${failed ? ` · ${failed} mit Fehler` : ""}`);
    } catch (e) { notify(e instanceof Error ? e.message : "Research fehlgeschlagen."); }
    finally { setBusy(""); }
  }
  async function saveInspector(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!inspectorLead) return;
    const form = new FormData(event.currentTarget); setBusy("inspector");
    try {
      await patchLead(inspectorLead.id, {
        stage: String(form.get("stage") || inspectorLead.stage),
        dealValue: Number(form.get("dealValue") || 0),
        probability: Number(form.get("probability") || 0),
        nextAction: String(form.get("nextAction") || ""),
        nextActionAt: String(form.get("nextActionAt") || "") || null,
        expectedCloseDate: String(form.get("expectedCloseDate") || "") || null,
        lostReason: String(form.get("lostReason") || ""),
        notes: String(form.get("notes") || ""),
        doNotContact: form.get("dnc") === "on",
        phoneStatus: String(form.get("phoneStatus") || "ready"),
      });
      await loadDetail(inspectorLead.id); notify("Lead gespeichert.");
    } catch (e) { notify(e instanceof Error ? e.message : "Speichern fehlgeschlagen."); }
    finally { setBusy(""); }
  }
  async function createLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy("create");
    try {
      const response = await fetch("/api/crm/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company: String(form.get("company") || ""), contact: String(form.get("contact") || ""), email: String(form.get("email") || ""), phone: String(form.get("phone") || ""), website: String(form.get("website") || ""), city: String(form.get("city") || ""), industry: "Pflege", notes: String(form.get("notes") || "") }) });
      const payload = await applyPayload(response); setCreateOpen(false); notify("Lead angelegt.");
      const newest = payload.leads.find((lead) => lead.company === String(form.get("company") || "")); if (newest) void enrich([newest.id]);
    } catch (e) { notify(e instanceof Error ? e.message : "Lead konnte nicht angelegt werden."); }
    finally { setBusy(""); }
  }
  async function generateCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy("generate-campaign");
    try {
      const audience = String(form.get("audience") || "").trim();
      const offer = String(form.get("offer") || "").trim();
      const response = await fetch("/api/ai/campaign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audience, offer, sender: store.settings.senderName }) });
      const json = await response.json() as { name?: string; audience?: string; steps?: Step[]; firstStepSubjectVariantB?: string; error?: string };
      if (!response.ok || !json.steps) throw new Error(json.error || "Kampagne konnte nicht erstellt werden.");
      const steps = [...json.steps];
      // Wire the AI's second subject-line angle into an A/B test on the first touch -
      // that's the step where open rate (and therefore the subject line) matters most.
      if (steps[0] && json.firstStepSubjectVariantB) {
        steps[0] = { ...steps[0], variants: [{ label: "A", subject: steps[0].subject, body: steps[0].body }, { label: "B", subject: json.firstStepSubjectVariantB, body: steps[0].body }] };
      }
      const campaign: Campaign = {
        id: crypto.randomUUID(), name: json.name || audience, audience: json.audience || audience,
        status: "Entwurf", dailyLimit: 30, sent: 0, replies: 0, positive: 0, appointments: 0, steps,
      };
      await saveStore({ ...store, campaigns: [...store.campaigns, campaign] });
      setCampaignGenOpen(false);
      notify(`Kampagne "${campaign.name}" erstellt · ${campaign.steps.length} Schritte`);
    } catch (e) { notify(e instanceof Error ? e.message : "Kampagne konnte nicht erstellt werden."); }
    finally { setBusy(""); }
  }
  async function bulkStage(stage: Stage) {
    const ids = [...selectedIds]; if (!ids.length) return; setBusy("bulk");
    try { for (const id of ids) await patchLead(id, { stage }); setSelectedIds(new Set()); notify(`${ids.length} Leads → ${stage}`); }
    catch (e) { notify(e instanceof Error ? e.message : "Bulk-Update fehlgeschlagen."); }
    finally { setBusy(""); }
  }
  async function moveLead(event: DragEvent<HTMLElement>, stage: Stage) { event.preventDefault(); const id = event.dataTransfer.getData("text/lead"); if (!id) return; try { await patchLead(id, { stage }); } catch (e) { notify(e instanceof Error ? e.message : "Pipeline-Update fehlgeschlagen."); } }
  async function searchLeads(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("finder");
    try {
      const response = await fetch("/api/leads/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: leadQuery, pageSize: 20 }) });
      const json = await response.json() as { leads?: FoundLead[]; error?: string };
      if (!response.ok) throw new Error(json.error || "Suche fehlgeschlagen."); setFound(json.leads || []); notify(`${json.leads?.length || 0} Unternehmen gefunden.`);
    } catch (e) { notify(e instanceof Error ? e.message : "Suche fehlgeschlagen."); }
    finally { setBusy(""); }
  }
  async function importLead(foundLead: FoundLead) {
    setBusy(`import-${foundLead.id}`);
    try {
      const response = await fetch("/api/radar/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...foundLead, source: "google-places", workspace: "default" }) });
      const json = await response.json() as { leadId?: string; scores?: { priorityScore?: number }; error?: string };
      if (!response.ok) throw new Error(json.error || "Import fehlgeschlagen.");
      if (json.leadId) await enrich([json.leadId]); else await loadCrm();
      notify(`${foundLead.company} importiert + recherchiert`);
    } catch (e) { notify(e instanceof Error ? e.message : "Import fehlgeschlagen."); }
    finally { setBusy(""); }
  }
  async function saveStore(next: Store) { const response = await fetch("/api/state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) }); if (!response.ok) throw new Error("State konnte nicht gespeichert werden."); setStore(next); }
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy("settings");
    try {
      const settings = {
        companyName: String(form.get("companyName") || "").trim() || store.settings.companyName,
        senderName: String(form.get("senderName") || "").trim() || store.settings.senderName,
        calendarUrl: String(form.get("calendarUrl") || "").trim(),
        timezone: store.settings.timezone,
        pitchVideoUrl: String(form.get("pitchVideoUrl") || "").trim(),
      };
      await saveStore({ ...store, settings });
      notify("Einstellungen gespeichert.");
    } catch (e) { notify(e instanceof Error ? e.message : "Einstellungen konnten nicht gespeichert werden."); }
    finally { setBusy(""); }
  }
  async function uploadPitchVideo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return;
    setBusy("upload-video");
    try {
      const body = new FormData(); body.append("file", file);
      const response = await fetch("/api/studio/upload-video", { method: "POST", body });
      const json = await response.json() as { url?: string; error?: string };
      if (!response.ok || !json.url) throw new Error(json.error || "Upload fehlgeschlagen.");
      if (pitchVideoInputRef.current) pitchVideoInputRef.current.value = json.url;
      notify("Video hochgeladen. Jetzt unten \"Speichern\" klicken, um es zu übernehmen.");
    } catch (e) { notify(e instanceof Error ? e.message : "Upload fehlgeschlagen."); }
    finally { setBusy(""); }
  }
  async function launchCampaign(campaign: Campaign) {
    if (!activeMailboxes.length) return notify("Vor dem E-Mail-Start eine Mailbox unter /mail verbinden (IMAP/SMTP).");
    const leads = data.leads.filter((lead) => lead.email && !lead.do_not_contact && !["Gewonnen", "Verloren"].includes(lead.stage)).map((lead) => ({ id: lead.id, company: lead.company, contact: lead.contact, email: lead.email, phone: lead.phone, website: lead.website, city: lead.city, industry: lead.industry, stage: lead.stage, dealValue: lead.deal_value, notes: lead.notes, intentScore: lead.intent_score }));
    if (!leads.length) return notify("Keine versandfähigen Leads.");
    setBusy(campaign.id);
    try {
      const response = await fetch("/api/campaigns/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaign, leads, mailboxes: sendableMailboxes, senderName: store.settings.senderName }) });
      const json = await response.json() as { queued?: number; skipped?: number; error?: string };
      if (!response.ok) throw new Error(json.error || "Kampagnenstart fehlgeschlagen.");
      await saveStore({ ...store, campaigns: store.campaigns.map((item) => item.id === campaign.id ? { ...item, status: "Aktiv" as const } : item) });
      notify(`${json.queued || 0} Schritte eingeplant · ${json.skipped || 0} übersprungen`);
    } catch (e) { notify(e instanceof Error ? e.message : "Kampagnenstart fehlgeschlagen."); }
    finally { setBusy(""); }
  }

  const titleMap: Record<View, string> = { command: "Command", crm: "CRM", finder: "Lead Finder", calls: "Calls", pipeline: "Pipeline", followups: "Follow-ups", meetings: "Meetings", proposals: "Proposals", campaigns: "Campaigns", inbox: "Inbox", intelligence: "Intelligence", analytics: "Analytics", system: "Integrationen" };
  function selectView(next: View) { setView(next); setMobileNav(false); }

  function StagePill({ stage }: { stage: Stage }) { return <span className={`${styles.stage} ${["Engaged", "Qualifiziert", "Termin", "Angebot", "Verhandlung"].includes(stage) ? styles.stageHot : ""} ${stage === "Gewonnen" ? styles.stageWon : ""} ${stage === "Verloren" ? styles.stageLost : ""}`}>{stage}</span>; }
  function ScoreStack({ lead }: { lead: Lead }) { return <div className={styles.scoreStack}><span title="Priority"><b>P</b>{lead.priority_score}</span><span title="Opportunity"><b>O</b>{lead.opportunity_score}</span><span title="Fit"><b>F</b>{lead.fit_score}</span></div>; }
  function ResearchCell({ lead }: { lead: Lead }) {
    const e = enrichmentOf(lead); const quality = researchQuality(lead);
    return <div className={styles.researchCell}><div className={styles.qualityLine}><span className={`${styles.researchDot} ${quality >= 70 ? styles.dotGood : quality > 0 ? styles.dotWarn : ""}`} /><strong>{quality ? `${quality}%` : "offen"}</strong><small>{researchAge(lead)}</small></div><div className={styles.microSignals}>{e.careersPage && <span>K</span>}{(e.atsProviders?.length || 0) > 0 && <span>ATS</span>}{(e.linkedin || e.instagram || e.facebook || e.tiktok) && <span>Social</span>}</div></div>;
  }
  function ContactCell({ lead }: { lead: Lead }) {
    const e = enrichmentOf(lead); const phone = lead.phone || e.phone || ""; const email = lead.email || e.email || "";
    return <div className={styles.contactCell}><strong>{lead.contact || "Ansprechpartner offen"}</strong><small>{phone || email || "keine Kontaktdaten"}</small><div className={styles.inlineLinks}>{phone && <button type="button" onClick={() => dial(lead)}>Call</button>}{email && <a href={`mailto:${email}`}>Mail</a>}{e.linkedin && <a href={e.linkedin} target="_blank" rel="noreferrer">LI</a>}{e.instagram && <a href={e.instagram} target="_blank" rel="noreferrer">IG</a>}</div></div>;
  }
  function SignalCell({ lead }: { lead: Lead }) { const e = enrichmentOf(lead); const signals = e.signals || []; return <div className={styles.signalCell}><strong>{e.brief?.summary || whyNow(lead)}</strong><small>{signals.slice(0, 2).join(" · ") || "Research noch nicht vollständig"}</small></div>; }

  function LeadTable({ rows = filtered, selectable = true }: { rows?: Lead[]; selectable?: boolean }) {
    const all = rows.length > 0 && rows.every((lead) => selectedIds.has(lead.id));
    return <div className={styles.tableWrap}><table className={styles.crmTable}><thead><tr>{selectable && <th className={styles.checkCol}><input type="checkbox" checked={all} onChange={() => setSelectedIds((current) => { const next = new Set(current); if (all) rows.forEach((lead) => next.delete(lead.id)); else rows.forEach((lead) => next.add(lead.id)); return next; })} aria-label="Alle auswählen" /></th>}<th>Unternehmen</th><th>Research</th><th>Kontakt</th><th>Akquise-Signal</th><th>Scores</th><th>Status</th><th>Nächste Aktion</th><th className={styles.actionCol}>Aktion</th></tr></thead><tbody>{rows.map((lead) => <tr key={lead.id} onDoubleClick={() => openInspector(lead.id)}>{selectable && <td><input type="checkbox" checked={selectedIds.has(lead.id)} onChange={() => setSelectedIds((current) => { const next = new Set(current); next.has(lead.id) ? next.delete(lead.id) : next.add(lead.id); return next; })} /></td>}<td><button className={styles.companyButton} type="button" onClick={() => openInspector(lead.id)}><strong>{lead.company}</strong><small>{[lead.city, lead.industry].filter(Boolean).join(" · ")}</small></button></td><td><ResearchCell lead={lead} /></td><td><ContactCell lead={lead} /></td><td><SignalCell lead={lead} /></td><td><ScoreStack lead={lead} /></td><td><select className={styles.inlineSelect} value={lead.stage} onChange={(e) => void patchLead(lead.id, { stage: e.target.value })}>{STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select></td><td><div className={`${styles.nextCell} ${due(lead) ? styles.nextDue : ""}`}><strong>{lead.next_action || "—"}</strong><small>{fmtDate(lead.next_action_at, true)}{lead.last_contact_at ? ` · Touch ${fmtDate(lead.last_contact_at)}` : ""}</small></div></td><td><div className={styles.rowActions}><button title="Research aktualisieren" type="button" onClick={() => void enrich([lead.id])} disabled={busy === "enrich"}>◈</button>{(lead.phone || enrichmentOf(lead).phone) && <button title="Anrufen" type="button" onClick={() => dial(lead)}>◉</button>}<button title="Inspector" type="button" onClick={() => openInspector(lead.id)}>›</button></div></td></tr>)}</tbody></table>{!rows.length && <div className={styles.empty}><span>◎</span><b>Noch keine Leads in dieser Ansicht</b><small>Sobald DG Core neue 1A-Kandidaten qualifiziert oder du den Filter änderst, tauchen sie hier auf.</small></div>}</div>;
  }

  function MetricStrip() {
    const connectRate = data.calls.today ? Math.round(data.calls.connected / data.calls.today * 100) : 0;
    return <div className={styles.metricStrip}><div><span>Pipeline</span><strong>{euro(data.stats.pipeline)}</strong><small>{euro(data.stats.weighted_pipeline)} weighted</small></div><div><span>Fällige Actions</span><strong>{data.stats.due_actions}</strong><small>{dueLeads.length} heute/überfällig</small></div><div><span>Calls heute</span><strong>{data.calls.today}</strong><small>{connectRate}% Connect</small></div><div><span>Meetings</span><strong>{data.calls.meetings}</strong><small>{data.calls.interested} Interesse+</small></div><div><span>Research</span><strong>{enrichmentCoverage}%</strong><small>{strongResearch} stark angereichert</small></div><div><span>Hot Leads</span><strong>{data.stats.hot}</strong><small>Priority ≥ 70</small></div></div>;
  }

  function Funnel() {
    const rows: Array<[string, number]> = [
      ["Neu/Bereit", data.leads.filter((lead) => ["Neu", "Research", "Bereit"].includes(lead.stage)).length],
      ["Kontaktiert", data.leads.filter((lead) => lead.stage === "Kontaktiert").length],
      ["Engaged", data.leads.filter((lead) => ["Engaged", "Qualifiziert"].includes(lead.stage)).length],
      ["Termin", data.leads.filter((lead) => lead.stage === "Termin").length],
      ["Angebot", data.leads.filter((lead) => ["Angebot", "Verhandlung"].includes(lead.stage)).length],
      ["Won", data.leads.filter((lead) => lead.stage === "Gewonnen").length],
    ];
    const max = Math.max(1, ...rows.map(([, value]) => value));
    return <div className={styles.funnel}>{rows.map(([label, value]) => <div key={label}><span>{label}</span><div><i style={{ width: `${Math.max(3, Math.round(value / max * 100))}%` }} /></div><strong>{value}</strong></div>)}</div>;
  }

  function ActivityList({ items }: { items: Activity[] }) {
    return <div className={styles.activityList}>{items.map((item) => <div className={styles.activity} key={item.id}><span>{item.type.includes("call") ? "◉" : item.type.includes("enrichment") ? "◈" : item.type.includes("studio") ? "▶" : "·"}</span><div><strong>{item.summary}</strong><small>{fmtDate(item.created_at, true)}</small></div></div>)}{!items.length && <div className={styles.empty}><span>◇</span><b>Noch keine Aktivitäten</b><small>Calls, Research-Läufe und Studio-Aktionen erscheinen hier live, sobald das Team loslegt.</small></div>}</div>;
  }

  const nav = <aside className={`${styles.sidebar} ${mobileNav ? styles.sidebarOpen : ""}`}><div className={styles.brand}><span>DG</span><div><strong>Digitale Gewinner</strong><small>PFLEGE · SALES OS</small></div></div><nav>{NAV.map((group) => <div className={styles.navGroup} key={group.label}><label>{group.label}</label>{group.items.map((item) => item.href ? <a key={item.label} href={item.href}><i>{item.mark}</i><span>{item.label}</span>{item.badge && <b>{item.badge}</b>}</a> : <button key={item.label} type="button" className={view === item.id ? styles.navActive : ""} onClick={() => item.id && selectView(item.id)}><i>{item.mark}</i><span>{item.label}</span>{item.badge && <b>{item.badge}</b>}</button>)}</div>)}</nav><footer><span className={styles.statusDot} /> Production · {data.leads.length} Leads</footer></aside>;

  return <div className={styles.root}>
    {mobileNav && <button className={styles.mobileBackdrop} onClick={() => setMobileNav(false)} aria-label="Navigation schließen" />}
    <div className={styles.shell}>{nav}<section className={styles.workspace}>
      <header className={styles.topbar}><div className={styles.topLeft}><button className={styles.mobileButton} type="button" onClick={() => setMobileNav(true)}>☰</button><div><span>PFLEGE SALES OS</span><h1>{titleMap[view]}</h1></div></div><div className={styles.topActions}><button type="button" onClick={() => { setView("crm"); window.setTimeout(() => searchRef.current?.focus(), 20); }} className={styles.commandSearch}>⌕ <span>Search CRM</span><kbd>/</kbd></button><button className={styles.quietButton} type="button" onClick={() => void refresh()} disabled={Boolean(busy)}>Refresh</button><button className={styles.primaryButton} type="button" onClick={() => setCreateOpen(true)}>New lead</button></div></header>
      <main className={styles.content} id="main-sales-os">
        {error && <div className={styles.error}>{error}</div>}

        {view === "command" && <><div className={styles.pageHead}><div><span>DAILY COMMAND CENTER</span><h2>Die nächste sinnvolle Aktion, nicht mehr Dashboard.</h2><p>Research, Follow-ups, Calls und Pipeline in einer kompakten Arbeitsansicht.</p></div><button className={styles.primaryButton} type="button" onClick={() => selectView("calls")}>Start call session</button></div><MetricStrip /><div className={styles.commandGrid}><section className={styles.panel}><div className={styles.panelHead}><div><span>NEXT BEST ACTION</span><h3>Priorisierte Leads</h3></div><button type="button" onClick={() => selectView("crm")}>Open CRM</button></div><LeadTable rows={opportunities.slice(0, 10)} selectable={false} /></section><aside className={styles.sideStack}><section className={styles.panel}><div className={styles.panelHead}><div><span>DUE NOW</span><h3>Follow-ups</h3></div><b>{dueLeads.length}</b></div><div className={styles.compactList}>{dueLeads.slice(0, 9).map((lead) => <button type="button" key={lead.id} onClick={() => openInspector(lead.id)}><div><strong>{lead.company}</strong><small>{lead.next_action || "Follow-up"} · {fmtDate(lead.next_action_at, true)}</small></div><span>{lead.phone ? "◉" : "›"}</span></button>)}{!dueLeads.length && <div className={styles.empty}>Alles sauber.</div>}</div></section><section className={styles.panel}><div className={styles.panelHead}><div><span>RESEARCH COVERAGE</span><h3>{enrichmentCoverage}% angereichert</h3></div><button type="button" onClick={() => selectView("intelligence")}>Details</button></div><div className={styles.coverageBar}><i style={{ width: `${enrichmentCoverage}%` }} /></div><p className={styles.panelNote}>{data.leads.filter((lead) => !isEnriched(lead)).length} Leads ohne vollständigen Research-Lauf.</p></section></aside></div><div className={styles.twoPanels}><section className={styles.panel}><div className={styles.panelHead}><div><span>FUNNEL</span><h3>Pipeline movement</h3></div></div><Funnel /></section><section className={styles.panel}><div className={styles.panelHead}><div><span>ACTIVITY</span><h3>Live feed</h3></div></div><ActivityList items={data.activities.slice(0, 12)} /></section></div></>}

        {view === "crm" && <><div className={styles.pageHead}><div><span>CRM</span><h2>Research-first Sales CRM.</h2><p>Firma, Kontakte, Socials, Karriere, ATS, Website-Audit, Scores und nächste Aktion direkt in einer Zeile.</p></div><div className={styles.pageHeadActions}><button className={styles.quietButton} type="button" onClick={() => void enrich(filtered.filter((lead) => !isEnriched(lead)).slice(0, 5).map((lead) => lead.id))} disabled={busy === "enrich"}>Enrich next 5</button></div></div><section className={styles.panel}><div className={styles.crmToolbar}><div className={styles.searchBox}>⌕<input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Firma, Kontakt, Ort, Signal, Social …" /></div><select value={stageFilter} onChange={(e) => setStageFilter(e.target.value as "all" | Stage)}><option value="all">All stages</option>{STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select><select value={researchFilter} onChange={(e) => setResearchFilter(e.target.value as typeof researchFilter)}><option value="all">All research</option><option value="enriched">Enriched</option><option value="missing">Missing research</option><option value="weak">Weak coverage</option></select><span className={styles.resultCount}>{filtered.length}</span></div>{selectedIds.size > 0 && <div className={styles.bulkBar}><strong>{selectedIds.size} selected</strong><button type="button" onClick={() => void enrich([...selectedIds])} disabled={busy === "enrich"}>◈ Enrich</button><select defaultValue="" onChange={(e) => { const stage = e.target.value as Stage; if (stage) void bulkStage(stage); e.currentTarget.value = ""; }}><option value="">Set stage…</option>{STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select><button type="button" onClick={() => setSelectedIds(new Set())}>Clear</button></div>}<LeadTable /></section></>}

        {view === "finder" && <><div className={styles.pageHead}><div><span>LEAD FINDER</span><h2>Google Places → Research → CRM.</h2><p>Neue Pflegebetriebe werden nicht nur importiert, sondern direkt recherchiert und scored.</p></div></div><section className={styles.panel}><form className={styles.finderSearch} onSubmit={searchLeads}><div className={styles.searchBox}>⌕<input value={leadQuery} onChange={(e) => setLeadQuery(e.target.value)} placeholder="Pflegedienst Stuttgart" /></div><button className={styles.primaryButton} disabled={busy === "finder"}>Search</button></form><div className={styles.tableWrap}><table className={styles.finderTable}><thead><tr><th>Unternehmen</th><th>Ort</th><th>Telefon</th><th>Website</th><th></th></tr></thead><tbody>{found.map((lead) => <tr key={lead.id}><td><strong>{lead.company}</strong><small>{lead.industry}</small></td><td>{lead.city}</td><td>{lead.phone || "—"}</td><td>{lead.website ? <a href={lead.website} target="_blank" rel="noreferrer">{lead.website.replace(/^https?:\/\//, "").slice(0, 34)}</a> : "—"}</td><td><button type="button" className={styles.primaryTiny} onClick={() => void importLead(lead)} disabled={busy === `import-${lead.id}` || busy === "enrich"}>Import + Research</button></td></tr>)}</tbody></table>{!found.length && <div className={styles.empty}>Suche starten, um Pflegebetriebe zu finden.</div>}</div></section></>}

        {view === "calls" && <><div className={styles.pageHead}><div><span>CALL SESSION</span><h2>Call. Outcome. Next.</h2><p>Research-Brief und Kontaktsignale bleiben während des Gesprächs sichtbar.</p></div><div className={styles.pageHeadActions}><span className={styles.softBadge}>{callQueue.length} ready</span><span className={styles.softBadge}>{data.calls.today} today</span></div></div><div className={styles.callLayout}><section className={styles.panel}><div className={styles.callQueueHead}><span>Priority queue</span><strong>{callQueue.length}</strong></div><div className={styles.callQueue}>{callQueue.map((lead) => { const e = enrichmentOf(lead); return <button type="button" key={lead.id} className={callLead?.id === lead.id ? styles.callQueueActive : ""} onClick={() => setCallId(lead.id)}><div className={styles.priorityNumber}>{lead.priority_score}</div><div><strong>{lead.company}</strong><small>{[lead.contact, lead.city].filter(Boolean).join(" · ")}</small><span>{e.brief?.summary || whyNow(lead)}</span></div><ResearchCell lead={lead} /></button>; })}</div></section><aside className={`${styles.panel} ${styles.callPanel}`}>{callLead ? <><div className={styles.callPanelHead}><div><span>NOW CALLING</span><h3>{callLead.company}</h3><p>{[callLead.contact, callLead.city].filter(Boolean).join(" · ")}</p></div><div className={styles.priorityNumber}>{callLead.priority_score}</div></div><div className={styles.callBrief}><label>Research brief</label><p>{whyNow(callLead)}</p></div><div className={styles.callLinks}><button type="button" onClick={() => dial(callLead)}>◉ CloudTalk</button><button type="button" onClick={() => openInspector(callLead.id, "research")}>◈ Research</button>{callLead.website && <a href={callLead.website} target="_blank" rel="noreferrer">Website ↗</a>}</div><div className={styles.script}><label>Opener</label><p>{opener(callLead)}</p></div><div className={styles.callForm}><textarea value={callNote} onChange={(e) => setCallNote(e.target.value)} placeholder="Notiz während des Calls …" /><input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} /></div><div className={styles.outcomes}>{OUTCOMES.map((outcome) => <button key={outcome} type="button" className={["Interesse", "Termin", "Angebot senden"].includes(outcome) ? styles.outcomePositive : ""} onClick={() => void recordOutcome(outcome)} disabled={busy === "outcome"}>{outcome}</button>)}</div><div className={styles.recentCalls}>{selectedCalls.slice(0, 5).map((call) => <div key={call.id}><span>{call.direction === "incoming" ? "IN" : "OUT"}</span><strong>{call.status}</strong><small>{fmtDate(call.started_at, true)} · {call.duration_seconds}s</small></div>)}</div></> : <div className={styles.empty}>Keine call-ready Leads.</div>}</aside></div></>}

        {view === "pipeline" && <><div className={styles.pageHead}><div><span>PIPELINE</span><h2>Deals ohne CRM-Theater.</h2><p>Drag & Drop, Dealwert, Wahrscheinlichkeit und Next Action kompakt.</p></div><div className={styles.pageHeadActions}><span className={styles.softBadge}>{euro(data.stats.pipeline)}</span><span className={styles.softBadge}>{euro(data.stats.weighted_pipeline)} weighted</span></div></div><div className={styles.pipeline}>{PIPELINE.map((stage) => <section key={stage} onDragOver={(e) => e.preventDefault()} onDrop={(e) => void moveLead(e, stage)}><header><strong>{stage}</strong><span>{activePipeline.filter((lead) => lead.stage === stage).length}</span></header>{activePipeline.filter((lead) => lead.stage === stage).map((lead) => <button key={lead.id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData("text/lead", lead.id)} onClick={() => openInspector(lead.id, "deal")}><strong>{lead.company}</strong><span>{lead.deal_value ? euro(lead.deal_value) : "Value open"} · {lead.probability}%</span><small>{lead.next_action || whyNow(lead)}</small><div className={styles.cardMeta}><i>{lead.priority_score}</i><ResearchCell lead={lead} /></div></button>)}</section>)}</div></>}

        {view === "followups" && <><div className={styles.pageHead}><div><span>FOLLOW-UPS</span><h2>Kein warmer Lead verschwindet.</h2><p>Fälligkeit, letzter Touch und Research-Kontext in einer Liste.</p></div></div><section className={styles.panel}><LeadTable rows={data.leads.filter((lead) => lead.next_action || lead.next_action_at).sort((a, b) => new Date(a.next_action_at || "2999-01-01").getTime() - new Date(b.next_action_at || "2999-01-01").getTime())} selectable={false} /></section></>}
        {view === "meetings" && <><div className={styles.pageHead}><div><span>MEETINGS</span><h2>Vorbereitung statt Kalenderliste.</h2><p>Research und Deal-Kontext für jeden anstehenden Termin.</p></div></div><section className={styles.panel}><LeadTable rows={data.leads.filter((lead) => lead.stage === "Termin")} selectable={false} /></section></>}
        {view === "proposals" && <><div className={styles.pageHead}><div><span>PROPOSALS</span><h2>Angebote & Verhandlung.</h2><p>Offene Deals nach Wert, Probability und Next Action.</p></div></div><section className={styles.panel}><LeadTable rows={data.leads.filter((lead) => ["Angebot", "Verhandlung"].includes(lead.stage))} selectable={false} /></section></>}

        {view === "campaigns" && <><div className={styles.pageHead}><div><span>CAMPAIGNS</span><h2>Outbound-Sequenzen.</h2><p>Mailboxen, Versandlimit, Replies und Meetings ohne übergroße Cards.</p></div><div className={styles.pageHeadActions}><span className={styles.softBadge}>{activeMailboxes.length} active mailboxes</span><button className={styles.primaryButton} type="button" onClick={() => setCampaignGenOpen(true)}>+ Neue Kampagne</button></div></div><section className={styles.panel}><div className={styles.tableWrap}><table className={styles.campaignTable}><thead><tr><th>Campaign</th><th>Audience</th><th>Status</th><th>Sequence</th><th>Sent</th><th>Replies</th><th>Positive</th><th>Meetings</th><th></th></tr></thead><tbody>{store.campaigns.map((campaign) => { const live = data.campaignStats?.[campaign.id]; const variants = data.campaignVariantStats?.[campaign.id] || []; return [
          <tr key={campaign.id}><td><strong>{campaign.name}</strong></td><td>{campaign.audience}</td><td><span className={styles.softBadge}>{campaign.status}</span></td><td>{campaign.steps.length} steps · {campaign.dailyLimit}/d</td><td>{live?.sent ?? campaign.sent ?? 0}</td><td>{live?.replies ?? campaign.replies ?? 0}</td><td>{live?.positive ?? campaign.positive ?? 0}</td><td>{live?.appointments ?? campaign.appointments ?? 0}</td><td><button className={styles.primaryTiny} type="button" onClick={() => void launchCampaign(campaign)} disabled={busy === campaign.id} title={campaign.status === "Aktiv" ? "Bereits enrollte Leads werden übersprungen - nur neue Leads werden ergänzt." : undefined}>{busy === campaign.id ? "Startet…" : campaign.status === "Aktiv" ? "Neue Leads ergänzen" : "Launch"}</button></td></tr>,
          variants.length > 1 && <tr key={`${campaign.id}-variants`}><td colSpan={9} style={{ padding: "6px 10px", fontSize: 11, color: "#6b7280", background: "rgba(0,0,0,.02)" }}>A/B Betreffzeile: {variants.map((v) => `${v.variant} ${v.sent} gesendet · ${v.replies} Antworten${v.sent ? ` (${Math.round(v.replies / v.sent * 100)}%)` : ""}`).join("  ·  ")}</td></tr>,
        ]; })}</tbody></table></div></section></>}

        {view === "inbox" && <><div className={styles.pageHead}><div><span>UNIFIED INBOX</span><h2>Replies mit CRM-Kontext.</h2><p>Antworten direkt mit Lead und Stage verknüpft.</p></div><button className={styles.quietButton} type="button" onClick={() => void loadInbox()}>Refresh inbox</button></div><section className={styles.panel}><div className={styles.inboxList}>{inbox.map((item) => <button key={item.id} type="button" onClick={() => item.leadId && openInspector(item.leadId, "timeline")}><span>✉</span><div><strong>{item.company || item.from}</strong><p>{item.subject}</p><small>{item.from} · {fmtDate(item.createdAt, true)}</small></div><StagePill stage={(STAGES.includes(item.stage as Stage) ? item.stage : "Kontaktiert") as Stage} /></button>)}{!inbox.length && <div className={styles.empty}>Noch keine Antworten.</div>}</div></section></>}

        {view === "intelligence" && <><div className={styles.pageHead}><div><span>INTELLIGENCE</span><h2>Research Coverage & Recruiting Gaps.</h2><p>Welche Firmen sind sauber angereichert, wo fehlen Entscheiderdaten und wo ist der Recruiting-Hebel am stärksten?</p></div><button className={styles.primaryButton} type="button" onClick={() => void enrich(data.leads.filter((lead) => researchQuality(lead) < 60).slice(0, 5).map((lead) => lead.id))} disabled={busy === "enrich"}>Enrich weakest 5</button></div><MetricStrip /><section className={styles.panel}><div className={styles.tableWrap}><table className={styles.intelTable}><thead><tr><th>Unternehmen</th><th>Coverage</th><th>Website</th><th>Contact</th><th>Fit</th><th>Opportunity</th><th>Priority</th><th>Career / ATS / Social</th><th></th></tr></thead><tbody>{[...data.leads].sort((a, b) => b.priority_score - a.priority_score).map((lead) => { const e = enrichmentOf(lead); return <tr key={lead.id}><td><button className={styles.companyButton} type="button" onClick={() => openInspector(lead.id, "research")}><strong>{lead.company}</strong><small>{lead.city}</small></button></td><td><ResearchCell lead={lead} /></td><td><b>{lead.website_score}</b></td><td><b>{lead.email || e.email ? 100 : lead.phone || e.phone ? 65 : 20}</b></td><td><b>{lead.fit_score}</b></td><td><b>{lead.opportunity_score}</b></td><td><b>{lead.priority_score}</b></td><td><div className={styles.signalTags}>{e.careersPage ? <span>Career</span> : <em>No career</em>}{e.atsProviders?.map((ats) => <span key={ats}>{ats}</span>)}{(e.linkedin || e.instagram || e.facebook || e.tiktok) ? <span>Social</span> : <em>No social</em>}</div></td><td><button className={styles.primaryTiny} type="button" onClick={() => void enrich([lead.id])}>Refresh</button></td></tr>; })}</tbody></table></div></section></>}

        {view === "analytics" && <><div className={styles.pageHead}><div><span>REVENUE ANALYTICS</span><h2>Nur die Zahlen, die Entscheidungen ändern.</h2><p>Connect Rate, Meetings, Pipeline, Research Coverage und Funnel.</p></div></div><MetricStrip /><div className={styles.twoPanels}><section className={styles.panel}><div className={styles.panelHead}><div><span>FUNNEL</span><h3>Sales conversion</h3></div></div><Funnel /></section><section className={styles.panel}><div className={styles.panelHead}><div><span>RECENT EVENTS</span><h3>Activity</h3></div></div><ActivityList items={data.activities.slice(0, 18)} /></section></div></>}

        {view === "system" && <><div className={styles.pageHead}><div><span>INTEGRATIONS</span><h2>Operative Infrastruktur.</h2><p>Telefonie, Domains/Mailboxen, Studio und Research-Stack am selben CRM.</p></div></div><section className={styles.panel}><div className={styles.integrationRows}><div><span>CloudTalk</span><strong>Phone + Click-to-Dial + Call events</strong><small>{data.calls.today} calls today</small><button type="button" onClick={() => window.dispatchEvent(new Event("cloudtalk:open"))}>Open</button></div><div><span>Domains & Mail</span><strong>{sendableMailboxes.length} sendefähig · {activeMailboxes.length} aktiv</strong><small>DNS health, sender inventory, deliverability</small><button type="button" onClick={() => window.dispatchEvent(new Event("domainmail:open"))}>Open</button></div><div><span>Studio V3</span><strong>Personalized video + landing page workspace</strong><small>Lead-scoped creative production</small><a href="/studio">Open ↗</a></div><div><span>Research</span><strong>{enrichmentCoverage}% coverage</strong><small>Places + website + contacts + social + career + ATS + audit + AI brief</small><button type="button" onClick={() => selectView("intelligence")}>Open</button></div></div></section><section className={styles.panel}><div className={styles.panelHead}><div><span>ABSENDER & ANALYSE-SEITE</span><h3>Einstellungen</h3></div></div><form className={styles.dealForm} onSubmit={saveSettings}><div className={styles.formGrid}><label>Firmenname<input name="companyName" defaultValue={store.settings.companyName} /></label><label>Absendername<input name="senderName" defaultValue={store.settings.senderName} /></label><label>Kalender-Link (Termin buchen)<input name="calendarUrl" defaultValue={store.settings.calendarUrl} placeholder="https://cal.com/..." /></label></div><label className={styles.fullField}>Pitch-Video<input ref={pitchVideoInputRef} name="pitchVideoUrl" defaultValue={store.settings.pitchVideoUrl || ""} placeholder="https://.../pitch.mp4 · oder Datei hochladen" /><span style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}><input type="file" accept="video/*" onChange={uploadPitchVideo} disabled={busy === "upload-video"} style={{ fontSize: 11 }} />{busy === "upload-video" && <small>Lädt hoch…</small>}</span></label><p className={styles.mutedText}>Ein Video für alle Leads · erscheint auf jeder Analyse-Seite (/a/&lt;leadId&gt;) neben der echten, live eingebetteten Website des jeweiligen Leads.</p><footer><button className={styles.primaryButton} disabled={busy === "settings"}>{busy === "settings" ? "Speichert…" : "Speichern"}</button></footer></form></section></>}
      </main>
    </section></div>

    {inspectorLead && <><button className={styles.inspectorBackdrop} type="button" onClick={() => setInspectorId(null)} aria-label="Inspector schließen" /><aside className={styles.inspector}><header><div><span>LEAD RECORD</span><h2>{inspectorLead.company}</h2><p>{[inspectorLead.contact, inspectorLead.city].filter(Boolean).join(" · ") || inspectorLead.industry}</p></div><button type="button" onClick={() => setInspectorId(null)}>×</button></header><div className={styles.inspectorActions}>{(inspectorLead.phone || enrichmentOf(inspectorLead).phone) && <button type="button" className={styles.primaryTiny} onClick={() => dial(inspectorLead)}>◉ Call</button>}<button type="button" onClick={() => void enrich([inspectorLead.id])} disabled={busy === "enrich"}>◈ {isEnriched(inspectorLead) ? "Refresh research" : "Enrich"}</button>{detail?.research?.audit && <button type="button" onClick={() => void downloadAuditPdf(inspectorLead)} disabled={busy === "audit-pdf"}>{busy === "audit-pdf" ? "Erstellt PDF…" : "📄 Audit-PDF"}</button>}{(inspectorLead.email || enrichmentOf(inspectorLead).email) && <button type="button" onClick={() => void verifyEmail(inspectorLead)} disabled={busy === "verify-email"}>{busy === "verify-email" ? "Prüft…" : "✉ E-Mail prüfen"}</button>}<a href={`/studio?leadId=${encodeURIComponent(inspectorLead.id)}`}>▶ Studio</a>{(inspectorLead.website || enrichmentOf(inspectorLead).website) && <a href={inspectorLead.website || enrichmentOf(inspectorLead).website} target="_blank" rel="noreferrer">Website ↗</a>}</div><nav className={styles.inspectorTabs}>{(["overview", "research", "timeline", "deal"] as InspectorTab[]).map((tab) => <button type="button" key={tab} className={inspectorTab === tab ? styles.inspectorTabActive : ""} onClick={() => setInspectorTab(tab)}>{tab === "overview" ? "Overview" : tab === "research" ? "Research" : tab === "timeline" ? "Timeline" : "Deal"}</button>)}</nav><div className={styles.inspectorBody}>{detailLoading && <div className={styles.loadingLine}>Loading research…</div>}{inspectorTab === "overview" && <OverviewInspector lead={inspectorLead} detail={detail} />}{inspectorTab === "research" && <ResearchInspector lead={inspectorLead} detail={detail} />}{inspectorTab === "timeline" && <TimelineInspector lead={inspectorLead} detail={detail} />}{inspectorTab === "deal" && <DealInspector lead={inspectorLead} onSubmit={saveInspector} busy={busy === "inspector"} />}</div></aside></>}

    {createOpen && <div className={styles.modalBackdrop} onMouseDown={(e) => { if (e.currentTarget === e.target) setCreateOpen(false); }}><section className={styles.modal}><header><div><span>NEW LEAD</span><h3>Pflege-Lead anlegen</h3></div><button type="button" onClick={() => setCreateOpen(false)}>×</button></header><form onSubmit={createLead}><div className={styles.formGrid}><label>Unternehmen *<input name="company" required /></label><label>Ansprechpartner<input name="contact" /></label><label>E-Mail<input name="email" type="email" /></label><label>Telefon<input name="phone" /></label><label>Website<input name="website" /></label><label>Ort<input name="city" /></label></div><label className={styles.fullField}>Notiz<textarea name="notes" /></label><footer><button type="button" onClick={() => setCreateOpen(false)}>Cancel</button><button className={styles.primaryButton} disabled={busy === "create"}>Create + Research</button></footer></form></section></div>}
    {campaignGenOpen && <div className={styles.modalBackdrop} onMouseDown={(e) => { if (e.currentTarget === e.target) setCampaignGenOpen(false); }}><section className={styles.modal}><header><div><span>AI CAMPAIGN</span><h3>Kampagne generieren</h3></div><button type="button" onClick={() => setCampaignGenOpen(false)}>×</button></header><form onSubmit={generateCampaign}><div className={styles.formGrid}><label className={styles.fullField}>Zielgruppe *<input name="audience" required placeholder="Pflegedienste in Bayern ohne moderne Website" /></label></div><label className={styles.fullField}>Angebot / Produkt<textarea name="offer" placeholder="Wir bauen moderne Websites für Pflegedienste, die mehr Bewerber und Anfragen bringen." /></label><footer><button type="button" onClick={() => setCampaignGenOpen(false)}>Cancel</button><button className={styles.primaryButton} disabled={busy === "generate-campaign"}>{busy === "generate-campaign" ? "Generiere…" : "Kampagne generieren"}</button></footer></form></section></div>}
    {toast && <div className={styles.toast}>{toast}</div>}
  </div>;
}

function OverviewInspector({ lead, detail }: { lead: Lead; detail: ResearchDetail | null }) {
  const e = enrichmentOf(lead);
  const brief = e.brief;
  const socials = [["LinkedIn", e.linkedin], ["Instagram", e.instagram], ["Facebook", e.facebook], ["TikTok", e.tiktok], ["YouTube", e.youtube], ["Xing", e.xing]].filter((item) => item[1]);
  return <div className={styles.inspectorStack}><section className={styles.recordSection}><label>Research brief</label><p className={styles.bigCopy}>{brief?.summary || detail?.research?.summary || "Noch kein vollständiger Research-Brief vorhanden."}</p>{brief?.personalizationPoints?.length ? <ul className={styles.bulletList}>{brief.personalizationPoints.map((point) => <li key={point}>{point}</li>)}</ul> : null}</section><section className={styles.recordSection}><label>Contact</label><div className={styles.recordRows}><div><span>Name</span><strong>{lead.contact || detail?.contact?.name || "offen"}</strong></div><div><span>Telefon</span><strong>{lead.phone || e.phone || detail?.contact?.phone || "—"}</strong></div><div><span>E-Mail</span><strong>{lead.email || e.email || detail?.contact?.email || "—"}</strong></div><div><span>Decision maker</span><strong>{brief?.likelyDecisionMaker || "PDL / Einrichtungsleitung / Geschäftsführung prüfen"}</strong></div></div></section><section className={styles.recordSection}><label>Public presence</label><div className={styles.linkGrid}>{e.careersPage && <a href={e.careersPage} target="_blank" rel="noreferrer">Career page ↗</a>}{e.jobsPage && <a href={e.jobsPage} target="_blank" rel="noreferrer">Jobs page ↗</a>}{e.teamPage && <a href={e.teamPage} target="_blank" rel="noreferrer">Team page ↗</a>}{e.contactPage && <a href={e.contactPage} target="_blank" rel="noreferrer">Contact page ↗</a>}{socials.map(([label, url]) => <a key={label as string} href={url as string} target="_blank" rel="noreferrer">{label} ↗</a>)}</div>{!e.careersPage && !e.jobsPage && !socials.length && <p className={styles.mutedText}>Noch keine verwertbaren Presence-Signale gespeichert.</p>}</section><section className={styles.recordSection}><label>Next research step</label><p>{brief?.nextResearchStep || "Konkreten Ansprechpartner ergänzen und öffentliche Recruiting-Signale prüfen."}</p></section></div>;
}

function ResearchInspector({ lead, detail }: { lead: Lead; detail: ResearchDetail | null }) {
  const e = enrichmentOf(lead); const audit = auditFrom(detail); const scores = audit?.scores || {};
  const scoreRows = [["Website", Number(scores.overall ?? lead.website_score)], ["Conversion", Number(scores.conversion ?? 0)], ["Trust", Number(scores.trust ?? 0)], ["SEO", Number(scores.seo ?? 0)], ["Technical", Number(scores.technical ?? 0)]];
  return <div className={styles.inspectorStack}><section className={styles.recordSection}><div className={styles.researchHeader}><div><label>Data coverage</label><strong>{researchQuality(lead)}%</strong><small>{e.enrichedAt ? `updated ${fmtDate(e.enrichedAt, true)}` : "not enriched"}</small></div><div><label>Priority</label><strong>{lead.priority_score}</strong><small>Opportunity {lead.opportunity_score} · Fit {lead.fit_score}</small></div></div></section><section className={styles.recordSection}><label>Website audit</label><div className={styles.auditScores}>{scoreRows.map(([label, score]) => <div key={String(label)}><span>{label}</span><div><i style={{ width: `${clamp(Number(score))}%` }} /></div><strong>{score}</strong></div>)}</div></section><section className={styles.recordSection}><label>Recruiting stack</label><div className={styles.signalTags}>{e.careersPage ? <span>Career page</span> : <em>No career page</em>}{e.jobsPage ? <span>Jobs page</span> : <em>No jobs page</em>}{e.atsProviders?.length ? e.atsProviders.map((ats) => <span key={ats}>ATS · {ats}</span>) : <em>No ATS detected</em>}{e.trackingTools?.map((tool) => <span key={tool}>{tool}</span>)}</div></section><section className={styles.recordSection}><label>Signals</label><ul className={styles.signalList}>{(e.signals || detail?.research?.signals || []).map((signal) => <li key={signal}>{signal}</li>)}{!(e.signals?.length || detail?.research?.signals?.length) && <li>No research signals yet.</li>}</ul></section>{audit?.findings?.length ? <section className={styles.recordSection}><label>Audit findings</label><div className={styles.findingList}>{audit.findings.slice(0, 8).map((finding, index) => <article key={`${finding.title}-${index}`}><span>{finding.severity || "signal"}</span><div><strong>{finding.title}</strong><p>{finding.detail}</p>{finding.recommendation && <small>{finding.recommendation}</small>}</div></article>)}</div></section> : null}</div>;
}

function TimelineInspector({ lead, detail }: { lead: Lead; detail: ResearchDetail | null }) {
  const activities = detail?.activities || [];
  const calls = detail?.calls || [];
  return <div className={styles.inspectorStack}><section className={styles.recordSection}><label>Activity timeline</label><div className={styles.detailTimeline}>{activities.map((item) => <div key={item.id}><span>{item.type.includes("call") ? "◉" : item.type.includes("enrichment") ? "◈" : "·"}</span><div><strong>{item.summary}</strong><small>{fmtDate(item.created_at, true)}</small></div></div>)}{!activities.length && <p className={styles.mutedText}>No activities yet.</p>}</div></section><section className={styles.recordSection}><label>Call history</label><div className={styles.detailTimeline}>{calls.map((call) => <div key={call.id}><span>◉</span><div><strong>{call.direction === "incoming" ? "Incoming" : "Outgoing"} · {call.status}</strong><small>{fmtDate(call.started_at, true)} · {call.duration_seconds}s</small></div></div>)}{!calls.length && <p className={styles.mutedText}>No calls yet.</p>}</div></section><section className={styles.recordSection}><label>Current state</label><p>{lead.next_action || "No next action"} · {fmtDate(lead.next_action_at, true)}</p></section></div>;
}

function DealInspector({ lead, onSubmit, busy }: { lead: Lead; onSubmit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  return <form className={styles.dealForm} onSubmit={onSubmit}><div className={styles.formGrid}><label>Stage<select name="stage" defaultValue={lead.stage}>{STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select></label><label>Phone status<select name="phoneStatus" defaultValue={lead.phone_status}><option value="ready">Ready</option><option value="verify">Verify</option><option value="invalid">Invalid</option></select></label><label>Deal value €<input name="dealValue" type="number" min="0" defaultValue={lead.deal_value} /></label><label>Probability %<input name="probability" type="number" min="0" max="100" defaultValue={lead.probability} /></label><label>Next action<input name="nextAction" defaultValue={lead.next_action} /></label><label>Due<input name="nextActionAt" type="datetime-local" defaultValue={dtLocal(lead.next_action_at)} /></label><label>Expected close<input name="expectedCloseDate" type="date" defaultValue={lead.expected_close_date || ""} /></label><label>Lost reason<input name="lostReason" defaultValue={lead.lost_reason} /></label></div><label className={styles.fullField}>Notes<textarea name="notes" defaultValue={lead.notes} /></label><label className={styles.checkLabel}><input type="checkbox" name="dnc" defaultChecked={lead.do_not_contact} /> Do not contact</label><button className={styles.primaryButton} disabled={busy}>Save record</button></form>;
}
