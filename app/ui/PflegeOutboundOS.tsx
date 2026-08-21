"use client";

import { useEffect, useMemo, useState } from "react";

type Stage = "Neu" | "Kontaktiert" | "Engaged" | "Termin" | "Angebot" | "Gewonnen" | "Verloren";
type Step = { waitDays: number; subject: string; body: string; variants?: Array<{ label: string; subject: string; body: string }> };
type Campaign = { id: string; name: string; audience: string; status: "Entwurf" | "Aktiv" | "Pausiert"; dailyLimit: number; steps: Step[]; sent: number; replies: number; positive: number; appointments: number };
type Mailbox = { id: string; name: string; email: string; provider: string; dailyLimit: number; sentToday: number; warmupDay: number; health: number; enabled: boolean };
type Lead = {
  id: string;
  company: string;
  contact?: string;
  email?: string;
  phone?: string;
  website?: string;
  city?: string;
  industry?: string;
  stage: Stage;
  dealValue?: number;
  notes?: string;
  intentScore?: number;
  websiteScore?: number;
  opportunityScore?: number;
  priorityScore?: number;
  recruitingOpportunityScore?: number;
  recruitingMaturityScore?: number;
  recruitingLevel?: string;
  recruitingGaps?: string[];
  recommendedOffer?: string;
};
type Settings = { companyName: string; senderName: string; calendarUrl: string; timezone: string };
type Store = { leads: Lead[]; campaigns: Campaign[]; mailboxes: Mailbox[]; settings: Settings };
type Health = { coreReady?: boolean; outboundReady?: boolean; leadFinderReady?: boolean; aiReady?: boolean; videoReady?: boolean; ready?: boolean; configured?: number; total?: number };
type Section = "cockpit" | "leads" | "campaigns" | "pipeline" | "analytics" | "settings";

type PflegeResponse = {
  recruiting?: { maturityScore: number; opportunityScore: number; level: string; gaps: string[]; recommendedOffer: string; emailHook: string };
  audit?: { scores?: { overall?: number } };
  error?: string;
};

const stages: Stage[] = ["Neu", "Kontaktiert", "Engaged", "Termin", "Angebot", "Gewonnen", "Verloren"];
const nav: Array<{ id: Section; label: string; icon: string }> = [
  { id: "cockpit", label: "Cockpit", icon: "◉" },
  { id: "leads", label: "Pflege Radar", icon: "⌁" },
  { id: "campaigns", label: "Kampagnen", icon: "✦" },
  { id: "pipeline", label: "Pipeline", icon: "▦" },
  { id: "analytics", label: "Analytics", icon: "↗" },
  { id: "settings", label: "Setup", icon: "⚙" },
];

const starterCampaign: Campaign = {
  id: "pflege-starter-v1",
  name: "Pflege Recruiting Radar",
  audience: "Ambulante Pflegedienste und Pflegeanbieter mit sichtbarem Recruiting-Potenzial",
  status: "Entwurf",
  dailyLimit: 50,
  sent: 0,
  replies: 0,
  positive: 0,
  appointments: 0,
  steps: [
    {
      waitDays: 0,
      subject: "Kurzer Blick auf den Bewerber-Einstieg bei {{company}}",
      body: "Hallo {{first_name}},\n\nich habe mir den digitalen Bewerber-Einstieg von {{company}} kurz angesehen und eine kompakte Analyse vorbereitet: {{analysis_link}}\n\nDabei sind mir konkrete Punkte aufgefallen, an denen Pflegefachkräfte im Bewerbungsprozess verloren gehen können.\n\nWenn das Thema Mitarbeitergewinnung aktuell relevant ist, schicke ich Ihnen gern die wichtigsten 2–3 Punkte direkt.\n\nViele Grüße\n{{sender_name}}",
    },
    {
      waitDays: 3,
      subject: "Re: Bewerber-Einstieg bei {{company}}",
      body: "Hallo {{first_name}}, kurze Nachfrage: Soll ich Ihnen die auffälligsten Recruiting-Hebel bei {{company}} einfach hier zusammenfassen?",
    },
    {
      waitDays: 7,
      subject: "Re: {{company}}",
      body: "Falls Mitarbeitergewinnung gerade kein Thema ist, reicht ein kurzes ‚später‘. Ansonsten kann ich Ihnen zeigen, wie sich Karriere-Seite, Schnellbewerbung und Social Recruiting als ein System verbinden lassen.",
    },
  ],
};

const fallback: Store = {
  settings: { companyName: "Pflege Recruiting OS", senderName: "", calendarUrl: "", timezone: "Europe/Berlin" },
  leads: [],
  mailboxes: [],
  campaigns: [starterCampaign],
};

function money(value: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value || 0);
}

function scoreClass(value: number) {
  return value >= 75 ? "score score-hot" : value >= 50 ? "score score-warm" : "score";
}

function leadOpportunity(lead: Lead) {
  return Math.round(lead.recruitingOpportunityScore ?? lead.opportunityScore ?? lead.priorityScore ?? 0);
}

function migrate(raw?: Partial<Store>): Store {
  const settings = { ...fallback.settings, ...(raw?.settings || {}) };
  if (!settings.companyName || settings.companyName === "Digitale Gewinner" || settings.companyName === "Walkenhorst Energie") settings.companyName = "Pflege Recruiting OS";
  if (settings.senderName === "Raphael Hermann" || settings.senderName === "Andreas Walkenhorst") settings.senderName = "";
  const campaigns = raw?.campaigns?.length ? raw.campaigns : [starterCampaign];
  const hasPflegeStarter = campaigns.some((campaign) => campaign.id === starterCampaign.id);
  return {
    settings,
    leads: (raw?.leads || []) as Lead[],
    mailboxes: (raw?.mailboxes || []) as Mailbox[],
    campaigns: hasPflegeStarter ? campaigns : [starterCampaign, ...campaigns],
  };
}

export default function PflegeOutboundOS() {
  const [section, setSection] = useState<Section>("cockpit");
  const [store, setStore] = useState<Store>(fallback);
  const [health, setHealth] = useState<Health | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyLead, setBusyLead] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3000); };

  async function refreshHealth() {
    try {
      const response = await fetch("/api/system/health", { cache: "no-store" });
      if (response.ok) setHealth(await response.json() as Health);
    } catch {}
  }

  useEffect(() => {
    void (async () => {
      let next = fallback;
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (response.ok) {
          const json = await response.json() as { state?: Partial<Store> };
          next = migrate(json.state);
        }
      } catch {}
      setStore(next);
      await refreshHealth();
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        setSaving(true);
        try {
          await fetch("/api/state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(store) });
        } finally {
          setSaving(false);
        }
      })();
    }, 650);
    return () => window.clearTimeout(timer);
  }, [store, loaded]);

  const activeMailboxes = useMemo(() => store.mailboxes.filter((mailbox) => mailbox.enabled), [store.mailboxes]);
  const stats = useMemo(() => ({
    leads: store.leads.length,
    hot: store.leads.filter((lead) => leadOpportunity(lead) >= 70).length,
    pipeline: store.leads.filter((lead) => !["Gewonnen", "Verloren"].includes(lead.stage)).reduce((sum, lead) => sum + Number(lead.dealValue || 0), 0),
    appointments: store.leads.filter((lead) => lead.stage === "Termin").length,
    won: store.leads.filter((lead) => lead.stage === "Gewonnen").length,
    capacity: activeMailboxes.reduce((sum, mailbox) => sum + Number(mailbox.dailyLimit || 0), 0),
  }), [store.leads, activeMailboxes]);

  const hottest = useMemo(() => [...store.leads].sort((a, b) => leadOpportunity(b) - leadOpportunity(a)).slice(0, 10), [store.leads]);

  function stageLead(id: string, stage: Stage) {
    setStore((current) => ({ ...current, leads: current.leads.map((lead) => lead.id === id ? { ...lead, stage } : lead) }));
  }

  async function analyzeLead(lead: Lead) {
    if (!lead.website) return notify("Keine Website vorhanden – der Recruiting-Hebel ist bereits sehr hoch.");
    setBusyLead(lead.id);
    try {
      const response = await fetch("/api/pflege/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: lead.website, company: lead.company }),
      });
      const json = await response.json() as PflegeResponse;
      if (!response.ok || !json.recruiting) throw new Error(json.error || "Analyse fehlgeschlagen");
      setStore((current) => ({
        ...current,
        leads: current.leads.map((item) => item.id !== lead.id ? item : {
          ...item,
          websiteScore: Number(json.audit?.scores?.overall || item.websiteScore || 0),
          recruitingOpportunityScore: json.recruiting?.opportunityScore,
          recruitingMaturityScore: json.recruiting?.maturityScore,
          recruitingLevel: json.recruiting?.level,
          recruitingGaps: json.recruiting?.gaps,
          recommendedOffer: json.recruiting?.recommendedOffer,
          notes: [item.notes || "", json.recruiting?.emailHook || "", `Empfohlenes Angebot: ${json.recruiting?.recommendedOffer || ""}`].filter(Boolean).join(" · "),
        }),
      }));
      notify(`${lead.company}: Recruiting Opportunity ${json.recruiting.opportunityScore}/100`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Analyse fehlgeschlagen");
    } finally {
      setBusyLead(null);
    }
  }

  async function aiCampaign() {
    const offer = window.prompt("Angebot für diese Pflege-Kampagne?", "Karriere-Landingpage + Schnellbewerbungs-Funnel + Social Recruiting") || "Karriere-Landingpage + Schnellbewerbungs-Funnel + Social Recruiting";
    const response = await fetch("/api/ai/campaign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        audience: "Ambulante Pflegedienste und Pflegeanbieter in Deutschland, die Pflegefachkräfte gewinnen möchten",
        offer,
        sender: store.settings.senderName || store.settings.companyName,
        tone: "menschlich, seriös, nahbar, konkret und ohne Marketing-Floskeln",
      }),
    });
    const json = await response.json() as { name?: string; audience?: string; steps?: Step[]; error?: string };
    if (!response.ok || !json.steps) return notify(json.error || "KI-Kampagne konnte nicht erstellt werden.");
    const campaign: Campaign = {
      id: `pflege-ai-${Date.now()}`,
      name: json.name || "Pflege KI Kampagne",
      audience: json.audience || "Pflegedienste",
      status: "Entwurf",
      dailyLimit: 50,
      steps: json.steps,
      sent: 0,
      replies: 0,
      positive: 0,
      appointments: 0,
    };
    setStore((current) => ({ ...current, campaigns: [campaign, ...current.campaigns] }));
    notify("Pflege-Kampagne erstellt.");
  }

  async function launch(campaign: Campaign) {
    const leads = store.leads.filter((lead) => lead.email && !["Gewonnen", "Verloren"].includes(lead.stage));
    if (!leads.length) return notify("Keine versandfähigen Pflege-Leads vorhanden.");
    if (!activeMailboxes.length) return notify("Noch keine aktive Mailbox verbunden.");
    const response = await fetch("/api/campaigns/launch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaign, leads, mailboxes: store.mailboxes, senderName: store.settings.senderName || store.settings.companyName }),
    });
    const json = await response.json() as { queued?: number; skipped?: number; error?: string };
    if (!response.ok) return notify(json.error || "Kampagnenstart fehlgeschlagen.");
    setStore((current) => ({ ...current, campaigns: current.campaigns.map((item) => item.id === campaign.id ? { ...item, status: "Aktiv" } : item) }));
    notify(`${json.queued || 0} Schritte eingeplant · ${json.skipped || 0} übersprungen`);
  }

  function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStore((current) => ({
      ...current,
      settings: {
        companyName: String(form.get("companyName") || "Pflege Recruiting OS"),
        senderName: String(form.get("senderName") || ""),
        calendarUrl: String(form.get("calendarUrl") || ""),
        timezone: String(form.get("timezone") || "Europe/Berlin"),
      },
    }));
    notify("Setup gespeichert.");
  }

  const metric = (label: string, value: string | number, sub: string) => <div className="metric"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>;
  const readiness = [
    ["Core", Boolean(health?.coreReady), "DB · Login · Secrets · Public URL"],
    ["Outbound", Boolean(health?.outboundReady), "Mailbox + Credentials + Versandkern"],
    ["Lead Finder", Boolean(health?.leadFinderReady), "Google Places"],
    ["KI", Boolean(health?.aiReady), "Pflege-Kampagnen"],
    ["Fake Loom", Boolean(health?.videoReady), "Video Renderer"],
  ] as const;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">PR</span><div><strong>Pflege Recruiting</strong><small>Outbound OS</small></div></div>
      <nav>{nav.map((item) => <button key={item.id} className={`nav-item ${section === item.id ? "active" : ""}`} onClick={() => setSection(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>
      <div className="sidebar-foot"><i className="health-dot"/><span>{saving ? "Speichert…" : health?.ready ? "Production ready" : "Setup läuft"}</span><small>{health?.configured !== undefined ? `${health.configured}/${health.total} Checks` : "Readiness lädt"}</small></div>
    </aside>

    <section className="workspace">
      <header className="topbar"><div><small>PFLEGE RECRUITING · OUTBOUND & APPLICANT ACQUISITION ENGINE</small><h1>{nav.find((item) => item.id === section)?.label}</h1></div><div className="top-actions"><span className="live-pill">● {health?.ready ? "READY" : "LIVE"}</span><div className="avatar">PR</div></div></header>
      <div className="content">
        {section === "cockpit" && <>
          <div className="hero-grid">
            <div className="hero-card"><div><span className="eyebrow">RECRUITING OPPORTUNITY</span><h2>{stats.hot} Pflegedienste mit starkem sichtbaren Recruiting-Hebel.</h2><p>Pflegeanbieter finden, öffentlich sichtbare Geschäftskontakte anreichern, Bewerber-Einstieg analysieren, personalisierte Microsites und Videos erzeugen und Antworten bis zum Termin verfolgen.</p></div><div className="hero-number">{stats.hot}<small>HOT LEADS</small></div></div>
            <div className="capacity-card"><span>Versandkapazität</span><strong>{stats.capacity}/Tag</strong><div className="progress"><i style={{ width: `${Math.min(100, stats.capacity / 1.5)}%` }}/></div><small>{activeMailboxes.length} aktive Mailbox{activeMailboxes.length === 1 ? "" : "en"} · kontrollierte Tageslimits</small></div>
          </div>
          <div className="metric-grid">{metric("Pflege-Leads", stats.leads, "im Radar")}{metric("Pipeline", money(stats.pipeline), "offen")}{metric("Termine", stats.appointments, "gebucht")}{metric("Gewonnen", stats.won, "Deals")}</div>
          <div className="panel"><div className="panel-head"><div><h3>Recruiting Opportunity Queue</h3><p>Je höher der Score, desto größer der sichtbare digitale Recruiting-Hebel</p></div></div><div className="lead-list">{hottest.length ? hottest.map((lead) => <div className="lead-row" key={lead.id}><div><strong>{lead.company}</strong><small>{lead.city || "—"} · {lead.recruitingGaps?.[0] || lead.recommendedOffer || "Pflege-Research offen"}</small></div><span className={scoreClass(leadOpportunity(lead))}>O {leadOpportunity(lead)}</span><span className={scoreClass(lead.recruitingMaturityScore || 0)}>R {lead.recruitingMaturityScore || "—"}</span><select value={lead.stage} onChange={(event) => stageLead(lead.id, event.target.value as Stage)}>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></div>) : <div className="callout">Noch keine Pflege-Leads. Öffne unten rechts den „Pflege Lead Finder“ und starte z. B. mit „Pflegedienst Stuttgart“.</div>}</div></div>
        </>}

        {section === "leads" && <div className="panel"><div className="panel-head"><div><h3>Pflege Lead Intelligence</h3><p>Recruiting Opportunity · Recruiting-Reife · Website · Intent · Pipeline</p></div></div><div className="table-wrap"><table><thead><tr><th>Unternehmen</th><th>Recruiting</th><th>Website</th><th>Kontakt</th><th>Stage</th><th></th></tr></thead><tbody>{store.leads.map((lead) => <tr key={lead.id}><td><strong>{lead.company}</strong><small>{lead.city || "—"} · {lead.recruitingGaps?.[0] || "Analyse offen"}</small></td><td><span className={scoreClass(leadOpportunity(lead))}>O {leadOpportunity(lead) || "—"}</span><small>Reife {lead.recruitingMaturityScore ?? "—"}/100</small></td><td><span className={scoreClass(lead.websiteScore || 0)}>{lead.websiteScore || "—"}</span><small>{lead.website ? "Website vorhanden" : "keine Website"}</small></td><td>{lead.email || "—"}<small>{lead.phone || ""}</small></td><td><select value={lead.stage} onChange={(event) => stageLead(lead.id, event.target.value as Stage)}>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></td><td><button className="ghost" disabled={busyLead === lead.id} onClick={() => void analyzeLead(lead)}>{busyLead === lead.id ? "Analysiert…" : "Pflege-Audit"}</button></td></tr>)}</tbody></table></div></div>}

        {section === "campaigns" && <div className="panel"><div className="panel-head"><div><h3>Pflege Campaign Engine</h3><p>Personalisierte Sequenzen · A/B/C · Stop-on-Reply · Multi-Mailbox</p></div><button className="ghost" onClick={() => void aiCampaign()}>+ KI-Pflegekampagne</button></div>{store.campaigns.map((campaign) => <div className="campaign-card" key={campaign.id}><div className="campaign-head"><div><span className="eyebrow">{campaign.status.toUpperCase()}</span><h3>{campaign.name}</h3><p>{campaign.audience}</p></div><button className="ghost" onClick={() => void launch(campaign)}>Starten</button></div><div className="campaign-metrics"><span><small>Schritte</small><b>{campaign.steps.length}</b></span><span><small>Limit/Tag</small><b>{campaign.dailyLimit}</b></span><span><small>Replies</small><b>{campaign.replies || 0}</b></span><span><small>Termine</small><b>{campaign.appointments || 0}</b></span></div><div className="sequence">{campaign.steps.map((step, index) => <div className="sequence-step" key={`${campaign.id}-${index}`}><span>{index + 1}</span><div><strong>{index === 0 ? "Start" : `+${step.waitDays} Tage`}</strong><small>{step.subject}</small><p>{step.variants?.length ? `${step.variants.length} Varianten` : "Standard"}</p></div></div>)}</div></div>)}</div>}

        {section === "pipeline" && <div className="panel"><div className="panel-head"><div><h3>Pflege Sales Pipeline</h3><p>Vom Research bis zum gewonnenen Recruiting-Kunden</p></div></div><div className="kanban">{stages.map((stage) => <div className="kanban-col" key={stage}><div className="kanban-title"><strong>{stage}</strong><span>{store.leads.filter((lead) => lead.stage === stage).length}</span></div>{store.leads.filter((lead) => lead.stage === stage).map((lead) => <div className="deal-card" key={lead.id}><h4>{lead.company}</h4><p>Opportunity {leadOpportunity(lead)}/100</p><b>{money(Number(lead.dealValue || 0))}</b><select value={lead.stage} onChange={(event) => stageLead(lead.id, event.target.value as Stage)}>{stages.map((item) => <option key={item}>{item}</option>)}</select></div>)}</div>)}</div></div>}

        {section === "analytics" && <><div className="metric-grid">{metric("Hot Opportunities", stats.hot, "≥ 70/100")}{metric("Versandkapazität", stats.capacity, "E-Mails/Tag")}{metric("Termine", stats.appointments, "Pipeline")}{metric("Gewonnen", stats.won, "Kunden")}</div><div className="panel"><div className="panel-head"><div><h3>Production Readiness</h3><p>Technische Kernmodule für die teilbare Installation</p></div><button className="ghost" onClick={() => void refreshHealth()}>Neu prüfen</button></div><div className="integration-list">{readiness.map(([label, ok, detail]) => <div key={label}><span className={`integration-icon ${ok ? "ok-bg" : ""}`}>{ok ? "✓" : "!"}</span><div><strong>{label}</strong><small>{detail}</small></div><span className={ok ? "status-green" : "status"}>{ok ? "READY" : "SETUP"}</span></div>)}</div></div></>}

        {section === "settings" && <div className="two-col wide-left"><form key={`${store.settings.companyName}-${store.settings.senderName}-${store.settings.calendarUrl}`} className="panel form-panel" onSubmit={saveSettings}><div className="panel-head"><div><h3>Pflege Recruiting Setup</h3><p>Diese Installation gehört deinem Freund – keine Raphael-Zugangsdaten werden benötigt.</p></div></div><label>Unternehmen / Marke<input name="companyName" defaultValue={store.settings.companyName}/></label><label>Absendername<input name="senderName" defaultValue={store.settings.senderName} placeholder="Vor- und Nachname"/></label><label>Kalender-URL<input name="calendarUrl" defaultValue={store.settings.calendarUrl} placeholder="https://cal.com/..."/></label><label>Zeitzone<input name="timezone" defaultValue={store.settings.timezone}/></label><button className="primary">Setup speichern</button></form><div className="panel"><div className="panel-head"><div><h3>Eigene Infrastruktur</h3><p>Alle Secrets und Konten werden pro Installation neu verbunden.</p></div></div><div className="callout">Benötigt werden eine eigene Postgres-Datenbank, Admin-/Encryption-Secrets, Google Places für den Lead Finder, optional OpenAI für KI-Kampagnen, eigene Mailboxen und optional ein Fake-Loom-Renderer. Reale Secrets gehören niemals ins Repository.</div><div className="integration-list">{readiness.map(([label, ok, detail]) => <div key={label}><span className={`integration-icon ${ok ? "ok-bg" : ""}`}>{ok ? "✓" : "!"}</span><div><strong>{label}</strong><small>{detail}</small></div><span className={ok ? "status-green" : "status"}>{ok ? "READY" : "SETUP"}</span></div>)}</div></div></div>}
      </div>
    </section>
    {toast && <div className="toast">{toast}</div>}
  </main>;
}
