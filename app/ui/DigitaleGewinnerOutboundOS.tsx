"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Stage = "Neu" | "Kontaktiert" | "Engaged" | "Termin" | "Angebot" | "Gewonnen" | "Verloren";
type Audit = { scores?: { overall?: number; conversion?: number; trust?: number; seo?: number }; sales?: { opportunitySummary?: string; emailHook?: string }; auditedAt?: string };
type Lead = { id: string; company: string; contact: string; email: string; phone: string; website: string; city: string; industry: string; stage: Stage; dealValue: number; notes: string; intentScore: number; websiteScore?: number; websiteAudit?: Audit; emailStatus?: string; energyScore?: number; videoUrl?: string };
type Step = { waitDays: number; subject: string; body: string; variants?: Array<{ label: string; subject: string; body: string }> };
type Campaign = { id: string; name: string; audience: string; status: "Entwurf" | "Aktiv" | "Pausiert"; dailyLimit: number; steps: Step[]; sent: number; replies: number; positive: number; appointments: number; filters?: { industry?: string; city?: string; minWebsiteScore?: number; minIntentScore?: number; minEnergyScore?: number } };
type Mailbox = { id: string; name: string; email: string; provider: "Google" | "Microsoft" | "SMTP"; dailyLimit: number; sentToday: number; warmupDay: number; health: number; enabled: boolean; spf: boolean; dkim: boolean; dmarc: boolean };
type Settings = { companyName: string; senderName: string; calendarUrl: string; timezone: string };
type Store = { leads: Lead[]; campaigns: Campaign[]; mailboxes: Mailbox[]; settings: Settings };
type Health = { checks: Record<string, boolean>; configured: number; total: number; activeMailboxes?: number; coreReady?: boolean; outboundReady?: boolean; leadFinderReady?: boolean; aiReady?: boolean; videoReady?: boolean; ready: boolean };
type Section = "cockpit" | "akquise" | "leads" | "campaigns" | "mailboxes" | "pipeline" | "analytics" | "settings";

type DialDetail = { leadId: string; company: string; phone: string };

const stages: Stage[] = ["Neu", "Kontaktiert", "Engaged", "Termin", "Angebot", "Gewonnen", "Verloren"];
const nav: Array<{ id: Section; label: string; icon: string }> = [
  { id: "cockpit", label: "Cockpit", icon: "◉" },
  { id: "akquise", label: "Akquise", icon: "☎" },
  { id: "leads", label: "Pflege Leads", icon: "⌁" },
  { id: "campaigns", label: "Kampagnen", icon: "✦" },
  { id: "mailboxes", label: "Mailboxes", icon: "✉" },
  { id: "pipeline", label: "Pipeline", icon: "▦" },
  { id: "analytics", label: "Analytics", icon: "↗" },
  { id: "settings", label: "Setup", icon: "⚙" },
];

const starterCampaign: Campaign = {
  id: "dg-pflege-starter",
  name: "Pflege Recruiting · Entscheider Outreach",
  audience: "Ambulante Pflegedienste, Pflegeheime und Träger mit akutem Personalbedarf",
  status: "Entwurf",
  dailyLimit: 30,
  sent: 0,
  replies: 0,
  positive: 0,
  appointments: 0,
  steps: [
    {
      waitDays: 0,
      subject: "Kurze Idee für {{company}}",
      body: "Hallo {{first_name}},\n\nich habe mir {{company}} kurz angesehen und eine persönliche Analyse vorbereitet: {{analysis_link}}\n\nEs geht darum, qualifizierte Pflegefachkräfte auch außerhalb klassischer Jobbörsen zu erreichen und den Bewerbungsweg deutlich einfacher zu machen.\n\nViele Grüße\n{{sender_name}}",
    },
    {
      waitDays: 3,
      subject: "Re: Kurze Idee für {{company}}",
      body: "Hallo {{first_name}}, kurze Nachfrage: Soll ich Ihnen die drei wichtigsten Recruiting-Hebel aus der Analyse direkt zusammenfassen?",
    },
    {
      waitDays: 7,
      subject: "Re: Pflege-Recruiting bei {{company}}",
      body: "Falls Mitarbeitergewinnung gerade keine Priorität hat, reicht ein kurzes 'später'. Dann hake ich nicht weiter nach.",
    },
  ],
};

const fallback: Store = {
  settings: { companyName: "Digitale Gewinner", senderName: "Raphael Hermann", calendarUrl: "", timezone: "Europe/Berlin" },
  leads: [],
  mailboxes: [],
  campaigns: [starterCampaign],
};

function uid(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function money(value: number) { return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value); }
function scoreClass(value: number) { return value >= 80 ? "score score-hot" : value >= 60 ? "score score-warm" : "score"; }
function scoreOf(lead: Lead) { return Math.max(lead.websiteScore || 0, lead.intentScore || 0, lead.energyScore || 0); }
function cleanPhone(phone: string) { return phone.replace(/[^\d+]/g, ""); }

function migrate(raw: Store): Store {
  const settings = { ...fallback.settings, ...(raw.settings || {}) };
  if (settings.companyName === "Walkenhorst Energie") settings.companyName = "Digitale Gewinner";
  if (settings.senderName === "Andreas Walkenhorst") settings.senderName = "Raphael Hermann";
  const campaigns = (raw.campaigns || []).map(c => {
    if ((c.id === "starter" && c.name === "Gewerbedächer BW") || c.id === "dg-starter") return starterCampaign;
    return c;
  });
  return { ...fallback, ...raw, settings, leads: raw.leads || [], mailboxes: raw.mailboxes || [], campaigns: campaigns.length ? campaigns : [starterCampaign] };
}

export default function DigitaleGewinnerOutboundOS() {
  const [section, setSection] = useState<Section>("cockpit");
  const [store, setStore] = useState<Store>(fallback);
  const [health, setHealth] = useState<Health | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };

  async function refreshHealth() {
    try {
      const response = await fetch("/api/system/health");
      if (response.ok) setHealth(await response.json() as Health);
    } catch { /* Health wird beim nächsten Refresh erneut geprüft. */ }
  }

  useEffect(() => {
    void (async () => {
      let next = fallback;
      try {
        const response = await fetch("/api/state");
        if (response.ok) {
          const json = await response.json() as { state?: Store };
          if (json.state) next = migrate(json.state);
        }
      } catch { /* Fallback bleibt nutzbar. */ }
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

  const activeMailboxes = useMemo(() => store.mailboxes.filter(m => m.enabled), [store.mailboxes]);
  const stats = useMemo(() => ({
    leads: store.leads.length,
    hot: store.leads.filter(l => scoreOf(l) >= 80).length,
    callable: store.leads.filter(l => Boolean(l.phone)).length,
    pipeline: store.leads.filter(l => !["Gewonnen", "Verloren"].includes(l.stage)).reduce((sum, l) => sum + (l.dealValue || 0), 0),
    appointments: store.leads.filter(l => l.stage === "Termin").length,
    won: store.leads.filter(l => l.stage === "Gewonnen").length,
    capacity: activeMailboxes.reduce((sum, m) => sum + (m.dailyLimit || 0), 0),
    health: activeMailboxes.length ? Math.round(activeMailboxes.reduce((sum, m) => sum + (m.health || 0), 0) / activeMailboxes.length) : 0,
  }), [store.leads, activeMailboxes]);

  const hottest = useMemo(() => [...store.leads].sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, 8), [store.leads]);
  const callQueue = useMemo(() => [...store.leads].filter(l => l.phone && !["Gewonnen", "Verloren"].includes(l.stage)).sort((a, b) => scoreOf(b) - scoreOf(a)), [store.leads]);

  function stageLead(id: string, stage: Stage) { setStore(s => ({ ...s, leads: s.leads.map(l => l.id === id ? { ...l, stage } : l) })); }

  function dialCloudTalk(lead: Lead) {
    const phone = cleanPhone(lead.phone || "");
    if (!phone) return notify("Für diesen Lead fehlt eine Telefonnummer.");
    const detail: DialDetail = { leadId: lead.id, company: lead.company, phone };
    window.dispatchEvent(new CustomEvent<DialDetail>("cloudtalk:dial", { detail }));
    const link = document.createElement("a");
    link.href = `ct+tel:${phone}`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    notify(`CloudTalk: ${lead.company}`);
  }

  async function verify(email: string) {
    if (!email) return notify("Keine E-Mail vorhanden.");
    const response = await fetch("/api/email/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    const json = await response.json() as { status?: string; error?: string };
    notify(response.ok ? `E-Mail: ${json.status || "geprüft"}` : (json.error || "Prüfung fehlgeschlagen"));
  }

  async function addLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const company = String(f.get("company") || "").trim();
    if (!company) return;
    const website = String(f.get("website") || "").trim();
    let email = String(f.get("email") || "").trim();
    let phone = String(f.get("phone") || "").trim();
    let websiteAudit: Audit | undefined;
    let websiteScore = 0;
    let emailStatus = "";
    try {
      if (website) {
        const [enrichResponse, auditResponse] = await Promise.all([
          fetch("/api/leads/enrich", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ website }) }),
          fetch("/api/website/audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: website, company }) }),
        ]);
        if (enrichResponse.ok) {
          const json = await enrichResponse.json() as { contact?: { email?: string; phone?: string } };
          email = email || String(json.contact?.email || "");
          phone = phone || String(json.contact?.phone || "");
        }
        if (auditResponse.ok) {
          const json = await auditResponse.json() as { audit?: Audit };
          websiteAudit = json.audit;
          websiteScore = Number(json.audit?.scores?.overall || 0);
        }
      }
      if (email) {
        const verifyResponse = await fetch("/api/email/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
        if (verifyResponse.ok) {
          const json = await verifyResponse.json() as { status?: string };
          emailStatus = json.status || "";
        }
      }
    } catch { /* Lead kann auch mit Teilinformationen angelegt werden. */ }
    const lead: Lead = {
      id: uid("lead"), company, contact: String(f.get("contact") || ""), email, phone, website,
      city: String(f.get("city") || ""), industry: String(f.get("industry") || "Pflege"), stage: "Neu",
      dealValue: Number(f.get("dealValue") || 0), notes: websiteAudit?.sales?.opportunitySummary ? `Website Radar: ${websiteAudit.sales.opportunitySummary}` : "",
      intentScore: 0, websiteScore, websiteAudit, emailStatus,
    };
    setStore(s => ({ ...s, leads: [lead, ...s.leads] }));
    event.currentTarget.reset();
    notify(`Lead gespeichert${websiteScore ? ` · Website Score ${websiteScore}` : ""}${phone ? " · anrufbereit" : ""}`);
  }

  async function aiCampaign() {
    const audience = window.prompt("Zielgruppe für die Kampagne?", "Ambulante Pflegedienste mit offenen Pflegefachkraft-Stellen");
    if (!audience) return;
    const offer = window.prompt("Angebot / Nutzen?", "Planbare Mitarbeitergewinnung mit Social Recruiting, Karriere-Funnel und Arbeitgeberpositionierung") || "Pflege Recruiting";
    const response = await fetch("/api/ai/campaign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audience, offer, sender: store.settings.senderName }) });
    const json = await response.json() as { name?: string; audience?: string; steps?: Step[]; error?: string };
    if (!response.ok || !json.steps) return notify(json.error || "KI-Kampagne konnte nicht erstellt werden.");
    setStore(s => ({ ...s, campaigns: [{ id: uid("campaign"), name: json.name || "Pflege Recruiting Kampagne", audience: json.audience || audience, status: "Entwurf", dailyLimit: 30, steps: json.steps || [], sent: 0, replies: 0, positive: 0, appointments: 0 }, ...s.campaigns] }));
    notify("KI-Kampagne erstellt.");
  }

  async function launch(campaign: Campaign) {
    const leads = store.leads.filter(l => l.email && !["Gewonnen", "Verloren"].includes(l.stage));
    if (!leads.length) return notify("Keine versandfähigen Leads vorhanden.");
    if (!activeMailboxes.length) return notify("Keine aktive Mailbox vorhanden.");
    const response = await fetch("/api/campaigns/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaign, leads, mailboxes: store.mailboxes, senderName: store.settings.senderName }) });
    const json = await response.json() as { queued?: number; skipped?: number; error?: string };
    if (!response.ok) return notify(json.error || "Kampagnenstart fehlgeschlagen.");
    setStore(s => ({ ...s, campaigns: s.campaigns.map(c => c.id === campaign.id ? { ...c, status: "Aktiv" } : c) }));
    notify(`${json.queued || 0} Schritte eingeplant · ${json.skipped || 0} übersprungen`);
  }

  function addMailbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const email = String(f.get("email") || "").trim();
    if (!email.includes("@")) return notify("Gültige Mailbox-E-Mail fehlt.");
    setStore(s => ({ ...s, mailboxes: [...s.mailboxes, { id: String(f.get("id") || uid("mb")), name: String(f.get("name") || "Mailbox"), email, provider: String(f.get("provider") || "Google") as Mailbox["provider"], dailyLimit: 5, sentToday: 0, warmupDay: 1, health: 60, enabled: true, spf: false, dkim: false, dmarc: false }] }));
    event.currentTarget.reset();
    notify("Mailbox angelegt · Startlimit 5/Tag");
  }

  async function domainCheck(mailbox: Mailbox) {
    const domain = mailbox.email.split("@")[1];
    const response = await fetch("/api/domain/health", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain }) });
    const json = await response.json() as { spf?: boolean; dmarc?: boolean; score?: number; error?: string };
    if (!response.ok) return notify(json.error || "Domain Check fehlgeschlagen.");
    setStore(s => ({ ...s, mailboxes: s.mailboxes.map(m => m.id === mailbox.id ? { ...m, spf: Boolean(json.spf), dmarc: Boolean(json.dmarc), health: Math.max(m.health, json.score || 0) } : m) }));
    notify(`${domain}: SPF ${json.spf ? "OK" : "fehlt"} · DMARC ${json.dmarc ? "OK" : "fehlt"}`);
  }

  function ramp(id: string) {
    setStore(s => ({ ...s, mailboxes: s.mailboxes.map(m => {
      if (m.id !== id) return m;
      const day = m.warmupDay + 1;
      const dailyLimit = day < 4 ? 5 : day < 7 ? 10 : day < 11 ? 15 : day < 15 ? 20 : day < 19 ? 25 : 30;
      return { ...m, warmupDay: day, dailyLimit };
    }) }));
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setStore(s => ({ ...s, settings: { companyName: String(f.get("companyName") || "Digitale Gewinner"), senderName: String(f.get("senderName") || "Raphael Hermann"), calendarUrl: String(f.get("calendarUrl") || ""), timezone: String(f.get("timezone") || "Europe/Berlin") } }));
    notify("Setup gespeichert.");
  }

  const metric = (label: string, value: string | number, sub: string) => <div className="metric"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>;
  const readiness = [
    ["Core", Boolean(health?.coreReady), "DB · Login · Secrets · Public URL"],
    ["Outbound", Boolean(health?.outboundReady), "Mailbox + Credentials + Versandkern"],
    ["Lead Finder", Boolean(health?.leadFinderReady), "Research & Enrichment"],
    ["KI", Boolean(health?.aiReady), "OpenAI Kampagnen"],
    ["Video", Boolean(health?.videoReady), "Personalisiertes Video"],
  ] as const;

  return <main className="app-shell premium-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">DG</span><div><strong>Digitale Gewinner</strong><small>PFLEGE RECRUITING OS</small></div></div>
      <nav>{nav.map(item => <button key={item.id} className={`nav-item ${section === item.id ? "active" : ""}`} onClick={() => setSection(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>
      <div className="sidebar-foot"><i className="health-dot" /><span>{saving ? "Speichert…" : health?.ready ? "Production ready" : "System aktiv"}</span><small>{health ? `${health.configured}/${health.total} Checks` : "Readiness lädt"}</small></div>
    </aside>

    <section className="workspace">
      <header className="topbar">
        <div><small>DIGITALE GEWINNER · PFLEGE RECRUITING ENGINE</small><h1>{nav.find(item => item.id === section)?.label}</h1></div>
        <div className="top-actions"><button className="phone-quick" onClick={() => window.dispatchEvent(new Event("cloudtalk:open"))}>☎ CloudTalk</button><span className="live-pill">● {health?.ready ? "READY" : "LIVE"}</span><div className="avatar">RH</div></div>
      </header>

      <div className="content">
        {section === "cockpit" && <>
          <div className="hero-grid">
            <div className="hero-card">
              <div><span className="eyebrow">PFLEGE · OUTBOUND COMMAND CENTER</span><h2>Heute zählt nur der nächste qualifizierte Entscheider.</h2><p>Pflegebetriebe priorisieren, Bedarf erkennen, anrufen, persönliche Videoanalyse senden und jeden Kontakt bis zum Termin sauber weiterführen.</p><div className="hero-actions"><button className="primary compact" onClick={() => setSection("akquise")}>Akquise starten</button><button className="ghost" onClick={() => window.dispatchEvent(new Event("cloudtalk:open"))}>CloudTalk öffnen</button></div></div>
              <div className="hero-number">{stats.callable}<small>ANRUFBEREIT</small></div>
            </div>
            <div className="capacity-card"><span>Outbound Kapazität</span><strong>{stats.capacity}/Tag</strong><div className="progress"><i style={{ width: `${Math.min(100, stats.capacity / 1.5)}%` }} /></div><small>{activeMailboxes.length} aktive Mailbox{activeMailboxes.length === 1 ? "" : "en"} · CloudTalk integriert</small></div>
          </div>
          <div className="metric-grid">{metric("Pflege Leads", stats.leads, "im System")}{metric("Hot Leads", stats.hot, "hohe Priorität")}{metric("Pipeline", money(stats.pipeline), "offen")}{metric("Termine", stats.appointments, "gebucht")}</div>
          <div className="two-col wide-left">
            <div className="panel"><div className="panel-head"><div><h3>Priority Queue</h3><p>Die aussichtsreichsten Pflegebetriebe zuerst</p></div><button className="ghost" onClick={() => setSection("akquise")}>Alle anrufen →</button></div><div className="lead-list">{hottest.length ? hottest.map(lead => <div className="lead-row" key={lead.id}><div><strong>{lead.company}</strong><small>{lead.city || "—"} · {lead.industry || "Pflege"}</small></div><span className={scoreClass(scoreOf(lead))}>{scoreOf(lead)}</span>{lead.phone ? <button className="call-mini" onClick={() => dialCloudTalk(lead)}>☎ Anrufen</button> : <span className="status">Nummer offen</span>}<select value={lead.stage} onChange={e => stageLead(lead.id, e.target.value as Stage)}>{stages.map(stage => <option key={stage}>{stage}</option>)}</select></div>) : <div className="empty-state"><strong>Noch keine Pflege-Leads.</strong><span>Öffne den Lead Finder unten rechts oder lege den ersten Betrieb manuell an.</span></div>}</div></div>
            <div className="panel focus-card"><span className="eyebrow">HEUTE</span><strong>{stats.callable} direkte Chancen</strong><p>Nicht im Dashboard verlieren: Akquise öffnen, Lead für Lead abarbeiten und Gesprächsergebnis sofort dokumentieren.</p><button className="primary" onClick={() => setSection("akquise")}>☎ Call Session starten</button></div>
          </div>
        </>}

        {section === "akquise" && <div className="akquise-layout">
          <div className="panel call-queue-panel">
            <div className="panel-head"><div><span className="eyebrow">FOCUS MODE</span><h3>Pflege-Akquise Queue</h3><p>Priorisiert nach Signalstärke · CloudTalk direkt am Lead</p></div><span className="queue-count">{callQueue.length} offen</span></div>
            <div className="call-queue">{callQueue.length ? callQueue.map((lead, index) => <article className="call-card" key={lead.id}>
              <div className="call-rank">{String(index + 1).padStart(2, "0")}</div>
              <div className="call-main"><span className="eyebrow">{lead.city || "DEUTSCHLAND"} · {lead.industry || "PFLEGE"}</span><h3>{lead.company}</h3><p>{lead.contact || "Entscheider offen"} · {lead.phone}</p><div className="call-signals"><span className={scoreClass(scoreOf(lead))}>Priority {scoreOf(lead)}</span>{lead.email && <span className="status-green">E-Mail ✓</span>}{lead.website && <span className="status">Website ✓</span>}</div></div>
              <div className="call-actions"><button className="call-button" onClick={() => dialCloudTalk(lead)}>☎ Mit CloudTalk anrufen</button><select value={lead.stage} onChange={e => stageLead(lead.id, e.target.value as Stage)}>{stages.map(stage => <option key={stage}>{stage}</option>)}</select></div>
            </article>) : <div className="empty-state large"><strong>Keine Leads mit Telefonnummer in der Queue.</strong><span>Nutze Lead Finder/Enrichment oder ergänze Nummern bei bestehenden Pflegebetrieben.</span></div>}</div>
          </div>
          <aside className="akquise-side">
            <div className="panel script-card"><span className="eyebrow">GESPRÄCHSRAHMEN</span><h3>Menschlich. Kurz. Relevant.</h3><p className="script-lead">„Guten Tag, hier ist Raphael Hermann von Digitale Gewinner. Ich rufe kurz an, weil wir uns aktuell ansehen, wie Pflegedienste trotz Fachkräftemangel qualifizierte Bewerber erreichen.“</p><div className="script-step"><b>1</b><span><strong>Relevanz prüfen</strong><small>„Ist Mitarbeitergewinnung bei Ihnen gerade ein Thema?“</small></span></div><div className="script-step"><b>2</b><span><strong>Situation verstehen</strong><small>Welche Stelle ist am dringendsten? Was wurde bereits probiert?</small></span></div><div className="script-step"><b>3</b><span><strong>Nächster Schritt</strong><small>Nur bei echtem Fit Analyse/Termin anbieten.</small></span></div></div>
            <div className="panel cloudtalk-info"><div className="integration-icon ok-bg">☎</div><div><strong>CloudTalk ist eingebaut</strong><p>Ein Klick öffnet Phone + Desktop-Dialer. Call-Events werden dem aktiven Lead zugeordnet.</p></div><button className="ghost" onClick={() => window.dispatchEvent(new Event("cloudtalk:open"))}>Phone öffnen</button></div>
          </aside>
        </div>}

        {section === "leads" && <div className="two-col wide-left">
          <div className="panel"><div className="panel-head"><div><h3>Pflege Lead Intelligence</h3><p>Kontakt, Website, Signalstärke und nächster Vertriebsstatus</p></div></div><div className="table-wrap"><table><thead><tr><th>Unternehmen</th><th>Kontakt</th><th>Score</th><th>Stage</th><th>Aktion</th></tr></thead><tbody>{store.leads.map(lead => <tr key={lead.id}><td><strong>{lead.company}</strong><small>{lead.city || "—"} · {lead.industry || "Pflege"}</small></td><td>{lead.email || lead.phone || "—"}<small>{lead.emailStatus || lead.phone || ""}</small></td><td><span className={scoreClass(scoreOf(lead))}>{scoreOf(lead) || "—"}</span></td><td><select value={lead.stage} onChange={e => stageLead(lead.id, e.target.value as Stage)}>{stages.map(stage => <option key={stage}>{stage}</option>)}</select></td><td><div className="row-actions">{lead.phone && <button className="call-mini" onClick={() => dialCloudTalk(lead)}>☎ Call</button>}{lead.email && <button className="ghost" onClick={() => void verify(lead.email)}>Verify</button>}</div></td></tr>)}</tbody></table></div></div>
          <form className="panel form-panel" onSubmit={addLead}><div className="panel-head"><div><h3>Pflegebetrieb anlegen</h3><p>Kontakt und Website werden automatisch angereichert</p></div></div><label>Unternehmen<input name="company" required /></label><div className="split"><label>Kontakt<input name="contact" /></label><label>Stadt<input name="city" /></label></div><label>E-Mail<input name="email" type="email" /></label><label>Telefon<input name="phone" /></label><label>Website<input name="website" placeholder="https://..." /></label><label>Bereich<input name="industry" defaultValue="Pflege" /></label><label>Potenzial €<input name="dealValue" type="number" min="0" defaultValue="3000" /></label><button className="primary">Anreichern & speichern</button></form>
        </div>}

        {section === "campaigns" && <div className="panel"><div className="panel-head"><div><h3>Pflege Campaign Engine</h3><p>Persönliche Sequenzen · Varianten · Stop-on-Reply · kontrollierte Limits</p></div><button className="ghost" onClick={() => void aiCampaign()}>✦ KI-Kampagne</button></div>{store.campaigns.map(campaign => <div className="campaign-card" key={campaign.id}><div className="campaign-head"><div><span className="eyebrow">{campaign.status.toUpperCase()}</span><h3>{campaign.name}</h3><p>{campaign.audience}</p></div><button className="primary compact" onClick={() => void launch(campaign)}>Kampagne starten</button></div><div className="campaign-metrics"><span><small>Schritte</small><b>{campaign.steps.length}</b></span><span><small>Limit/Tag</small><b>{campaign.dailyLimit}</b></span><span><small>Replies</small><b>{campaign.replies || 0}</b></span><span><small>Termine</small><b>{campaign.appointments || 0}</b></span></div><div className="sequence">{campaign.steps.map((step, index) => <div className="sequence-step" key={index}><span>{index + 1}</span><div><strong>{index === 0 ? "Start" : `+${step.waitDays} Tage`}</strong><small>{step.subject}</small><p>{step.variants?.length ? `${step.variants.length} Varianten` : "Persönliche Nachricht"}</p></div></div>)}</div></div>)}</div>}

        {section === "mailboxes" && <div className="two-col wide-left"><div className="panel"><div className="panel-head"><div><h3>Sender Infrastructure</h3><p>Gesunde Limits statt aggressivem Massenversand</p></div></div><div className="mailboxes">{store.mailboxes.length ? store.mailboxes.map(mailbox => <div className="mailbox-card" key={mailbox.id}><div className="mailbox-top"><span className="mail-icon">✉</span><div><strong>{mailbox.email}</strong><small>{mailbox.provider} · Tag {mailbox.warmupDay} · {mailbox.dailyLimit}/Tag</small></div><button className="ghost" onClick={() => ramp(mailbox.id)}>Ramp</button></div><div className="mail-health"><span>Health</span><b>{mailbox.health}%</b></div><div className="progress"><i style={{ width: `${mailbox.health}%` }} /></div><div className="dns"><span className={mailbox.spf ? "ok" : ""}>SPF</span><span className={mailbox.dmarc ? "ok" : ""}>DMARC</span><button className="link-btn" onClick={() => void domainCheck(mailbox)}>Domain prüfen</button></div></div>) : <div className="empty-state"><strong>Noch keine Mailbox.</strong><span>Mailbox anlegen und Google/Microsoft OAuth oder SMTP verbinden.</span></div>}</div></div><form className="panel form-panel" onSubmit={addMailbox}><div className="panel-head"><div><h3>Mailbox hinzufügen</h3><p>Sauber getrennte Absender für kontrollierte Akquise</p></div></div><label>Credential-ID<input name="id" placeholder="mb-raphael" /></label><label>Absendername<input name="name" placeholder="Raphael" /></label><label>E-Mail<input name="email" type="email" required /></label><label>Provider<select name="provider"><option>Google</option><option>Microsoft</option><option>SMTP</option></select></label><button className="primary">Mailbox anlegen</button></form></div>}

        {section === "pipeline" && <div className="panel"><div className="panel-head"><div><h3>Recruiting Sales Pipeline</h3><p>Vom ersten Gespräch bis zum gewonnenen Pflegekunden</p></div></div><div className="kanban">{stages.map(stage => <div className="kanban-col" key={stage}><div className="kanban-title"><strong>{stage}</strong><span>{store.leads.filter(l => l.stage === stage).length}</span></div>{store.leads.filter(l => l.stage === stage).map(lead => <div className="deal-card" key={lead.id}><span className="eyebrow">{lead.city || "PFLEGE"}</span><h4>{lead.company}</h4><p>{lead.contact || lead.email || lead.phone || "Kontakt offen"}</p><b>{money(lead.dealValue || 0)}</b><select value={lead.stage} onChange={e => stageLead(lead.id, e.target.value as Stage)}>{stages.map(item => <option key={item}>{item}</option>)}</select></div>)}</div>)}</div></div>}

        {section === "analytics" && <><div className="metric-grid">{metric("Versandkapazität", stats.capacity, "E-Mails/Tag")}{metric("Anrufbereit", stats.callable, "CloudTalk")}{metric("Termine", stats.appointments, "Pipeline")}{metric("Mailbox Health", `${stats.health}%`, "aktive Sender")}</div><div className="panel"><div className="panel-head"><div><h3>Production Readiness</h3><p>Live-Betrieb nur mit sauberem Kern</p></div><button className="ghost" onClick={() => void refreshHealth()}>Neu prüfen</button></div><div className="integration-list">{readiness.map(([label, ok, detail]) => <div key={label}><span className={`integration-icon ${ok ? "ok-bg" : ""}`}>{ok ? "✓" : "!"}</span><div><strong>{label}</strong><small>{detail}</small></div><span className={ok ? "status-green" : "status"}>{ok ? "READY" : "SETUP"}</span></div>)}<div><span className="integration-icon ok-bg">☎</span><div><strong>CloudTalk</strong><small>Phone Embed · Click-to-Dial · Call Tracking</small></div><span className="status-green">INTEGRIERT</span></div></div></div></>}

        {section === "settings" && <div className="two-col wide-left"><form key={`${store.settings.companyName}-${store.settings.senderName}-${store.settings.calendarUrl}`} className="panel form-panel" onSubmit={saveSettings}><div className="panel-head"><div><h3>Digitale Gewinner Setup</h3><p>Pflege-Positionierung und Termin-CTA</p></div></div><label>Unternehmen<input name="companyName" defaultValue={store.settings.companyName} /></label><label>Absendername<input name="senderName" defaultValue={store.settings.senderName} /></label><label>Kalender-URL<input name="calendarUrl" defaultValue={store.settings.calendarUrl} placeholder="https://cal.com/..." /></label><label>Zeitzone<input name="timezone" defaultValue={store.settings.timezone} /></label><button className="primary">Setup speichern</button></form><div className="panel"><div className="panel-head"><div><h3>Systemkern</h3><p>Sales OS, Pflege-Outbound und CloudTalk in einer Oberfläche</p></div></div><div className="integration-list">{readiness.map(([label, ok, detail]) => <div key={label}><span className={`integration-icon ${ok ? "ok-bg" : ""}`}>{ok ? "✓" : "!"}</span><div><strong>{label}</strong><small>{detail}</small></div><span className={ok ? "status-green" : "status"}>{ok ? "READY" : "SETUP"}</span></div>)}</div><div className="callout">CloudTalk benötigt im eingebetteten Phone lediglich deinen CloudTalk-Login. Die Call-Telemetrie bleibt serverseitig und wird dem aktiven Lead zugeordnet.</div></div></div>}
      </div>
    </section>
    {toast && <div className="toast">{toast}</div>}
  </main>;
}
