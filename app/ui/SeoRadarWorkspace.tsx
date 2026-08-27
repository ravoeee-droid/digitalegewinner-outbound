"use client";

import { useMemo, useState } from "react";
import styles from "./seo-radar-workspace.module.css";

type Tab = "Übersicht" | "Keywords" | "Website Audit" | "Konkurrenz" | "Social Search" | "Reports" | "Integrationen";
type AuditIssue = { level: "high" | "medium" | "low"; text: string };
type AuditResult = {
  url: string;
  status: number;
  score: number;
  title: string;
  description: string;
  h1: string;
  h1Count: number;
  h2Count: number;
  imageCount: number;
  imagesMissingAlt: number;
  internalLinks: number;
  canonical: string;
  robotsNoindex: boolean;
  issues: AuditIssue[];
  checkedAt: string;
};
type KeywordItem = { keyword?: string; search_volume?: number | null; cpc?: number | null; competition?: string | null; monthly_searches?: Array<{ year?: number; month?: number; search_volume?: number }> };
type KeywordResponse = { connected: boolean; item?: KeywordItem | null; error?: string };

const tabs: Tab[] = ["Übersicht", "Keywords", "Website Audit", "Konkurrenz", "Social Search", "Reports", "Integrationen"];
const demoKeywords = [
  { keyword: "pflegedienst stuttgart", volume: 1900, cpc: 4.8, intent: "Anbieter", score: 94 },
  { keyword: "ambulante pflege stuttgart", volume: 720, cpc: 3.9, intent: "Anbieter", score: 91 },
  { keyword: "verhinderungspflege stuttgart", volume: 590, cpc: 3.2, intent: "Leistung", score: 88 },
  { keyword: "pflege zuhause kosten", volume: 1300, cpc: 4.1, intent: "Kosten", score: 86 },
];

function ScoreRing({ value, label }: { value: number; label: string }) {
  return <div className={styles.scoreRing} style={{ background: `conic-gradient(#c9a45a ${value * 3.6}deg, rgba(15,23,42,.08) 0deg)` }}><div><b>{value}</b><span>{label}</span></div></div>;
}

function Source({ name, description, state }: { name: string; description: string; state: "live" | "ready" | "pending" }) {
  const label = state === "live" ? "Live" : state === "ready" ? "Bereit" : "Verbinden";
  return <article className={styles.source}><span className={`${styles.sourceIcon} ${styles[state]}`}>{state === "live" ? "✓" : "◇"}</span><div><b>{name}</b><small>{description}</small></div><i className={`${styles.sourceState} ${styles[state]}`}>{label}</i></article>;
}

export default function SeoRadarWorkspace({ embedded = false }: { embedded?: boolean }) {
  const [tab, setTab] = useState<Tab>("Übersicht");
  const [domain, setDomain] = useState("digitalegewinner.de");
  const [clientName, setClientName] = useState("Digitale Gewinner");
  const [keyword, setKeyword] = useState("pflegedienst stuttgart");
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [keywordResult, setKeywordResult] = useState<KeywordResponse | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [keywordLoading, setKeywordLoading] = useState(false);
  const [notice, setNotice] = useState("");

  const liveVolume = Number(keywordResult?.item?.search_volume || 0);
  const liveCpc = Number(keywordResult?.item?.cpc || 0);
  const connectedSources = 1 + Number(Boolean(keywordResult?.connected));
  const actions = useMemo(() => {
    const list: string[] = [];
    if (!audit) list.push("Website live analysieren und technische Quick Wins priorisieren");
    else audit.issues.slice(0, 3).forEach((issue) => list.push(issue.text));
    if (!keywordResult?.connected) list.push("DataForSEO verbinden für echte Suchvolumen und CPC-Daten");
    else if (liveVolume > 0) list.push(`Keyword „${keywordResult.item?.keyword || keyword}“ mit ${liveVolume.toLocaleString("de-DE")} Suchen priorisieren`);
    list.push("Search Console + Instagram Platform Property verbinden");
    return list.slice(0, 5);
  }, [audit, keywordResult, keyword, liveVolume]);

  async function runAudit() {
    setAuditLoading(true); setNotice("");
    try {
      const response = await fetch("/api/seo-radar/audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: domain }) });
      const json = await response.json() as AuditResult & { error?: string };
      if (!response.ok) throw new Error(json.error || "Website-Analyse fehlgeschlagen.");
      setAudit(json); setTab("Website Audit");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Website-Analyse fehlgeschlagen."); }
    finally { setAuditLoading(false); }
  }

  async function runKeyword() {
    setKeywordLoading(true); setNotice("");
    try {
      const response = await fetch("/api/seo-radar/keywords", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keyword }) });
      const json = await response.json() as KeywordResponse;
      setKeywordResult(json);
      if (!response.ok) setNotice(json.error || "Keyword-Abfrage fehlgeschlagen.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Keyword-Abfrage fehlgeschlagen."); }
    finally { setKeywordLoading(false); }
  }

  return <main className={`${styles.shell} ${embedded ? styles.embedded : ""}`}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}><span>DG</span><div><b>SEO Radar</b><small>Visibility Intelligence</small></div></div>
      <nav>{tabs.map((item) => <button type="button" key={item} className={tab === item ? styles.active : ""} onClick={() => setTab(item)}><i>{item === "Übersicht" ? "⌂" : item === "Keywords" ? "⌕" : item === "Reports" ? "▤" : item === "Integrationen" ? "⚙" : "◇"}</i><span>{item}</span></button>)}</nav>
      <section className={styles.dataCard}><small>DATENSTATUS</small><b>{connectedSources} von 6 Quellen</b><div><i style={{ width: `${Math.round(connectedSources / 6 * 100)}%` }} /></div><span>Live Audit aktiv. Externe SEO-Daten werden erst nach API-Verbindung als live markiert.</span></section>
      {!embedded && <a className={styles.backLink} href="/">← Zurück zum Sales OS</a>}
    </aside>

    <section className={styles.workspace}>
      <header className={styles.topbar}><div><small>DIGITALE GEWINNER · SEO & SEARCH</small><h1>{tab}</h1></div><div className={styles.actions}><button type="button" className={styles.quiet} onClick={() => setTab("Reports")}>Kundenreport</button><button type="button" className={styles.primary} onClick={runAudit} disabled={auditLoading}>{auditLoading ? "Analysiere…" : "Website prüfen"}</button></div></header>
      {notice && <div className={styles.notice}>{notice}<button type="button" onClick={() => setNotice("")}>×</button></div>}

      <div className={styles.content}>
        {tab === "Übersicht" && <>
          <section className={styles.hero}><div><small>GROWTH INTELLIGENCE</small><h2>Nicht mehr SEO-Daten sammeln.<br/><em>Die nächste Wachstumschance sehen.</em></h2><p>Website, Keywords, Google, Social Search, Wettbewerber und Kundenreports in einem System.</p><div className={styles.heroForm}><input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="kunde.de"/><button type="button" onClick={runAudit} disabled={auditLoading}>{auditLoading ? "Prüfe…" : "Domain analysieren →"}</button></div></div>{audit ? <ScoreRing value={audit.score} label="Website Score"/> : <div className={styles.emptyRing}><b>LIVE</b><span>Audit bereit</span></div>}</section>
          <section className={styles.metrics}><article><span>Website Health</span><b>{audit ? `${audit.score}/100` : "—"}</b><small>{audit ? `${audit.issues.length} Punkte gefunden` : "Live-Audit starten"}</small></article><article><span>Keyword Volumen</span><b>{liveVolume ? liveVolume.toLocaleString("de-DE") : "—"}</b><small>{keywordResult?.connected ? "DataForSEO live" : "API noch nicht verbunden"}</small></article><article><span>Search Console</span><b>—</b><small>Website + Social Properties verbinden</small></article><article><span>Datenquellen</span><b>{connectedSources}/6</b><small>Keine Fake-Live-Daten</small></article></section>
          <section className={styles.grid2}><article className={styles.panel}><div className={styles.panelHead}><div><small>NEXT BEST ACTION</small><h3>Was jetzt den größten Hebel hat</h3></div><span className={styles.pill}>{actions.length} Aktionen</span></div><div className={styles.actionList}>{actions.map((item, index) => <div key={item}><span>{index + 1}</span><div><b>{item}</b><small>{index === 0 ? "Priorität hoch" : "Automatisch aus Datenstatus abgeleitet"}</small></div></div>)}</div></article><article className={styles.panel}><div className={styles.panelHead}><div><small>SYSTEM</small><h3>Datenquellen</h3></div></div><div className={styles.sourceMini}><Source name="Website Audit" description="Title, H1, Meta, Canonical, Indexierung" state="live"/><Source name="DataForSEO" description="Suchvolumen, CPC, SERPs, Wettbewerber" state={keywordResult?.connected ? "live" : "ready"}/><Source name="Google Search Console" description="Klicks, Impressionen, Positionen, Social Search" state="pending"/></div></article></section>
        </>}

        {tab === "Keywords" && <section className={styles.panel}><div className={styles.panelHead}><div><small>KEYWORD INTELLIGENCE</small><h3>Suchvolumen, CPC & Money Keywords</h3></div><span className={styles.infoTag}>{keywordResult?.connected ? "LIVE" : "API READY"}</span></div><div className={styles.searchRow}><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="Keyword eingeben"/><button type="button" className={styles.primary} onClick={runKeyword} disabled={keywordLoading}>{keywordLoading ? "Prüfe…" : "Live-Daten laden"}</button></div>{keywordResult?.connected && keywordResult.item ? <div className={styles.keywordHero}><div><small>LIVE KEYWORD</small><h4>{keywordResult.item.keyword || keyword}</h4></div><div><span>Suchvolumen</span><b>{liveVolume ? liveVolume.toLocaleString("de-DE") : "—"}</b></div><div><span>CPC</span><b>{liveCpc ? `${liveCpc.toFixed(2)} €` : "—"}</b></div><div><span>Competition</span><b>{keywordResult.item.competition || "—"}</b></div></div> : <div className={styles.callout}><b>DataForSEO-Schnittstelle ist eingebaut.</b><span>Hinterlege `DATAFORSEO_LOGIN` und `DATAFORSEO_PASSWORD` in Vercel. Danach kommen hier echte Daten.</span></div>}<div className={styles.demoHead}><span>Beispielansicht für Report-Layout</span><i>DEMO · nicht live</i></div><div className={styles.table}><div className={`${styles.row} ${styles.rowHead}`}><span>Keyword</span><span>Volumen</span><span>CPC</span><span>Intent</span><span>Chance</span></div>{demoKeywords.map((item) => <div className={styles.row} key={item.keyword}><span><b>{item.keyword}</b></span><span>{item.volume.toLocaleString("de-DE")}</span><span>{item.cpc.toFixed(2)} €</span><span>{item.intent}</span><span><strong>{item.score}</strong></span></div>)}</div></section>}

        {tab === "Website Audit" && <section className={styles.panel}><div className={styles.panelHead}><div><small>LIVE WEBSITE AUDIT</small><h3>Technik & Onpage in wenigen Sekunden</h3></div>{audit && <span className={styles.liveTag}>LIVE</span>}</div><div className={styles.searchRow}><input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="https://kunde.de"/><button type="button" className={styles.primary} onClick={runAudit} disabled={auditLoading}>{auditLoading ? "Analysiere…" : "Website analysieren"}</button></div>{audit ? <><div className={styles.auditHero}><ScoreRing value={audit.score} label="SEO Score"/><div><small>ANALYSIERTE URL</small><h4>{audit.url}</h4><p>{audit.title || "Kein Seitentitel gefunden"}</p><span>HTTP {audit.status} · {audit.h1Count} H1 · {audit.h2Count} H2 · {audit.imageCount} Bilder · {audit.internalLinks} interne Links</span></div></div><div className={styles.auditGrid}><article><span>Title</span><b>{audit.title || "Fehlt"}</b></article><article><span>H1</span><b>{audit.h1 || "Fehlt"}</b></article><article><span>Meta Description</span><b>{audit.description || "Fehlt"}</b></article><article><span>Canonical</span><b>{audit.canonical || "Nicht erkannt"}</b></article></div><div className={styles.issueList}>{audit.issues.length ? audit.issues.map((issue, index) => <div key={`${issue.text}-${index}`}><i className={styles[issue.level]} /><span>{issue.text}</span><b>{issue.level === "high" ? "Wichtig" : issue.level === "medium" ? "Optimieren" : "Hinweis"}</b></div>) : <div><i className={styles.good}/><span>Keine offensichtlichen Startseiten-Probleme gefunden.</span><b>Sauber</b></div>}</div></> : <div className={styles.empty}><b>Domain eingeben → Live-Befund erhalten</b><p>Die erste Version prüft Title, Description, H1/H2, Canonical, noindex, Bilder ohne Alt-Text und interne Links.</p></div>}</section>}

        {tab === "Konkurrenz" && <section className={styles.panel}><div className={styles.panelHead}><div><small>COMPETITOR INTELLIGENCE</small><h3>Keyword Gap & SERP-Wettbewerber</h3></div><span className={styles.infoTag}>DATAFORSEO NEXT</span></div><div className={styles.empty}><b>Keine erfundenen Wettbewerberdaten.</b><p>Sobald die DataForSEO-Zugangsdaten verbunden sind, ziehen wir Rankings, SERP-Wettbewerber, Keyword Gaps und Visibility hier live ein.</p></div><div className={styles.featureGrid}><article><b>Keyword Gap</b><span>Keywords, für die Konkurrenten ranken und der Kunde nicht.</span></article><article><b>Top-10 Vergleich</b><span>Wer besitzt wie viele kaufnahe Rankings?</span></article><article><b>Opportunity Score</b><span>Volumen × Intent × Ranking-Lücke × CPC.</span></article></div></section>}

        {tab === "Social Search" && <section className={styles.panel}><div className={styles.panelHead}><div><small>SOCIAL SEARCH</small><h3>Instagram, TikTok & YouTube in Google</h3></div><span className={styles.infoTag}>SEARCH CONSOLE</span></div><div className={styles.socialIntro}><div><b>Google-Sichtbarkeit von Social Content</b><p>Search Console Platform Properties können Social-Posts mit Suchanfragen, Impressionen und Klicks sichtbar machen. Native Likes/Saves kommen später separat über die Plattform-APIs.</p></div><button type="button" className={styles.quiet} onClick={() => setTab("Integrationen")}>Verbindung vorbereiten</button></div><div className={styles.featureGrid}><article><b>Instagram</b><span>Google Queries → Posts/Reels → Klicks</span></article><article><b>YouTube</b><span>Videos und Shorts in Google Search</span></article><article><b>TikTok / X</b><span>Plattform-Sichtbarkeit in einem Kundenreport</span></article></div></section>}

        {tab === "Reports" && <section className={`${styles.report} ${styles.panel}`}><div className={styles.reportControls}><div><label>Kunde<input value={clientName} onChange={(event) => setClientName(event.target.value)}/></label><label>Domain<input value={domain} onChange={(event) => setDomain(event.target.value)}/></label></div><button type="button" className={styles.primary} onClick={() => window.print()}>PDF / Drucken</button></div><div className={styles.reportHeader}><div><small>DIGITALE GEWINNER · DIGITAL VISIBILITY REPORT</small><h2>{clientName}</h2><p>{domain} · {new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date())}</p></div><span>DG</span></div><div className={styles.reportMetrics}><article><span>Website Score</span><b>{audit ? audit.score : "—"}</b><small>{audit ? "Live geprüft" : "Audit ausstehend"}</small></article><article><span>Keyword Volumen</span><b>{liveVolume || "—"}</b><small>{keywordResult?.connected ? "Live" : "DataForSEO fehlt"}</small></article><article><span>Datenquellen</span><b>{connectedSources}/6</b><small>aktuell verbunden</small></article><article><span>Prioritäten</span><b>{actions.length}</b><small>nächste Maßnahmen</small></article></div><div className={styles.reportSection}><small>EXECUTIVE SUMMARY</small><h3>{audit ? `Die Website erreicht aktuell ${audit.score}/100 im technischen Startseiten-Check.` : "Der technische Website-Check wurde noch nicht ausgeführt."}</h3><p>{audit?.issues.length ? `Die wichtigsten Hebel liegen aktuell bei: ${audit.issues.slice(0, 3).map((item) => item.text).join(", ")}.` : "Sobald Website, Search Console und Keyword-Daten verbunden sind, wird dieser Report automatisch mit echten Leistungs- und Chancenwerten gefüllt."}</p></div><div className={styles.reportSplit}><div className={styles.reportSection}><small>NÄCHSTE MASSNAHMEN</small>{actions.map((item, index) => <div className={styles.reportAction} key={item}><span>{index + 1}</span><b>{item}</b></div>)}</div><div className={styles.reportSection}><small>DATENQUALITÄT</small><p><b>Live:</b> Website Audit{keywordResult?.connected ? ", DataForSEO" : ""}</p><p><b>Noch zu verbinden:</b> Google Search Console, Social Platform Properties, SERP/Backlink-Daten.</p><p className={styles.reportNote}>Der Report trennt bewusst echte Daten, modellierte Chancen und Demo-Ansichten.</p></div></div></section>}

        {tab === "Integrationen" && <section className={styles.panel}><div className={styles.panelHead}><div><small>DATA SOURCES</small><h3>Einmal verbinden, danach automatisch reporten</h3></div></div><div className={styles.sources}><Source name="Website Audit" description="Eigener sicherer Server-Crawler für Onpage-Signale" state="live"/><Source name="DataForSEO" description="Suchvolumen, CPC, SERPs, Keyword Gaps, Backlinks" state={keywordResult?.connected ? "live" : "ready"}/><Source name="Google Search Console" description="Klicks, Impressionen, CTR, Positionen und Platform Properties" state="pending"/><Source name="Google PageSpeed / CrUX" description="Performance und reale Core Web Vitals" state="ready"/><Source name="Instagram / Meta" description="Native Reichweite, Saves, Likes und Profilaktionen" state="pending"/><Source name="Supabase" description="Snapshots, Kundenhistorie und Report-Daten" state="ready"/></div><div className={styles.setupBox}><b>Für echte Keyword-Daten jetzt nötig</b><code>DATAFORSEO_LOGIN</code><code>DATAFORSEO_PASSWORD</code><span>Die Secrets gehören ausschließlich in Vercel Environment Variables, nie ins Repository.</span></div></section>}
      </div>
    </section>
  </main>;
}
