"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./autopilot.module.css";

type EngineStatus = {
  configured: boolean;
  version?: string;
  upstream?: string;
  license?: string;
};

type Status = {
  ok: boolean;
  branch: string;
  engines: Record<string, EngineStatus>;
};

type Signal = {
  id: string;
  label: string;
  detail: string;
  weight: number;
  kind: string;
};

type Result = {
  ok: boolean;
  company?: string | null;
  url: string;
  elapsedMs: number;
  engine: {
    primary: string;
    firecrawlConfigured: boolean;
    stagehandConfigured: boolean;
    stagehandUsed: boolean;
    durableWorkflowQueued: boolean;
    durableError?: string | null;
  };
  intelligence: {
    score: number;
    temperature: "cold" | "warm" | "hot" | "very-hot";
    signals: Signal[];
    nextBestAction: string;
    opener: string;
    summary: string;
  };
  evidence: {
    title?: string;
    description?: string;
    links?: string[];
    jobs?: string[];
    contacts?: Array<{ name?: string; role?: string; email?: string; phone?: string }>;
    conversionIssues?: string[];
    trustSignals?: string[];
    notableFacts?: string[];
    markdownPreview?: string;
  };
  durableRun?: Record<string, unknown> | null;
  error?: string;
};

const STACK = [
  ["firecrawl", "Firecrawl", "Website lesen + strukturieren"],
  ["stagehand", "Stagehand", "Browser-Agent + echte UI-Recherche"],
  ["trigger", "Trigger.dev", "Durable Workflows + Retries"],
  ["posthog", "PostHog", "Intent- und Conversion-Signale"],
] as const;

function tempLabel(value?: Result["intelligence"]["temperature"]) {
  if (value === "very-hot") return "SEHR HEISS";
  if (value === "hot") return "HEISS";
  if (value === "warm") return "WARM";
  return "KALT";
}

export default function AutopilotLab() {
  const [status, setStatus] = useState<Status | null>(null);
  const [url, setUrl] = useState("");
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/autopilot/status", { cache: "no-store" })
      .then(response => response.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const activeEngines = useMemo(
    () => Object.values(status?.engines || {}).filter(item => item.configured).length,
    [status],
  );

  async function run(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/autopilot/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, company: company || undefined, queueDurableWorkflow: true }),
      });
      const body = (await response.json()) as Result;
      if (!response.ok) throw new Error(body.error || "Recherche fehlgeschlagen");
      setResult(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recherche fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.shell}>
      <div className={styles.glowA} />
      <div className={styles.glowB} />
      <header className={styles.topbar}>
        <Link href="/outbound" className={styles.brand}>
          <span>DG</span>
          <div><b>DIGITALE GEWINNER</b><small>Autopilot Lab · OSS Branch</small></div>
        </Link>
        <div className={styles.branch}><i /> feature/dg-autopilot-oss-stack</div>
        <Link href="/outbound" className={styles.back}>← bestehendes DG</Link>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.kicker}>LEAD IN → OPPORTUNITY OUT</span>
          <h1>DG Autopilot</h1>
          <p>Die Experiment-Version verbindet echte Open-Source-Engines mit eurem bestehenden Sales OS. Kein Ersatz-CRM, sondern eine Intelligence-Schicht davor.</p>
          <div className={styles.heroStats}>
            <div><strong>{activeEngines}/4</strong><span>Engines live</span></div>
            <div><strong>{result?.intelligence.score ?? "—"}</strong><span>Intent Score</span></div>
            <div><strong>{result ? `${(result.elapsedMs / 1000).toFixed(1)}s` : "—"}</strong><span>Research Time</span></div>
          </div>
        </div>

        <form className={styles.researchCard} onSubmit={run}>
          <div className={styles.cardHeader}><span>01</span><div><b>Lead Research</b><small>Website rein. Verkaufsargumente raus.</small></div></div>
          <label>Unternehmen <input value={company} onChange={event => setCompany(event.target.value)} placeholder="z. B. St. Vinzenz" /></label>
          <label>Website <input required type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…" /></label>
          <button disabled={loading || !url}>{loading ? <><i className={styles.spinner}/> Website wird analysiert…</> : <>Autopilot starten <span>↗</span></>}</button>
          {error && <div className={styles.error}>{error}</div>}
          <small className={styles.hint}>Ohne Firecrawl-Key läuft ein gekennzeichneter Fallback. Mit Keys werden Firecrawl + Stagehand + Trigger.dev live zugeschaltet.</small>
        </form>
      </section>

      <section className={styles.stack}>
        {STACK.map(([key, name, detail], index) => {
          const engine = status?.engines?.[key];
          return <article key={key} className={engine?.configured ? styles.engineLive : ""}>
            <div className={styles.engineIndex}>0{index + 1}</div>
            <div className={styles.engineBody}><b>{name}</b><span>{detail}</span><small>{engine?.version || "prüfe…"}</small></div>
            <div className={styles.engineState}><i />{engine?.configured ? "LIVE" : "READY"}</div>
          </article>;
        })}
      </section>

      <section className={styles.flow}>
        <div className={styles.flowHead}><span>AUTOPILOT PIPELINE</span><b>ECHTE ENGINES · EIN WORKFLOW</b></div>
        <div className={styles.flowRail}>
          {["Lead", "Crawl", "Browser Agent", "Score", "Personalize", "Queue", "Track"].map((item, index) => <div key={item} className={result && index <= 4 ? styles.flowDone : ""}><i>{index + 1}</i><span>{item}</span></div>)}
        </div>
      </section>

      {result && <section className={styles.results}>
        <article className={styles.scoreCard}>
          <div className={styles.scoreTop}><span>INTENT SCORE</span><em className={styles[result.intelligence.temperature]}>{tempLabel(result.intelligence.temperature)}</em></div>
          <div className={styles.scoreRing} style={{ "--score": `${result.intelligence.score * 3.6}deg` } as React.CSSProperties}><div><strong>{result.intelligence.score}</strong><span>/100</span></div></div>
          <h2>{result.company || new URL(result.url).hostname}</h2>
          <p>{result.intelligence.summary}</p>
          <div className={styles.sourceLine}><i /> {result.engine.primary}{result.engine.stagehandUsed ? " + stagehand" : ""}</div>
        </article>

        <article className={styles.actionCard}>
          <span className={styles.eyebrow}>NEXT BEST ACTION</span>
          <h2>{result.intelligence.nextBestAction}</h2>
          <div className={styles.script}><small>OPENER</small><p>“{result.intelligence.opener}”</p><button onClick={() => navigator.clipboard?.writeText(result.intelligence.opener)}>Opener kopieren</button></div>
          <div className={styles.queued}><span><i className={result.engine.durableWorkflowQueued ? styles.ok : ""}/> Durable Workflow</span><b>{result.engine.durableWorkflowQueued ? "QUEUED" : result.engine.durableError ? "ERROR" : "READY"}</b></div>
        </article>

        <article className={styles.signalsCard}>
          <div className={styles.sectionTitle}><span>SIGNALE</span><b>{result.intelligence.signals.length} erkannt</b></div>
          <div className={styles.signals}>{result.intelligence.signals.map(signal => <div key={signal.id}><span className={`${styles.signalDot} ${styles[`kind_${signal.kind}`]}`}/><div><b>{signal.label}</b><small>{signal.detail}</small></div><em>+{signal.weight}</em></div>)}</div>
        </article>

        <article className={styles.evidenceCard}>
          <div className={styles.sectionTitle}><span>EVIDENCE</span><b>keine erfundenen Facts</b></div>
          <div className={styles.evidenceGrid}>
            <div><small>Jobs</small><strong>{result.evidence.jobs?.length || 0}</strong><p>{result.evidence.jobs?.slice(0, 3).join(" · ") || "Keine strukturiert erkannt"}</p></div>
            <div><small>Kontakte</small><strong>{result.evidence.contacts?.length || 0}</strong><p>{result.evidence.contacts?.slice(0, 2).map(item => item.name || item.role || item.email || item.phone).filter(Boolean).join(" · ") || "Noch keine"}</p></div>
            <div><small>Conversion Gaps</small><strong>{result.evidence.conversionIssues?.length || 0}</strong><p>{result.evidence.conversionIssues?.slice(0, 2).join(" · ") || "Stagehand nicht aktiv / nichts erkannt"}</p></div>
            <div><small>Trust</small><strong>{result.evidence.trustSignals?.length || 0}</strong><p>{result.evidence.trustSignals?.slice(0, 2).join(" · ") || "Noch keine strukturierten Signale"}</p></div>
          </div>
          {result.evidence.markdownPreview && <details><summary>Roh-Evidence ansehen</summary><pre>{result.evidence.markdownPreview}</pre></details>}
        </article>
      </section>}

      {!result && <section className={styles.emptyState}>
        <div className={styles.emptyOrb}><i/><i/><i/></div>
        <div><span>WARTET AUF LEAD</span><h2>Gib dem System eine Website.</h2><p>Danach siehst du Intent, Website-Gaps, Ansprechpartner, Sales-Opener und die nächste Aktion in einem Lauf.</p></div>
      </section>}

      <footer className={styles.footer}><span>EXPERIMENTAL BRANCH · NO MAIN DEPLOY</span><span>Firecrawl · Stagehand · Trigger.dev · PostHog</span></footer>
    </main>
  );
}
