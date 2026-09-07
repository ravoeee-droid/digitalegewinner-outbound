"use client";

import Link from "next/link";
import { DragEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./revenue-outbound-os.module.css";
import pro from "./revenue-outbound-os-pro.module.css";

type ProductKey = "pflege_recruiting" | "website" | "seo" | "automation";
type RevenueStage = "Neu" | "Geprüft" | "Call bereit" | "Kontaktiert" | "Nachfassen" | "Interesse" | "Termin" | "Angebot" | "Verhandlung" | "Gewonnen" | "Verloren";
type View = "dashboard" | "today" | "pipeline" | "followups" | "deals" | "multichannel";
type FilterMode = "all" | "due" | "hot" | "phone";

type CatalogItem = {
  key: ProductKey;
  label: string;
  shortLabel: string;
  description: string;
  setup: number;
  monthly: number;
  accent: string;
};

type Opportunity = {
  id: string;
  lead_id: string;
  company_id: string;
  product_key: ProductKey;
  stage: RevenueStage;
  status: string;
  source?: string;
  setup_value: number;
  monthly_value: number;
  probability: number;
  score: number;
  next_action: string;
  next_action_at: string | null;
  notes: string;
  company: string;
  city: string;
  industry: string;
  website: string;
  phone: string;
  email: string;
  lead_priority: number;
  lead_opportunity: number;
  website_score: number;
  seo_score: number;
  annual_value: number;
  weighted_value: number;
  call_score: number;
  signal_summary: string;
  updated_at: string;
};

type ProductStat = {
  key: ProductKey;
  label: string;
  shortLabel: string;
  description: string;
  accent: string;
  open: number;
  callReady: number;
  annualPotential: number;
  weightedPotential: number;
  mrrPotential: number;
};

type Activity = { id: number; lead_id: string; company_id: string; type: string; summary: string; created_at: string };

type Snapshot = {
  catalog: Record<ProductKey, CatalogItem>;
  stages: RevenueStage[];
  stats: {
    openOpportunities: number;
    callReady: number;
    annualPotential: number;
    weightedPotential: number;
    mrrPotential: number;
    wonRevenue: number;
    dueActions: number;
  };
  today: { calls: number; connected: number; interested: number; meetings: number; offers: number; wins: number; activities: number };
  productStats: ProductStat[];
  opportunities: Opportunity[];
  activities: Activity[];
};

const OUTCOMES = ["Nicht erreicht", "Erreicht", "Interesse", "Termin", "Angebot", "Gewonnen", "Verloren"] as const;
const ACTIVE_CALL_STAGES: RevenueStage[] = ["Neu", "Geprüft", "Call bereit", "Kontaktiert", "Nachfassen", "Interesse"];
const PIPELINE_STAGES: RevenueStage[] = ["Neu", "Geprüft", "Call bereit", "Kontaktiert", "Nachfassen", "Interesse", "Termin", "Angebot", "Verhandlung", "Gewonnen"];
const EMPTY_CATALOG: Record<ProductKey, CatalogItem> = {
  pflege_recruiting: { key: "pflege_recruiting", label: "Pflege Social Recruiting", shortLabel: "Recruiting", description: "Mitarbeitergewinnung", setup: 3000, monthly: 1990, accent: "lime" },
  website: { key: "website", label: "Website Relaunch", shortLabel: "Website", description: "Conversion & Vertrauen", setup: 2490, monthly: 0, accent: "violet" },
  seo: { key: "seo", label: "SEO / Local Growth", shortLabel: "SEO", description: "Google Sichtbarkeit", setup: 1500, monthly: 1990, accent: "cyan" },
  automation: { key: "automation", label: "KI / Automation", shortLabel: "Automation", description: "Anruf & Follow-up", setup: 1500, monthly: 200, accent: "amber" },
};
const EMPTY: Snapshot = {
  catalog: EMPTY_CATALOG,
  stages: [...PIPELINE_STAGES, "Verloren"],
  stats: { openOpportunities: 0, callReady: 0, annualPotential: 0, weightedPotential: 0, mrrPotential: 0, wonRevenue: 0, dueActions: 0 },
  today: { calls: 0, connected: 0, interested: 0, meetings: 0, offers: 0, wins: 0, activities: 0 },
  productStats: [],
  opportunities: [],
  activities: [],
};

function euro(value: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function compactEuro(value: number) {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1).replace(".", ",")} Mio. €`;
  if (number >= 1000) return `${Math.round(number / 1000)}k €`;
  return `${Math.round(number)} €`;
}

function cleanPhone(value: string) { return value.replace(/[^\d+]/g, ""); }
function due(value: string | null) { return Boolean(value && new Date(value).getTime() <= Date.now()); }
function stageIndex(stage: RevenueStage) { return PIPELINE_STAGES.indexOf(stage); }
function stageProgress(stage: RevenueStage) { const index = stageIndex(stage); return index < 0 ? 0 : Math.round(((index + 1) / PIPELINE_STAGES.length) * 100); }
function rate(value: number, base: number) { return base > 0 ? Math.round(value / base * 100) : 0; }
function tomorrow(days = 1) { return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(); }
function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}
function dateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function productClass(key: ProductKey) {
  if (key === "pflege_recruiting") return styles.productRecruiting;
  if (key === "website") return styles.productWebsite;
  if (key === "seo") return styles.productSeo;
  return styles.productAutomation;
}

export default function RevenueOutboundOS() {
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [view, setView] = useState<View>("dashboard");
  const [product, setProduct] = useState<"all" | ProductKey>("all");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setBusy((current) => current || "load");
    setError("");
    try {
      const response = await fetch("/api/revenue-opportunities", { cache: "no-store" });
      const json = await response.json() as Snapshot & { error?: string };
      if (!response.ok) throw new Error(json.error || "Revenue OS konnte nicht geladen werden.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revenue OS konnte nicht geladen werden.");
    } finally {
      setBusy((current) => current === "load" ? "" : current);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.opportunities.filter((item) => {
      if (product !== "all" && item.product_key !== product) return false;
      if (!q) return true;
      return [item.company, item.city, item.industry, item.signal_summary, item.phone, item.email, data.catalog[item.product_key]?.label]
        .join(" ").toLowerCase().includes(q);
    });
  }, [data.opportunities, data.catalog, product, search]);

  const filtered = useMemo(() => scoped.filter((item) => {
    if (filterMode === "due") return due(item.next_action_at) || item.stage === "Nachfassen";
    if (filterMode === "hot") return item.lead_priority >= 80 || item.call_score >= 420;
    if (filterMode === "phone") return Boolean(item.phone);
    return true;
  }), [scoped, filterMode]);

  const activeScope = useMemo(() => scoped.filter((item) => item.status === "open" && !["Gewonnen", "Verloren"].includes(item.stage)), [scoped]);
  const callQueue = useMemo(() => filtered
    .filter((item) => item.status === "open" && ACTIVE_CALL_STAGES.includes(item.stage) && Boolean(item.phone))
    .filter((item) => item.stage !== "Nachfassen" || !item.next_action_at || due(item.next_action_at))
    .sort((a, b) => b.call_score - a.call_score), [filtered]);
  const followups = useMemo(() => scoped
    .filter((item) => item.status === "open" && (item.stage === "Nachfassen" || Boolean(item.next_action_at)))
    .sort((a, b) => {
      const ad = a.next_action_at ? new Date(a.next_action_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bd = b.next_action_at ? new Date(b.next_action_at).getTime() : Number.MAX_SAFE_INTEGER;
      return ad - bd || b.call_score - a.call_score;
    }), [scoped]);
  const nextDeal = callQueue[0] || null;
  const selected = useMemo(() => data.opportunities.find((item) => item.id === selectedId) || null, [data.opportunities, selectedId]);
  const currentProductStats = useMemo(() => product === "all" ? null : data.productStats.find((item) => item.key === product) || null, [data.productStats, product]);
  const leadProducts = useMemo(() => selected ? new Set(data.opportunities.filter((item) => item.lead_id === selected.lead_id).map((item) => item.product_key)) : new Set<ProductKey>(), [data.opportunities, selected]);
  const related = useMemo(() => selected ? data.opportunities.filter((item) => item.lead_id === selected.lead_id) : [], [data.opportunities, selected]);
  const selectedActivities = useMemo(() => selected ? data.activities.filter((item) => item.lead_id === selected.lead_id).slice(0, 10) : [], [data.activities, selected]);
  const pipelineRows = useMemo(() => filtered.filter((item) => item.stage !== "Verloren"), [filtered]);
  const lostRows = useMemo(() => filtered.filter((item) => item.stage === "Verloren"), [filtered]);
  const queueValue = useMemo(() => callQueue.reduce((sum, item) => sum + item.annual_value, 0), [callQueue]);
  const headlinePotential = currentProductStats?.annualPotential ?? data.stats.annualPotential;
  const scopePotential = useMemo(() => activeScope.reduce((sum, item) => sum + item.annual_value, 0), [activeScope]);
  const scopeWeighted = useMemo(() => activeScope.reduce((sum, item) => sum + item.weighted_value, 0), [activeScope]);
  const dueNow = useMemo(() => followups.filter((item) => due(item.next_action_at)).length, [followups]);

  const funnel = useMemo(() => {
    const rows = scoped.filter((item) => item.stage !== "Verloren");
    const countAt = (stage: RevenueStage) => rows.filter((item) => item.stage === stage || (stage !== "Neu" && stageIndex(item.stage) >= stageIndex(stage))).length;
    return [
      { label: "Call bereit", stage: "Call bereit" as RevenueStage, count: rows.filter((item) => Boolean(item.phone) && ACTIVE_CALL_STAGES.includes(item.stage)).length },
      { label: "Kontaktiert", stage: "Kontaktiert" as RevenueStage, count: countAt("Kontaktiert") },
      { label: "Interesse", stage: "Interesse" as RevenueStage, count: countAt("Interesse") },
      { label: "Termin", stage: "Termin" as RevenueStage, count: countAt("Termin") },
      { label: "Angebot", stage: "Angebot" as RevenueStage, count: countAt("Angebot") },
      { label: "Gewonnen", stage: "Gewonnen" as RevenueStage, count: rows.filter((item) => item.stage === "Gewonnen").length },
    ];
  }, [scoped]);

  async function mutate(method: "PATCH" | "POST", body: Record<string, unknown>, label: string) {
    setBusy(label);
    setError("");
    try {
      const response = await fetch("/api/revenue-opportunities", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json() as Snapshot & { error?: string };
      if (!response.ok) throw new Error(json.error || "Aktion fehlgeschlagen.");
      setData(json);
      setToast(label);
      return json;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aktion fehlgeschlagen.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function patchOpportunity(id: string, patch: Record<string, unknown>, label = "Gespeichert") {
    return mutate("PATCH", { id, ...patch }, label);
  }

  function dial(item: Opportunity) {
    const number = cleanPhone(item.phone);
    if (!number) return setToast("Keine Telefonnummer vorhanden");
    window.dispatchEvent(new CustomEvent("cloudtalk:dial", { detail: { leadId: item.lead_id, company: item.company, phone: number } }));
    const anchor = document.createElement("a");
    anchor.href = `ct+tel:${number}`;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function outcome(item: Opportunity, result: typeof OUTCOMES[number]) {
    const labels: Record<typeof OUTCOMES[number], string> = {
      "Nicht erreicht": "Nicht erreicht · morgen wieder vorgelegt",
      Erreicht: "Gespräch gespeichert",
      Interesse: "Interesse · Lead hochgestuft",
      Termin: "Termin · Pipeline aktualisiert",
      Angebot: "Angebot · Deal weitergeschoben",
      Gewonnen: "Gewonnen · Umsatz gesichert",
      Verloren: "Verloren gespeichert",
    };
    await patchOpportunity(item.id, { outcome: result }, labels[result]);
  }

  async function move(event: DragEvent<HTMLDivElement>, stage: RevenueStage) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/opportunity");
    if (!id) return;
    await patchOpportunity(id, { stage }, `→ ${stage}`);
  }

  async function advance(item: Opportunity) {
    const index = PIPELINE_STAGES.indexOf(item.stage);
    if (index < 0 || index >= PIPELINE_STAGES.length - 1) return;
    const stage = PIPELINE_STAGES[index + 1];
    await patchOpportunity(item.id, { stage }, `${item.company} → ${stage}`);
  }

  async function snooze(item: Opportunity, days = 1) {
    await patchOpportunity(item.id, {
      stage: "Nachfassen",
      nextAction: days === 1 ? "Morgen zurückrufen" : `In ${days} Tagen nachfassen`,
      nextActionAt: tomorrow(days),
    }, days === 1 ? "Morgen wieder vorgelegt" : `In ${days} Tagen wieder vorgelegt`);
  }

  async function saveInspector(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    await patchOpportunity(selected.id, {
      stage: String(form.get("stage") || selected.stage),
      setupValue: Number(form.get("setupValue") || 0),
      monthlyValue: Number(form.get("monthlyValue") || 0),
      probability: Number(form.get("probability") || 0),
      nextAction: String(form.get("nextAction") || ""),
      nextActionAt: String(form.get("nextActionAt") || "") || null,
      notes: String(form.get("notes") || ""),
    }, "Opportunity gespeichert");
  }

  async function addProduct(key: ProductKey) {
    if (!selected) return;
    await mutate("POST", { action: "add-product", leadId: selected.lead_id, productKey: key }, `${data.catalog[key].shortLabel} hinzugefügt`);
  }

  function openOpportunity(item: Opportunity) { setSelectedId(item.id); }
  function resetFilters() { setProduct("all"); setFilterMode("all"); setSearch(""); }

  const productButtons: Array<{ key: "all" | ProductKey; label: string }> = [
    { key: "all", label: "Alle Pipelines" },
    { key: "pflege_recruiting", label: "Recruiting" },
    { key: "website", label: "Website" },
    { key: "seo", label: "SEO" },
    { key: "automation", label: "Automation" },
  ];
  const views: Array<{ id: View; label: string }> = [
    { id: "dashboard", label: "Dashboard" },
    { id: "today", label: "Calls" },
    { id: "pipeline", label: "Pipeline" },
    { id: "followups", label: "Nachfassen" },
    { id: "deals", label: "Deals" },
  ];

  return (
    <main className={styles.root}>
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            <div className={styles.logo}>DG</div>
            <div><strong>Digitale Gewinner</strong><span>REVENUE OUTBOUND OS</span></div>
          </div>

          <div className={styles.sideLabel}>ÜBERSICHT</div>
          <nav className={styles.mainNav} aria-label="Übersicht">
            <button className={view === "dashboard" ? styles.activeNav : ""} onClick={() => setView("dashboard")}><i>◫</i><span>Dashboard</span><b>{compactEuro(data.stats.weightedPotential)}</b></button>
          </nav>

          <div className={styles.sideLabel}>VERTRIEB</div>
          <nav className={styles.mainNav} aria-label="Vertrieb">
            <button className={view === "today" ? styles.activeNav : ""} onClick={() => setView("today")}><i>☎</i><span>Power Dial</span><b>{data.stats.callReady}</b></button>
            <button className={view === "pipeline" ? styles.activeNav : ""} onClick={() => setView("pipeline")}><i>▥</i><span>Pipeline</span><b>{data.stats.openOpportunities}</b></button>
            <button className={view === "followups" ? styles.activeNav : ""} onClick={() => setView("followups")}><i>↻</i><span>Nachfassen</span><b>{dueNow || data.stats.dueActions}</b></button>
            <button className={view === "deals" ? styles.activeNav : ""} onClick={() => setView("deals")}><i>€</i><span>Deals & Potenzial</span><b>{compactEuro(data.stats.weightedPotential)}</b></button>
            <button className={view === "multichannel" ? styles.activeNav : ""} onClick={() => setView("multichannel")}><i>↗</i><span>Tools & Kanäle</span><b>5</b></button>
          </nav>

          <div className={styles.sideLabel}>PRODUKT-PIPELINES</div>
          <div className={styles.productNav}>
            {data.productStats.map((item) => (
              <button key={item.key} className={`${productClass(item.key)} ${product === item.key ? styles.productActive : ""}`} onClick={() => { setProduct(item.key); setView("pipeline"); }}>
                <span><i /><strong>{item.shortLabel}</strong></span>
                <small>{item.callReady} call-ready · {item.open} offen</small>
                <b>{compactEuro(item.annualPotential)}</b>
              </button>
            ))}
          </div>

          <div className={styles.sideFooter}>
            <Link href="/outreach">Inbox / Mail</Link>
            <Link href="/">Pflege CRM</Link>
            <Link href="/studio">Studio</Link>
          </div>
        </aside>

        <section className={styles.workspace}>
          <header className={styles.topbar}>
            <div className={styles.mobileBrand}><span>DG</span><strong>Revenue Outbound</strong></div>
            <div className={styles.productSwitch}>
              {productButtons.map((item) => <button key={item.key} className={product === item.key ? styles.productSwitchActive : ""} onClick={() => setProduct(item.key)}>{item.label}</button>)}
            </div>
            <div className={pro.searchWrap}>
              <span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Lead, Stadt, Signal suchen …" aria-label="Leads durchsuchen" />
              {search && <button onClick={() => setSearch("")}>×</button>}
            </div>
            <div className={styles.topActions}>
              <button onClick={() => void mutate("POST", { action: "refresh" }, "Signale & Opportunities aktualisiert")} disabled={Boolean(busy)}>↻ Signale</button>
              <Link href="/call">☎ Rapid Call</Link>
            </div>
            <div className={pro.mobileTabs}>{views.map((item) => <button key={item.id} className={view === item.id ? pro.mobileTabActive : ""} onClick={() => setView(item.id)}>{item.label}</button>)}</div>
          </header>

          <div className={styles.content}>
            {error && <div className={styles.error}>{error}</div>}
            {toast && <div className={styles.toast}>{toast}</div>}

            <section className={styles.kpiStrip}>
              <div><span>Offenes Umsatzpotenzial</span><strong>{compactEuro(product === "all" ? data.stats.annualPotential : headlinePotential)}</strong><small>Setup + 12 Monate</small></div>
              <div><span>Gewichtete Pipeline</span><strong>{compactEuro(product === "all" ? data.stats.weightedPotential : currentProductStats?.weightedPotential || 0)}</strong><small>mit Abschlusswahrscheinlichkeit</small></div>
              <div><span>MRR-Potenzial</span><strong>{compactEuro(product === "all" ? data.stats.mrrPotential : currentProductStats?.mrrPotential || 0)}</strong><small>monatlich wiederkehrend</small></div>
              <div><span>Heute</span><strong>{data.today.calls} Calls · {data.today.meetings} Termine</strong><small>{data.stats.dueActions} Aktionen fällig</small></div>
            </section>

            <div className={pro.filterBar}>
              <div>
                <button className={filterMode === "all" ? pro.filterActive : ""} onClick={() => setFilterMode("all")}>Alle</button>
                <button className={filterMode === "due" ? pro.filterActive : ""} onClick={() => setFilterMode("due")}>Fällig <b>{dueNow}</b></button>
                <button className={filterMode === "hot" ? pro.filterActive : ""} onClick={() => setFilterMode("hot")}>Hot</button>
                <button className={filterMode === "phone" ? pro.filterActive : ""} onClick={() => setFilterMode("phone")}>Mit Telefon</button>
              </div>
              <span>{filtered.length} Chancen im aktuellen Filter{(search || product !== "all" || filterMode !== "all") && <button onClick={resetFilters}>Filter zurücksetzen</button>}</span>
            </div>

            {view === "dashboard" && (
              <section className={pro.dashboard}>
                <div className={styles.sectionHead}>
                  <div><span>SALES CONTROL CENTER</span><h1>Heute sehen. Heute handeln. Heute closen.</h1><p>Wie bei einem starken Dialer-Dashboard – nur zusätzlich mit Produkt-, Umsatz- und Signalintelligenz.</p></div>
                  <div className={styles.queueValue}><small>Aktueller Scope</small><strong>{compactEuro(scopeWeighted)}</strong><span>{activeScope.length} offene Chancen</span></div>
                </div>

                <div className={pro.dailyMetrics}>
                  <Metric label="Wählversuche" value={data.today.calls} note="heute" />
                  <Metric label="Echte Gespräche" value={data.today.connected} note={`${rate(data.today.connected, data.today.calls)}% Connect`} />
                  <Metric label="Interesse" value={data.today.interested} note={`${rate(data.today.interested, data.today.connected)}% Quali`} />
                  <Metric label="Termine" value={data.today.meetings} note={`${rate(data.today.meetings, data.today.connected)}% Terminrate`} />
                  <Metric label="Angebote" value={data.today.offers} note="heute" />
                  <Metric label="Abschlüsse" value={data.today.wins} note={data.today.wins ? "Umsatz gesichert" : "nächster Meilenstein"} accent />
                </div>

                <div className={pro.dashboardGrid}>
                  <div className={pro.panel}>
                    <div className={pro.panelHead}><div><span>PIPELINE-FLOW</span><strong>Wo stehen die Chancen?</strong></div><b>{compactEuro(scopePotential)}</b></div>
                    <div className={pro.funnel}>
                      {funnel.map((step) => {
                        const max = Math.max(1, funnel[0]?.count || 1);
                        return <button key={step.label} onClick={() => setView("pipeline")}><div><span>{step.label}</span><b>{step.count}</b></div><div className={pro.funnelTrack}><i style={{ width: `${Math.max(4, Math.round(step.count / max * 100))}%` }} /></div></button>;
                      })}
                    </div>
                  </div>

                  <div className={pro.panel}>
                    <div className={pro.panelHead}><div><span>CONVERSION</span><strong>Qualität statt Aktivität</strong></div></div>
                    <div className={pro.rateGrid}>
                      <RateCard label="Connect Rate" value={rate(data.today.connected, data.today.calls)} />
                      <RateCard label="Interesse / Gespräch" value={rate(data.today.interested, data.today.connected)} />
                      <RateCard label="Termin / Gespräch" value={rate(data.today.meetings, data.today.connected)} />
                      <RateCard label="Close / Angebot" value={rate(data.today.wins, data.today.offers)} />
                    </div>
                    <button className={pro.primaryCta} onClick={() => setView("today")}>☎ Nächsten besten Lead anrufen <span>{callQueue.length} bereit</span></button>
                  </div>
                </div>

                <div className={pro.dashboardLower}>
                  <div className={pro.panel}>
                    <div className={pro.panelHead}><div><span>PRODUKT-PIPELINES</span><strong>Wo liegt das meiste Geld?</strong></div></div>
                    <div className={pro.productMatrix}>
                      {data.productStats.map((item) => <button key={item.key} className={productClass(item.key)} onClick={() => { setProduct(item.key); setView("pipeline"); }}><i /><div><strong>{item.shortLabel}</strong><span>{item.open} Chancen · {item.callReady} anrufbereit</span></div><b>{compactEuro(item.annualPotential)}</b><small>{compactEuro(item.weightedPotential)} gewichtet</small></button>)}
                    </div>
                  </div>

                  <div className={pro.panel}>
                    <div className={pro.panelHead}><div><span>JETZT FÄLLIG</span><strong>Nichts fällt hinten runter</strong></div><b>{dueNow}</b></div>
                    <div className={pro.focusList}>
                      {followups.filter((item) => due(item.next_action_at)).slice(0, 6).map((item) => <button key={item.id} onClick={() => openOpportunity(item)}><div><strong>{item.company}</strong><span>{data.catalog[item.product_key].shortLabel} · {item.next_action}</span></div><b>{formatDateTime(item.next_action_at)}</b></button>)}
                      {!followups.some((item) => due(item.next_action_at)) && <div className={pro.calmState}>Keine überfälligen Wiedervorlagen.</div>}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {view === "today" && (
              <div className={styles.todayGrid}>
                <section className={styles.primaryColumn}>
                  <div className={styles.sectionHead}>
                    <div><span>POWER DIAL</span><h1>Ein Lead. Ein Produkt. Eine Aktion.</h1><p>Keine Suche, kein Überlegen: der stärkste fällige Deal steht immer oben.</p></div>
                    <div className={styles.queueValue}><small>Potenzial in Call-Queue</small><strong>{compactEuro(queueValue)}</strong><span>{callQueue.length} Leads</span></div>
                  </div>

                  {nextDeal ? (
                    <article className={`${styles.nextDeal} ${productClass(nextDeal.product_key)}`}>
                      <div className={styles.nextDealTop}>
                        <div><span className={styles.productBadge}>{data.catalog[nextDeal.product_key].label}</span><h2>{nextDeal.company}</h2><p>{[nextDeal.city, nextDeal.industry].filter(Boolean).join(" · ") || "Unternehmen"}</p></div>
                        <div className={styles.dealScore}><small>CALL SCORE</small><strong>{nextDeal.call_score}</strong><span>Priority {nextDeal.lead_priority}/100</span></div>
                      </div>
                      <div className={styles.signalBox}><span>WARUM JETZT?</span><strong>{nextDeal.signal_summary}</strong><div>{nextDeal.website_score > 0 && <b>Website {nextDeal.website_score}/100</b>}{nextDeal.seo_score > 0 && nextDeal.product_key === "seo" && <b>SEO {nextDeal.seo_score}/100</b>}<b>{nextDeal.stage}</b>{due(nextDeal.next_action_at) && <b className={styles.dueTag}>JETZT FÄLLIG</b>}</div></div>
                      <div className={styles.valueGrid}><div><span>Setup-Potenzial</span><strong>{euro(nextDeal.setup_value)}</strong></div><div><span>MRR-Potenzial</span><strong>{euro(nextDeal.monthly_value)}</strong></div><div><span>12M Deal-Potenzial</span><strong>{euro(nextDeal.annual_value)}</strong></div><div><span>Gewichtet</span><strong>{euro(nextDeal.weighted_value)}</strong></div></div>
                      <div className={styles.callBar}><button className={styles.callButton} onClick={() => dial(nextDeal)}>☎ Jetzt {nextDeal.phone} anrufen</button>{nextDeal.website && <a href={nextDeal.website} target="_blank" rel="noreferrer">↗ Website</a>}{nextDeal.email && <a href={`mailto:${nextDeal.email}`}>✉ Mail</a>}<button onClick={() => void snooze(nextDeal)}>↻ Morgen</button><button onClick={() => openOpportunity(nextDeal)}>Details</button></div>
                      <div className={styles.outcomes}><span>Nach dem Call → Ergebnis klicken → nächster Lead</span><div>{OUTCOMES.map((item) => <button key={item} disabled={Boolean(busy)} className={item === "Gewonnen" ? styles.winOutcome : item === "Verloren" ? styles.lostOutcome : ""} onClick={() => void outcome(nextDeal, item)}>{item}</button>)}</div></div>
                    </article>
                  ) : <div className={styles.emptyState}><strong>Queue leer.</strong><span>Filter zurücksetzen, andere Pipeline wählen oder Signale aktualisieren.</span></div>}

                  <div className={styles.queueHeader}><div><span>CALL QUEUE</span><strong>Danach kommt</strong></div><small>höchstes Umsatz- und Abschluss-Potenzial zuerst</small></div>
                  <div className={styles.callQueue}>
                    {callQueue.slice(1, 18).map((item, index) => <button key={item.id} className={styles.queueRow} onClick={() => openOpportunity(item)}><i>{String(index + 2).padStart(2, "0")}</i><div className={styles.queueCompany}><strong>{item.company}</strong><span>{item.signal_summary}</span></div><span className={`${styles.tinyProduct} ${productClass(item.product_key)}`}>{data.catalog[item.product_key].shortLabel}</span><div className={styles.queueRevenue}><strong>{compactEuro(item.annual_value)}</strong><small>{euro(item.setup_value)} Setup · {euro(item.monthly_value)} MRR</small></div><span className={styles.queueStage}>{item.stage}</span><b className={styles.arrow}>→</b></button>)}
                    {!callQueue.slice(1).length && nextDeal && <div className={styles.queueDone}>Nur noch dieser eine Lead in der aktuellen Queue.</div>}
                  </div>
                </section>

                <aside className={styles.rightRail}>
                  <div className={styles.dailyCard}><div className={styles.railHead}><span>HEUTE</span><strong>Deal-Momentum</strong></div><Progress label="Calls" value={data.today.calls} target={100} /><Progress label="Echte Gespräche" value={data.today.connected} target={25} /><Progress label="Termine" value={data.today.meetings} target={3} /><Progress label="Gewonnen" value={data.today.wins} target={1} /><div className={styles.momentumLine}><span>Nächster Meilenstein</span><strong>{data.today.meetings < 3 ? `${3 - data.today.meetings} Termin${3 - data.today.meetings === 1 ? "" : "e"}` : data.today.wins < 1 ? "1 Abschluss" : "Tagesziel geknackt"}</strong></div></div>
                  <div className={styles.productPotentialCard}><div className={styles.railHead}><span>PRODUKT-POTENZIAL</span><strong>Wo liegt Geld?</strong></div>{data.productStats.map((item) => <button key={item.key} onClick={() => setProduct(item.key)} className={product === item.key ? styles.railProductActive : ""}><span className={productClass(item.key)}><i /></span><div><strong>{item.shortLabel}</strong><small>{item.open} Chancen · {item.callReady} call-ready</small></div><b>{compactEuro(item.annualPotential)}</b></button>)}</div>
                  <div className={styles.playbookCard}><div className={styles.railHead}><span>DEAL FLOW</span><strong>Nichts vergessen</strong></div><ol><li><b>1</b><span><strong>Signal prüfen</strong><small>Warum genau dieser Lead?</small></span></li><li><b>2</b><span><strong>Anrufen</strong><small>Produktbezogener Aufhänger.</small></span></li><li><b>3</b><span><strong>Outcome klicken</strong><small>CRM aktualisiert sich automatisch.</small></span></li><li><b>4</b><span><strong>Nächster Lead</strong><small>Kein Leerlauf zwischen Calls.</small></span></li></ol></div>
                </aside>
              </div>
            )}

            {view === "pipeline" && (
              <section className={styles.pipelineView}>
                <div className={styles.sectionHead}><div><span>PIPELINE</span><h1>Jede Chance nach rechts bis zum Umsatz.</h1><p>{product === "all" ? "Alle Produkte gemeinsam – oder links eine Produkt-Pipeline fokussieren." : data.catalog[product].description}</p></div><div className={styles.queueValue}><small>Offenes Potenzial</small><strong>{compactEuro(scopePotential)}</strong><span>{pipelineRows.length} Chancen</span></div></div>
                <div className={styles.pipelineBoard}>
                  {PIPELINE_STAGES.map((stage) => {
                    const rows = pipelineRows.filter((item) => item.stage === stage);
                    const value = rows.reduce((sum, item) => sum + item.annual_value, 0);
                    return <div key={stage} className={styles.pipelineColumn} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void move(event, stage)}><div className={styles.columnHead}><div><span>{stage}</span><b>{rows.length}</b></div><strong>{compactEuro(value)}</strong></div><div className={styles.columnBody}>{rows.map((item) => <article key={item.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/opportunity", item.id)} onClick={() => openOpportunity(item)} className={`${styles.pipelineCard} ${productClass(item.product_key)}`}><div className={styles.pipelineCardTop}><span>{data.catalog[item.product_key].shortLabel}</span><b>{item.probability}%</b></div><h3>{item.company}</h3><p>{item.signal_summary}</p><div className={styles.cardRevenue}><strong>{compactEuro(item.annual_value)}</strong><span>{euro(item.setup_value)} + {euro(item.monthly_value)}/M</span></div><div className={styles.cardProgress}><i style={{ width: `${stageProgress(item.stage)}%` }} /></div><footer><span>{item.next_action || "Nächste Aktion offen"}</span><div className={pro.cardActions}>{item.phone && <button title="Anrufen" onClick={(event) => { event.stopPropagation(); dial(item); }}>☎</button>}{item.stage !== "Gewonnen" && <button title="Eine Stufe weiter" onClick={(event) => { event.stopPropagation(); void advance(item); }}>→</button>}</div></footer></article>)}{!rows.length && <div className={styles.dropZone}>Hierher ziehen</div>}</div></div>;
                  })}
                </div>
                {lostRows.length > 0 && <div className={styles.lostStrip}><span>Verloren</span><strong>{lostRows.length} Opportunities</strong><button onClick={() => setView("deals")}>anzeigen →</button></div>}
              </section>
            )}

            {view === "followups" && (
              <section>
                <div className={styles.sectionHead}><div><span>NACHFASSEN</span><h1>Jede Wiedervorlage hat einen nächsten Schritt.</h1><p>Überfällige Kontakte zuerst. Danach chronologisch – damit kein warmer Deal versandet.</p></div><div className={styles.queueValue}><small>Jetzt fällig</small><strong>{dueNow}</strong><span>{followups.length} Wiedervorlagen</span></div></div>
                <div className={pro.followupList}>
                  {followups.map((item) => <article key={item.id} className={`${pro.followupRow} ${due(item.next_action_at) ? pro.followupDue : ""}`}><div className={pro.followupTime}><b>{due(item.next_action_at) ? "JETZT" : formatDateTime(item.next_action_at)}</b><span>{item.stage}</span></div><div className={pro.followupCompany} onClick={() => openOpportunity(item)}><strong>{item.company}</strong><span>{item.signal_summary}</span><small>{data.catalog[item.product_key].shortLabel} · {compactEuro(item.annual_value)} Potenzial</small></div><div className={pro.followupAction}><strong>{item.next_action || "Nachfassen"}</strong><div>{item.phone && <button onClick={() => dial(item)}>☎ Call</button>}<button onClick={() => void snooze(item, 1)}>Morgen</button><button onClick={() => void snooze(item, 7)}>+7 Tage</button><button onClick={() => openOpportunity(item)}>Details</button></div></div></article>)}
                  {!followups.length && <div className={styles.emptyState}><strong>Keine Wiedervorlagen.</strong><span>Der Follow-up-Stack ist sauber.</span></div>}
                </div>
              </section>
            )}

            {view === "deals" && (
              <section className={styles.dealsView}>
                <div className={styles.sectionHead}><div><span>DEAL BOOK</span><h1>Umsatzpotenzial pro Unternehmen und Produkt.</h1><p>Ein Unternehmen kann gleichzeitig mehrere getrennte Umsatzchancen besitzen.</p></div><div className={styles.queueValue}><small>Gewichtete Pipeline</small><strong>{compactEuro(scopeWeighted)}</strong><span>Won: {compactEuro(data.stats.wonRevenue)}</span></div></div>
                <div className={styles.dealTableWrap}><table className={styles.dealTable}><thead><tr><th>Unternehmen</th><th>Produkt</th><th>Signal</th><th>Stage</th><th>Setup</th><th>MRR</th><th>12M</th><th>Gewichtet</th><th>Nächste Aktion</th><th /></tr></thead><tbody>{filtered.map((item) => <tr key={item.id} onDoubleClick={() => openOpportunity(item)}><td><strong>{item.company}</strong><small>{[item.city, item.industry].filter(Boolean).join(" · ")}</small></td><td><span className={`${styles.tableProduct} ${productClass(item.product_key)}`}>{data.catalog[item.product_key].shortLabel}</span></td><td><span className={styles.signalText}>{item.signal_summary}</span></td><td><span className={styles.stagePill}>{item.stage}</span></td><td>{euro(item.setup_value)}</td><td>{euro(item.monthly_value)}</td><td><strong>{euro(item.annual_value)}</strong></td><td>{euro(item.weighted_value)}</td><td><span className={due(item.next_action_at) ? styles.dueText : ""}>{item.next_action || "—"}</span></td><td><button onClick={() => openOpportunity(item)}>→</button></td></tr>)}</tbody></table>{!filtered.length && <div className={styles.emptyState}><strong>Keine Opportunities im Filter.</strong><span>Filter zurücksetzen oder neue Signale aktualisieren.</span></div>}</div>
              </section>
            )}

            {view === "multichannel" && (
              <section className={styles.multiView}>
                <div className={styles.sectionHead}><div><span>TOOLS & KANÄLE</span><h1>Ein CRM. Alle Wege zum Deal.</h1><p>Revenue Pipeline bleibt die Quelle der Wahrheit; Spezial-Tools erledigen Call, Mail, Video und LinkedIn.</p></div></div>
                <div className={styles.channelGrid}><Link href="/call"><span>☎</span><div><strong>Rapid Call Console</strong><p>Telefon-Queue schnell abarbeiten und Outcomes erfassen.</p></div><b>Öffnen →</b></Link><Link href="/outbound/engine"><span>⚡</span><div><strong>Daily Channel Engine</strong><p>Calls, E-Mails, Videos und LinkedIn aus einer priorisierten Queue.</p></div><b>Öffnen →</b></Link><Link href="/outreach"><span>✉</span><div><strong>E-Mail Outreach</strong><p>Personalisierte Mail-Queue, Follow-ups und Reply-Stop-Logik.</p></div><b>Öffnen →</b></Link><Link href="/studio"><span>▶</span><div><strong>Video Studio</strong><p>Personalisierte Analyse-Landingpages für die stärksten Leads.</p></div><b>Öffnen →</b></Link><Link href="/"><span>▦</span><div><strong>Pflege Sales OS</strong><p>Pflege-spezifisches Research, CRM und Recruiting-Workflow.</p></div><b>Öffnen →</b></Link></div>
                <div className={styles.systemFlow}><span>SO FLIESST EIN LEAD DURCH DAS SYSTEM</span><div><b>Lead Finder</b><i>→</i><b>Research & Audit</b><i>→</i><b>Opportunity</b><i>→</i><b>Produkt-Pipeline</b><i>→</i><b>Call / Mail / Video</b><i>→</i><b>Nachfassen</b><i>→</i><b>Termin</b><i>→</i><b>Angebot</b><i>→</i><b>Gewonnen</b></div></div>
              </section>
            )}
          </div>
        </section>
      </div>

      {selected && (
        <div className={styles.drawerLayer} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}>
          <aside className={styles.drawer}>
            <header><div><span className={`${styles.tableProduct} ${productClass(selected.product_key)}`}>{data.catalog[selected.product_key].label}</span><h2>{selected.company}</h2><p>{selected.signal_summary}</p></div><button onClick={() => setSelectedId(null)}>×</button></header>
            <div className={styles.drawerValues}><div><span>12M Potenzial</span><strong>{euro(selected.annual_value)}</strong></div><div><span>Call Score</span><strong>{selected.call_score}</strong></div><div><span>Priorität</span><strong>{selected.lead_priority}/100</strong></div></div>

            <div className={pro.drawerQuick}><button onClick={() => dial(selected)} disabled={!selected.phone}>☎ Anrufen</button><button onClick={() => void snooze(selected)}>↻ Morgen</button>{selected.stage !== "Gewonnen" && selected.stage !== "Verloren" && <button onClick={() => void advance(selected)}>Eine Stufe weiter →</button>}</div>

            <form onSubmit={(event) => void saveInspector(event)} className={styles.drawerForm}>
              <label><span>Pipeline-Stufe</span><select name="stage" defaultValue={selected.stage}>{data.stages.map((stage) => <option key={stage}>{stage}</option>)}</select></label>
              <div className={styles.twoCols}><label><span>Setup-Potenzial</span><input name="setupValue" type="number" min="0" step="50" defaultValue={selected.setup_value} /></label><label><span>MRR-Potenzial</span><input name="monthlyValue" type="number" min="0" step="50" defaultValue={selected.monthly_value} /></label></div>
              <label><span>Abschlusswahrscheinlichkeit</span><div className={styles.probabilityInput}><input name="probability" type="range" min="0" max="100" defaultValue={selected.probability} /><b>{selected.probability}% aktuell</b></div></label>
              <label><span>Nächste Aktion</span><input name="nextAction" defaultValue={selected.next_action} placeholder="z. B. Dienstag 10 Uhr zurückrufen" /></label>
              <label><span>Fällig am</span><input name="nextActionAt" type="datetime-local" defaultValue={dateTimeLocal(selected.next_action_at)} /></label>
              <label><span>Notizen</span><textarea name="notes" rows={5} defaultValue={selected.notes} placeholder="Bedarf, Einwand, Entscheider, Angebot …" /></label>
              <button className={styles.saveButton} type="submit" disabled={Boolean(busy)}>Änderungen speichern</button>
            </form>

            <div className={styles.drawerContact}><span>DIREKT AKTIV WERDEN</span><div>{selected.phone && <button onClick={() => dial(selected)}>☎ {selected.phone}</button>}{selected.email && <a href={`mailto:${selected.email}`}>✉ E-Mail</a>}{selected.website && <a href={selected.website} target="_blank" rel="noreferrer">↗ Website</a>}</div></div>

            <div className={pro.related}><span>CHANCEN BEI DIESEM UNTERNEHMEN</span>{related.map((item) => <button key={item.id} className={item.id === selected.id ? pro.relatedActive : ""} onClick={() => setSelectedId(item.id)}><i className={productClass(item.product_key)} /><div><strong>{data.catalog[item.product_key].shortLabel}</strong><small>{item.stage} · {compactEuro(item.annual_value)}</small></div><b>{item.probability}%</b></button>)}</div>

            <div className={styles.crossSell}><span>CROSS-SELL · WEITERE CHANCE</span><div>{(Object.keys(data.catalog) as ProductKey[]).map((key) => leadProducts.has(key) ? <span key={key} className={styles.productExists}>✓ {data.catalog[key].shortLabel}</span> : <button key={key} onClick={() => void addProduct(key)}>+ {data.catalog[key].shortLabel}</button>)}</div></div>

            <div className={pro.timeline}><span>AKTIVITÄTEN</span>{selectedActivities.map((activity) => <div key={activity.id}><i /><section><strong>{activity.summary}</strong><small>{formatDateTime(activity.created_at)}</small></section></div>)}{!selectedActivities.length && <p>Noch keine Aktivitäten zu dieser Chance.</p>}</div>
          </aside>
        </div>
      )}
    </main>
  );
}

function Progress({ label, value, target }: { label: string; value: number; target: number }) {
  const percent = Math.min(100, Math.round(value / Math.max(1, target) * 100));
  return <div className={styles.progress}><div><span>{label}</span><b>{value}/{target}</b></div><div className={styles.progressTrack}><i style={{ width: `${percent}%` }} /></div></div>;
}

function Metric({ label, value, note, accent = false }: { label: string; value: number; note: string; accent?: boolean }) {
  return <div className={`${pro.metric} ${accent ? pro.metricAccent : ""}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function RateCard({ label, value }: { label: string; value: number }) {
  return <div className={pro.rateCard}><span>{label}</span><strong>{value}%</strong><div><i style={{ width: `${Math.min(100, value)}%` }} /></div></div>;
}
