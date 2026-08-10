"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Section = "cockpit" | "leads" | "campaigns" | "mailboxes" | "pipeline" | "analytics" | "settings";
type LeadStage = "Neu" | "Kontaktiert" | "Engaged" | "Termin" | "Angebot" | "Gewonnen" | "Verloren";

type Lead = {
  id: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  website: string;
  city: string;
  industry: string;
  employees: number;
  roofArea: number;
  pvExisting: boolean;
  energyScore: number;
  intentScore: number;
  stage: LeadStage;
  dealValue: number;
  notes: string;
  createdAt: string;
};

type CampaignStep = { id: string; waitDays: number; subject: string; body: string };
type Campaign = {
  id: string;
  name: string;
  audience: string;
  status: "Entwurf" | "Aktiv" | "Pausiert";
  dailyLimit: number;
  createdAt: string;
  steps: CampaignStep[];
  sent: number;
  replies: number;
  positive: number;
  appointments: number;
};

type Mailbox = {
  id: string;
  name: string;
  email: string;
  provider: "Google" | "Microsoft" | "SMTP";
  dailyLimit: number;
  sentToday: number;
  warmupDay: number;
  health: number;
  enabled: boolean;
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
};

type Settings = { companyName: string; senderName: string; calendarUrl: string; aiProvider: string; timezone: string };

type Store = { leads: Lead[]; campaigns: Campaign[]; mailboxes: Mailbox[]; settings: Settings };

const KEY = "energy-radar-ai-v1";
const stages: LeadStage[] = ["Neu", "Kontaktiert", "Engaged", "Termin", "Angebot", "Gewonnen", "Verloren"];

const demoLeads: Lead[] = [
  { id: "l1", company: "Müller Metalltechnik GmbH", contact: "Thomas Müller", email: "t.mueller@mueller-metall.de", phone: "+49 711 555 204", website: "mueller-metall.de", city: "Stuttgart", industry: "Metallverarbeitung", employees: 86, roofArea: 3200, pvExisting: false, energyScore: 92, intentScore: 88, stage: "Engaged", dealValue: 42000, notes: "Produktionshalle, hoher Eigenverbrauch plausibel.", createdAt: new Date().toISOString() },
  { id: "l2", company: "SüdLogistik GmbH", contact: "Nina Weber", email: "n.weber@suedlogistik.de", phone: "+49 731 889 120", website: "suedlogistik.de", city: "Ulm", industry: "Logistik", employees: 145, roofArea: 6100, pvExisting: false, energyScore: 96, intentScore: 71, stage: "Kontaktiert", dealValue: 68000, notes: "Große Dachflächen und Fuhrpark – PV + Ladeinfrastruktur.", createdAt: new Date().toISOString() },
  { id: "l3", company: "Hotel Sonnenhof", contact: "Maria König", email: "m.koenig@sonnenhof.de", phone: "+49 8321 450 77", website: "sonnenhof.de", city: "Kempten", industry: "Hotel", employees: 42, roofArea: 1050, pvExisting: true, energyScore: 73, intentScore: 93, stage: "Termin", dealValue: 26000, notes: "Speicher, Wärmepumpe und Energiemanagement prüfen.", createdAt: new Date().toISOString() },
];

const demoCampaigns: Campaign[] = [
  {
    id: "c1", name: "Gewerbedächer BW", audience: "Produktion & Logistik, 20–250 MA, Baden-Württemberg", status: "Aktiv", dailyLimit: 150, createdAt: new Date().toISOString(), sent: 286, replies: 31, positive: 14, appointments: 6,
    steps: [
      { id: "s1", waitDays: 0, subject: "Kurze Frage zu {{company}}", body: "Hallo {{first_name}},\n\nich habe mir den Standort von {{company}} kurz angesehen. Aufgrund Ihrer Gebäudestruktur könnte Eigenstrom für Sie interessant sein.\n\nIch habe eine kurze Voranalyse vorbereitet: {{analysis_link}}\n\nViele Grüße\n{{sender_name}}" },
      { id: "s2", waitDays: 3, subject: "Re: Kurze Frage zu {{company}}", body: "Hallo {{first_name}}, kurze Nachfrage: War die Voranalyse für Sie grundsätzlich relevant?" },
      { id: "s3", waitDays: 7, subject: "Re: Potenzial am Standort {{city}}", body: "Falls das Thema aktuell keine Priorität hat, reicht ein kurzes 'später'. Ansonsten kann ich die Zahlen in 15 Minuten mit Ihnen einordnen." },
    ],
  },
];

const demoMailboxes: Mailbox[] = [
  { id: "m1", name: "Andreas", email: "andreas@outbound.walkenhorst-eko.de", provider: "Google", dailyLimit: 30, sentToday: 18, warmupDay: 21, health: 98, enabled: true, spf: true, dkim: true, dmarc: true },
  { id: "m2", name: "Beratung", email: "beratung@outbound.walkenhorst-eko.de", provider: "Google", dailyLimit: 30, sentToday: 22, warmupDay: 18, health: 96, enabled: true, spf: true, dkim: true, dmarc: true },
  { id: "m3", name: "Gewerbe", email: "gewerbe@outbound.walkenhorst-pv.de", provider: "Microsoft", dailyLimit: 30, sentToday: 16, warmupDay: 16, health: 95, enabled: true, spf: true, dkim: true, dmarc: true },
  { id: "m4", name: "Energie", email: "energie@outbound.walkenhorst-pv.de", provider: "Microsoft", dailyLimit: 30, sentToday: 20, warmupDay: 14, health: 93, enabled: true, spf: true, dkim: true, dmarc: true },
  { id: "m5", name: "Projekt", email: "projekt@outbound.walkenhorst-eko.de", provider: "Google", dailyLimit: 30, sentToday: 12, warmupDay: 12, health: 91, enabled: true, spf: true, dkim: true, dmarc: false },
];

const initialStore: Store = {
  leads: demoLeads,
  campaigns: demoCampaigns,
  mailboxes: demoMailboxes,
  settings: { companyName: "Walkenhorst Energie", senderName: "Andreas Walkenhorst", calendarUrl: "", aiProvider: "OpenAI", timezone: "Europe/Berlin" },
};

function uid(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function money(value: number) { return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value); }
function scoreClass(score: number) { return score >= 85 ? "score score-hot" : score >= 65 ? "score score-warm" : "score"; }
function calcEnergyScore(industry: string, employees: number, roofArea: number, pvExisting: boolean) {
  let score = 30;
  const intensive = ["metall", "produktion", "logistik", "hotel", "bäck", "kunststoff", "maschinen", "lebensmittel"];
  if (intensive.some((x) => industry.toLowerCase().includes(x))) score += 18;
  if (employees >= 20) score += 8;
  if (employees >= 50) score += 8;
  if (roofArea >= 1000) score += 12;
  if (roofArea >= 3000) score += 12;
  if (!pvExisting) score += 10;
  else score -= 8;
  return Math.max(0, Math.min(100, score));
}

export default function EnergyRadarApp() {
  const [section, setSection] = useState<Section>("cockpit");
  const [store, setStore] = useState<Store>(initialStore);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setStore(JSON.parse(saved) as Store);
    } catch { /* keep demo state */ }
    setReady(true);
  }, []);

  useEffect(() => { if (ready) localStorage.setItem(KEY, JSON.stringify(store)); }, [store, ready]);

  function notify(text: string) { setToast(text); window.setTimeout(() => setToast(""), 2400); }

  const stats = useMemo(() => {
    const activeMailboxes = store.mailboxes.filter((m) => m.enabled);
    return {
      leads: store.leads.length,
      hot: store.leads.filter((l) => l.energyScore >= 80 || l.intentScore >= 80).length,
      appointments: store.leads.filter((l) => l.stage === "Termin").length,
      pipeline: store.leads.filter((l) => !["Gewonnen", "Verloren"].includes(l.stage)).reduce((s, l) => s + l.dealValue, 0),
      capacity: activeMailboxes.reduce((s, m) => s + m.dailyLimit, 0),
      sentToday: activeMailboxes.reduce((s, m) => s + m.sentToday, 0),
      health: activeMailboxes.length ? Math.round(activeMailboxes.reduce((s, m) => s + m.health, 0) / activeMailboxes.length) : 0,
    };
  }, [store]);

  const hottest = useMemo(() => [...store.leads].sort((a, b) => (b.energyScore + b.intentScore) - (a.energyScore + a.intentScore)).slice(0, 6), [store.leads]);

  function addLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const industry = String(data.get("industry") || "Sonstige");
    const employees = Number(data.get("employees") || 0);
    const roofArea = Number(data.get("roofArea") || 0);
    const pvExisting = data.get("pvExisting") === "on";
    const lead: Lead = {
      id: uid("lead"), company: String(data.get("company") || "").trim(), contact: String(data.get("contact") || "").trim(), email: String(data.get("email") || "").trim(), phone: String(data.get("phone") || "").trim(), website: String(data.get("website") || "").trim(), city: String(data.get("city") || "").trim(), industry, employees, roofArea, pvExisting,
      energyScore: calcEnergyScore(industry, employees, roofArea, pvExisting), intentScore: 0, stage: "Neu", dealValue: Number(data.get("dealValue") || 0), notes: "", createdAt: new Date().toISOString(),
    };
    if (!lead.company) return notify("Unternehmen fehlt.");
    setStore((s) => ({ ...s, leads: [lead, ...s.leads] }));
    event.currentTarget.reset();
    notify(`${lead.company} wurde analysiert und angelegt.`);
  }

  function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const campaign: Campaign = {
      id: uid("campaign"), name: String(data.get("name") || "Neue Kampagne"), audience: String(data.get("audience") || ""), status: "Entwurf", dailyLimit: Number(data.get("dailyLimit") || 150), createdAt: new Date().toISOString(), sent: 0, replies: 0, positive: 0, appointments: 0,
      steps: [
        { id: uid("step"), waitDays: 0, subject: "Kurze Frage zu {{company}}", body: "Hallo {{first_name}},\n\nich habe mir {{company}} kurz angesehen und eine Potenzialanalyse vorbereitet: {{analysis_link}}\n\nViele Grüße\n{{sender_name}}" },
        { id: uid("step"), waitDays: 3, subject: "Re: Kurze Frage zu {{company}}", body: "Hallo {{first_name}}, kurze Nachfrage zu meiner Analyse – ist das Thema für Sie grundsätzlich relevant?" },
        { id: uid("step"), waitDays: 7, subject: "Re: {{company}}", body: "Wenn das Thema aktuell keine Priorität hat, reicht ein kurzes 'später'." },
      ],
    };
    setStore((s) => ({ ...s, campaigns: [campaign, ...s.campaigns] }));
    event.currentTarget.reset(); notify("Kampagne erstellt.");
  }

  function addMailbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const mailbox: Mailbox = { id: uid("mailbox"), name: String(data.get("name") || "Mailbox"), email: String(data.get("email") || ""), provider: String(data.get("provider") || "Google") as Mailbox["provider"], dailyLimit: 5, sentToday: 0, warmupDay: 1, health: 80, enabled: true, spf: false, dkim: false, dmarc: false };
    if (!mailbox.email.includes("@")) return notify("Bitte gültige E-Mail eintragen.");
    setStore((s) => ({ ...s, mailboxes: [...s.mailboxes, mailbox] }));
    event.currentTarget.reset(); notify("Mailbox angelegt. Versand startet im Ramp-up bei 5/Tag.");
  }

  function setLeadStage(id: string, stage: LeadStage) { setStore((s) => ({ ...s, leads: s.leads.map((l) => l.id === id ? { ...l, stage } : l) })); }
  function toggleCampaign(id: string) { setStore((s) => ({ ...s, campaigns: s.campaigns.map((c) => c.id === id ? { ...c, status: c.status === "Aktiv" ? "Pausiert" : "Aktiv" } : c) })); }
  function toggleMailbox(id: string) { setStore((s) => ({ ...s, mailboxes: s.mailboxes.map((m) => m.id === id ? { ...m, enabled: !m.enabled } : m) })); }
  function warmupMailbox(id: string) {
    setStore((s) => ({ ...s, mailboxes: s.mailboxes.map((m) => {
      if (m.id !== id) return m;
      const day = m.warmupDay + 1;
      const dailyLimit = day < 4 ? 5 : day < 7 ? 10 : day < 11 ? 15 : day < 15 ? 20 : day < 19 ? 25 : 30;
      return { ...m, warmupDay: day, dailyLimit, health: Math.min(100, m.health + (day % 3 === 0 ? 1 : 0)) };
    }) }));
  }

  function resetDemo() { localStorage.removeItem(KEY); setStore(initialStore); notify("Demo-Daten zurückgesetzt."); }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">E</span><div><strong>EnergyRadar</strong><small>AI Revenue Engine</small></div></div>
        <nav>
          {([['cockpit','Cockpit','◈'],['leads','Lead Intelligence','◎'],['campaigns','Kampagnen','↗'],['mailboxes','Mailboxen','✉'],['pipeline','Sales CRM','▦'],['analytics','Analytics','⌁'],['settings','Einstellungen','⚙']] as [Section,string,string][]).map(([id,label,icon]) => (
            <button key={id} className={section === id ? "nav-item active" : "nav-item"} onClick={() => setSection(id)}><span>{icon}</span>{label}</button>
          ))}
        </nav>
        <div className="sidebar-foot"><div className="health-dot" /> <span>System bereit</span><small>Standalone V1</small></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div><small>WALKENHORST ENERGY GROWTH SYSTEM</small><h1>{section === "cockpit" ? "Revenue Cockpit" : section === "leads" ? "Lead Intelligence" : section === "campaigns" ? "Campaign Engine" : section === "mailboxes" ? "Deliverability Center" : section === "pipeline" ? "Sales CRM" : section === "analytics" ? "Revenue Analytics" : "System Settings"}</h1></div><div className="top-actions"><span className="live-pill">● LIVE</span><div className="avatar">AW</div></div></header>

        {section === "cockpit" && <Cockpit stats={stats} hottest={hottest} campaigns={store.campaigns} mailboxes={store.mailboxes} onStage={setLeadStage} />}
        {section === "leads" && <Leads leads={store.leads} addLead={addLead} onStage={setLeadStage} />}
        {section === "campaigns" && <Campaigns campaigns={store.campaigns} createCampaign={createCampaign} toggleCampaign={toggleCampaign} />}
        {section === "mailboxes" && <Mailboxes mailboxes={store.mailboxes} stats={stats} addMailbox={addMailbox} toggleMailbox={toggleMailbox} warmupMailbox={warmupMailbox} />}
        {section === "pipeline" && <Pipeline leads={store.leads} onStage={setLeadStage} />}
        {section === "analytics" && <Analytics leads={store.leads} campaigns={store.campaigns} stats={stats} />}
        {section === "settings" && <SettingsPanel settings={store.settings} setStore={setStore} resetDemo={resetDemo} />}
      </section>
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function Cockpit({ stats, hottest, campaigns, mailboxes, onStage }: { stats: ReturnType<typeof Object>; hottest: Lead[]; campaigns: Campaign[]; mailboxes: Mailbox[]; onStage: (id:string,s:LeadStage)=>void }) {
  const s = stats as { leads:number; hot:number; appointments:number; pipeline:number; capacity:number; sentToday:number; health:number };
  return <div className="content">
    <div className="hero-grid">
      <div className="hero-card"><div><span className="eyebrow">TODAY'S SALES SIGNAL</span><h2>{s.hot} heiße Leads warten auf einen Call.</h2><p>Energy Score, Kampagnenaktivität und Intent werden in einer Priorität zusammengeführt.</p></div><div className="hero-number">{s.hot}<small>HOT</small></div></div>
      <div className="capacity-card"><span>Outbound-Kapazität</span><strong>{s.sentToday} / {s.capacity}</strong><div className="progress"><i style={{width:`${s.capacity ? Math.round((s.sentToday/s.capacity)*100) : 0}%`}} /></div><small>{mailboxes.filter(m=>m.enabled).length} aktive Mailboxen · Health {s.health}%</small></div>
    </div>
    <div className="metric-grid">
      <Metric label="Leads gesamt" value={String(s.leads)} note="im aktuellen Workspace" />
      <Metric label="Hot Leads" value={String(s.hot)} note="Score ≥ 80" />
      <Metric label="Termine" value={String(s.appointments)} note="aktuell in Pipeline" />
      <Metric label="Pipeline" value={money(s.pipeline)} note="offenes Deal-Volumen" />
    </div>
    <div className="two-col">
      <div className="panel"><PanelHead title="🔥 Hot Lead Queue" subtitle="Jetzt zuerst anrufen" /><div className="lead-list">{hottest.map(l=><div className="lead-row" key={l.id}><div><strong>{l.company}</strong><small>{l.city} · {l.industry}</small></div><span className={scoreClass(l.energyScore)}>E {l.energyScore}</span><span className={scoreClass(l.intentScore)}>I {l.intentScore}</span><select value={l.stage} onChange={e=>onStage(l.id,e.target.value as LeadStage)}>{stages.map(st=><option key={st}>{st}</option>)}</select></div>)}</div></div>
      <div className="panel"><PanelHead title="Campaign Pulse" subtitle="Ergebnis statt Vanity Metrics" /><div className="campaign-stack">{campaigns.slice(0,4).map(c=><div className="campaign-mini" key={c.id}><div><strong>{c.name}</strong><small>{c.audience}</small></div><span className={c.status === 'Aktiv' ? 'status-green':'status'}>{c.status}</span><b>{c.appointments} Termine</b></div>)}</div></div>
    </div>
  </div>;
}

function Leads({ leads, addLead, onStage }: { leads:Lead[]; addLead:(e:FormEvent<HTMLFormElement>)=>void; onStage:(id:string,s:LeadStage)=>void }) {
  return <div className="content"><div className="two-col wide-left"><div className="panel"><PanelHead title="Lead Intelligence" subtitle="Unternehmen, Potenzial und Vertriebsstatus" /><div className="table-wrap"><table><thead><tr><th>Unternehmen</th><th>Energy</th><th>Intent</th><th>Dach</th><th>Deal</th><th>Status</th></tr></thead><tbody>{leads.map(l=><tr key={l.id}><td><strong>{l.company}</strong><small>{l.contact || 'Kein Kontakt'} · {l.city}</small></td><td><span className={scoreClass(l.energyScore)}>{l.energyScore}</span></td><td><span className={scoreClass(l.intentScore)}>{l.intentScore}</span></td><td>{l.roofArea.toLocaleString('de-DE')} m²</td><td>{money(l.dealValue)}</td><td><select value={l.stage} onChange={e=>onStage(l.id,e.target.value as LeadStage)}>{stages.map(s=><option key={s}>{s}</option>)}</select></td></tr>)}</tbody></table></div></div>
    <form className="panel form-panel" onSubmit={addLead}><PanelHead title="Neuen Lead analysieren" subtitle="Energy Score wird sofort berechnet" /><Field name="company" label="Unternehmen" required /><Field name="contact" label="Ansprechpartner" /><Field name="email" label="E-Mail" type="email" /><Field name="phone" label="Telefon" /><Field name="website" label="Website" /><Field name="city" label="Ort" /><Field name="industry" label="Branche" placeholder="z. B. Metallverarbeitung" /><div className="split"><Field name="employees" label="Mitarbeiter" type="number" /><Field name="roofArea" label="Dachfläche m²" type="number" /></div><Field name="dealValue" label="Geschätzter Dealwert €" type="number" /><label className="check"><input name="pvExisting" type="checkbox" /> PV bereits vorhanden</label><button className="primary" type="submit">Lead analysieren + speichern</button></form></div></div>;
}

function Campaigns({ campaigns, createCampaign, toggleCampaign }: { campaigns:Campaign[]; createCampaign:(e:FormEvent<HTMLFormElement>)=>void; toggleCampaign:(id:string)=>void }) {
  return <div className="content"><div className="two-col wide-left"><div className="panel"><PanelHead title="High-End Campaign Engine" subtitle="Sequenzen, Personalisierung und Revenue Tracking" />{campaigns.map(c=><div className="campaign-card" key={c.id}><div className="campaign-head"><div><span className="eyebrow">{c.status}</span><h3>{c.name}</h3><p>{c.audience}</p></div><button className="ghost" onClick={()=>toggleCampaign(c.id)}>{c.status === 'Aktiv' ? 'Pausieren':'Aktivieren'}</button></div><div className="campaign-metrics"><span><small>Gesendet</small><b>{c.sent}</b></span><span><small>Replies</small><b>{c.replies}</b></span><span><small>Positiv</small><b>{c.positive}</b></span><span><small>Termine</small><b>{c.appointments}</b></span></div><div className="sequence">{c.steps.map((step,i)=><div className="sequence-step" key={step.id}><span>{i+1}</span><div><small>{step.waitDays ? `Warte ${step.waitDays} Tage`:'Sofort'}</small><strong>{step.subject}</strong><p>{step.body.slice(0,115)}…</p></div></div>)}</div></div>)}</div>
  <form className="panel form-panel" onSubmit={createCampaign}><PanelHead title="Neue Kampagne" subtitle="3-Step Sequence inklusive" /><Field name="name" label="Kampagnenname" required /><label>Zielgruppe<textarea name="audience" required placeholder="z. B. Produktionsunternehmen BW, 20–250 Mitarbeiter, große Dachflächen" /></label><Field name="dailyLimit" label="Tageslimit gesamt" type="number" placeholder="150" /><button className="primary" type="submit">Kampagne erstellen</button><div className="callout">KI-Erstellung, A/B/C-Varianten und externe Versand-Provider sind als nächste Integrationsschicht vorgesehen.</div></form></div></div>;
}

function Mailboxes({ mailboxes, stats, addMailbox, toggleMailbox, warmupMailbox }: { mailboxes:Mailbox[]; stats:ReturnType<typeof Object>; addMailbox:(e:FormEvent<HTMLFormElement>)=>void; toggleMailbox:(id:string)=>void; warmupMailbox:(id:string)=>void }) {
 const s=stats as {capacity:number;sentToday:number;health:number}; return <div className="content"><div className="metric-grid"><Metric label="Kapazität / Tag" value={String(s.capacity)} note="über aktive Mailboxen" /><Metric label="Heute gesendet" value={String(s.sentToday)} note="simulierter Versandzähler" /><Metric label="Ø Health" value={`${s.health}%`} note="Sender-Reputation" /><Metric label="Mailboxen" value={String(mailboxes.length)} note="Rotation-ready" /></div><div className="two-col wide-left"><div className="panel"><PanelHead title="Mailbox Rotation & Deliverability" subtitle="SPF · DKIM · DMARC · Ramp-up" /><div className="mailboxes">{mailboxes.map(m=><div className="mailbox-card" key={m.id}><div className="mailbox-top"><div className="mail-icon">✉</div><div><strong>{m.email}</strong><small>{m.provider} · Warm-up Tag {m.warmupDay}</small></div><button className={m.enabled?'switch on':'switch'} onClick={()=>toggleMailbox(m.id)}><i /></button></div><div className="mail-health"><span>Health <b>{m.health}%</b></span><span>{m.sentToday}/{m.dailyLimit} heute</span></div><div className="progress"><i style={{width:`${m.health}%`}} /></div><div className="dns"><span className={m.spf?'ok':''}>SPF</span><span className={m.dkim?'ok':''}>DKIM</span><span className={m.dmarc?'ok':''}>DMARC</span><button className="link-btn" onClick={()=>warmupMailbox(m.id)}>+ Warm-up Tag</button></div></div>)}</div></div><form className="panel form-panel" onSubmit={addMailbox}><PanelHead title="Mailbox verbinden" subtitle="Neue Accounts starten automatisch niedrig" /><Field name="name" label="Name" /><Field name="email" label="E-Mail" type="email" required /><label>Provider<select name="provider"><option>Google</option><option>Microsoft</option><option>SMTP</option></select></label><button className="primary" type="submit">Mailbox anlegen</button><div className="callout"><b>Sicherer Ramp-up:</b> 5 → 10 → 15 → 20 → 25 → 30 E-Mails/Tag. Kein Spamfilter-Trick, sondern kontrollierte Sender-Reputation.</div></form></div></div>;
}

function Pipeline({ leads, onStage }: { leads:Lead[]; onStage:(id:string,s:LeadStage)=>void }) { return <div className="content"><div className="kanban">{stages.map(stage=><div className="kanban-col" key={stage}><div className="kanban-title"><strong>{stage}</strong><span>{leads.filter(l=>l.stage===stage).length}</span></div>{leads.filter(l=>l.stage===stage).map(l=><div className="deal-card" key={l.id}><span className={scoreClass(l.energyScore)}>E {l.energyScore}</span><h4>{l.company}</h4><p>{l.contact || l.city}</p><b>{money(l.dealValue)}</b><select value={l.stage} onChange={e=>onStage(l.id,e.target.value as LeadStage)}>{stages.map(s=><option key={s}>{s}</option>)}</select></div>)}</div>)}</div></div>; }

function Analytics({ leads, campaigns, stats }: { leads:Lead[]; campaigns:Campaign[]; stats:ReturnType<typeof Object> }) {
 const s=stats as {pipeline:number}; const sent=campaigns.reduce((a,c)=>a+c.sent,0); const replies=campaigns.reduce((a,c)=>a+c.replies,0); const positive=campaigns.reduce((a,c)=>a+c.positive,0); const appointments=campaigns.reduce((a,c)=>a+c.appointments,0); const won=leads.filter(l=>l.stage==='Gewonnen').reduce((a,l)=>a+l.dealValue,0); return <div className="content"><div className="metric-grid"><Metric label="Reply Rate" value={`${sent?((replies/sent)*100).toFixed(1):0}%`} note={`${replies} Antworten`} /><Metric label="Positive Reply" value={`${replies?((positive/replies)*100).toFixed(1):0}%`} note={`${positive} positive`} /><Metric label="Appointment Rate" value={`${sent?((appointments/sent)*100).toFixed(1):0}%`} note={`${appointments} Termine`} /><Metric label="Gewonnener Umsatz" value={money(won)} note={`Pipeline ${money(s.pipeline)}`} /></div><div className="panel"><PanelHead title="Segment Performance" subtitle="Welche Zielgruppen verdienen mehr Budget?" /><div className="segment-bars">{Array.from(new Set(leads.map(l=>l.industry))).map(ind=>{const group=leads.filter(l=>l.industry===ind);const avg=Math.round(group.reduce((a,l)=>a+l.energyScore,0)/group.length);return <div key={ind}><span>{ind}</span><div className="bar"><i style={{width:`${avg}%`}} /></div><b>{avg}</b></div>})}</div></div></div>;
}

function SettingsPanel({ settings, setStore, resetDemo }: { settings:Settings; setStore:React.Dispatch<React.SetStateAction<Store>>; resetDemo:()=>void }) { return <div className="content"><div className="two-col"><div className="panel form-panel"><PanelHead title="Workspace" subtitle="Basis für Personalisierung" /><Field label="Unternehmen" value={settings.companyName} onChange={v=>setStore(s=>({...s,settings:{...s.settings,companyName:v}}))} /><Field label="Absendername" value={settings.senderName} onChange={v=>setStore(s=>({...s,settings:{...s.settings,senderName:v}}))} /><Field label="Kalender URL" value={settings.calendarUrl} onChange={v=>setStore(s=>({...s,settings:{...s.settings,calendarUrl:v}}))} /><label>AI Provider<select value={settings.aiProvider} onChange={e=>setStore(s=>({...s,settings:{...s.settings,aiProvider:e.target.value}}))}><option>OpenAI</option><option>Anthropic</option><option>Gemini</option></select></label></div><div className="panel"><PanelHead title="Integration Status" subtitle="V1 ist standalone lauffähig" /><div className="integration-list"><div><span className="integration-icon ok-bg">✓</span><div><strong>CRM & Pipeline</strong><small>aktiv</small></div></div><div><span className="integration-icon ok-bg">✓</span><div><strong>Campaign Builder</strong><small>aktiv</small></div></div><div><span className="integration-icon ok-bg">✓</span><div><strong>Energy Scoring</strong><small>aktiv</small></div></div><div><span className="integration-icon">○</span><div><strong>Google / Microsoft OAuth</strong><small>Credentials erforderlich</small></div></div><div><span className="integration-icon">○</span><div><strong>KI & Satellitendaten</strong><small>API-Keys erforderlich</small></div></div></div><button className="danger" onClick={resetDemo}>Demo-Daten zurücksetzen</button></div></div></div>; }

function Metric({label,value,note}:{label:string;value:string;note:string}) { return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function PanelHead({title,subtitle}:{title:string;subtitle:string}) { return <div className="panel-head"><div><h3>{title}</h3><p>{subtitle}</p></div></div>; }
function Field(props:{name?:string;label:string;type?:string;placeholder?:string;required?:boolean;value?:string;onChange?:(v:string)=>void}) { return <label>{props.label}<input name={props.name} type={props.type||"text"} placeholder={props.placeholder} required={props.required} value={props.value} onChange={props.onChange?e=>props.onChange!(e.target.value):undefined} /></label>; }
