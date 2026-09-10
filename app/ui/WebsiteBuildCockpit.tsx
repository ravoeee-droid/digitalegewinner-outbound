"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./WebsiteBuildCockpit.module.css";

type WebsiteProject = {
  id: string; workspace: string; sales_lead_id: string | null; sales_company_id: string | null; opportunity_id: string | null;
  company: string; website_url: string; repo_full_name: string; preview_url: string; status: string; phase: string; progress: number;
  qa_score: number; gates: Record<string, unknown>; next_action: string; blocker: string; source: string; last_synced_at: string; created_at: string; updated_at: string;
};
type ApiResponse = { projects?: WebsiteProject[]; project?: WebsiteProject; error?: string };
type Filter = "active" | "all" | "near" | "blocked";
const PHASES = ["sales", "briefing", "research", "strategy", "design", "build", "assets", "qa", "preview", "sent"] as const;
const CORE_GATES = ["briefing", "research", "strategy", "design", "build", "qa", "preview"] as const;
const LABELS: Record<string, string> = { sales: "Sales", briefing: "Briefing", research: "Research", strategy: "Strategie", design: "Design", build: "Build", assets: "Assets", qa: "QA", preview: "Preview", sent: "Gesendet" };

function clamp(value: number) { return Math.max(0, Math.min(100, Math.round(Number(value || 0)))); }
function age(value: string) {
  const date = new Date(value); if (Number.isNaN(date.getTime())) return "—";
  const minutes = Math.floor(Math.max(0, Date.now() - date.getTime()) / 60_000);
  if (minutes < 2) return "gerade eben"; if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24); return `vor ${days} Tag${days === 1 ? "" : "en"}`;
}
function normalizeUrl(value: string) { return !value ? "" : /^https?:\/\//i.test(value) ? value : `https://${value}`; }

export default function WebsiteBuildCockpit() {
  const [projects, setProjects] = useState<WebsiteProject[]>([]);
  const [filter, setFilter] = useState<Filter>("active");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/website-projects", { cache: "no-store" });
      const json = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(json.error || "Build Stream konnte nicht geladen werden.");
      setProjects(json.projects || []); setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "Build Stream konnte nicht geladen werden."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 2600); return () => window.clearTimeout(timer); }, [toast]);

  const active = useMemo(() => projects.filter((item) => item.status === "active" && item.progress < 100), [projects]);
  const blocked = useMemo(() => projects.filter((item) => Boolean(item.blocker)), [projects]);
  const near = useMemo(() => projects.filter((item) => item.status === "active" && item.progress >= 65 && item.progress < 100), [projects]);
  const average = active.length ? Math.round(active.reduce((sum, item) => sum + clamp(item.progress), 0) / active.length) : 0;
  const visible = useMemo(() => filter === "active" ? active : filter === "near" ? near : filter === "blocked" ? blocked : projects, [active, blocked, filter, near, projects]);

  const mutate = useCallback(async (id: string, body: Record<string, unknown>, label: string) => {
    setBusy(id); setError("");
    try {
      const response = await fetch("/api/website-projects", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...body }) });
      const json = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(json.error || "Projekt konnte nicht aktualisiert werden.");
      setProjects(json.projects || []); setToast(label);
    } catch (err) { setError(err instanceof Error ? err.message : "Projekt konnte nicht aktualisiert werden."); }
    finally { setBusy(""); }
  }, []);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); const company = String(form.get("company") || "").trim(); if (!company) return;
    setBusy("create"); setError("");
    try {
      const response = await fetch("/api/website-projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company, websiteUrl: String(form.get("websiteUrl") || "").trim(), repoFullName: String(form.get("repoFullName") || "").trim(), phase: "briefing" }) });
      const json = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(json.error || "Projekt konnte nicht angelegt werden.");
      setProjects(json.projects || []); setCreateOpen(false); setToast(`${company} im Build Stream`); formElement.reset();
    } catch (err) { setError(err instanceof Error ? err.message : "Projekt konnte nicht angelegt werden."); }
    finally { setBusy(""); }
  }

  return (
    <main className={styles.root}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <div><span className={styles.eyebrow}>WEBSITE PRODUCTION // LIVE</span><h1>Build Stream</h1><p>Jeder Entwurf läuft durch dieselbe Pipeline. Kein Projekt verschwindet mehr zwischen Call, GitHub, Preview und Follow-up.</p></div>
          <button className={styles.addButton} onClick={() => setCreateOpen((value) => !value)}>+ PROJEKT</button>
        </header>

        <section className={styles.telemetry} aria-label="Website Produktionsmetriken">
          <div><span>AKTIVE BUILDS</span><strong>{active.length}</strong><small>gleichzeitig in Produktion</small></div>
          <div><span>CLOSE-LOOP</span><strong>{near.length}</strong><small>ab 65% · zuerst fertigziehen</small></div>
          <div><span>Ø FORTSCHRITT</span><strong>{average}%</strong><div className={styles.miniBar}><i style={{ width: `${clamp(average)}%` }} /></div></div>
          <div><span>BLOCKER</span><strong>{blocked.length}</strong><small>{blocked.length ? "brauchen Entscheidung oder Assets" : "keine offenen Blocker"}</small></div>
        </section>

        {createOpen && <form className={styles.createForm} onSubmit={createProject}>
          <div><label htmlFor="build-company">Unternehmen</label><input id="build-company" name="company" required autoFocus placeholder="z. B. Pflegeheim Musterhof" /></div>
          <div><label htmlFor="build-site">Aktuelle Website</label><input id="build-site" name="websiteUrl" placeholder="https://…" /></div>
          <div><label htmlFor="build-repo">GitHub Repo</label><input id="build-repo" name="repoFullName" placeholder="owner/repo" /></div>
          <button disabled={busy === "create"}>{busy === "create" ? "ANLEGEN …" : "IN BUILD STREAM"}</button>
        </form>}

        <div className={styles.controlRow}>
          <div className={styles.filters} role="group" aria-label="Website-Projekte filtern">
            <button className={filter === "active" ? styles.activeFilter : ""} onClick={() => setFilter("active")}>Aktiv <b>{active.length}</b></button>
            <button className={filter === "near" ? styles.activeFilter : ""} onClick={() => setFilter("near")}>Close Loop <b>{near.length}</b></button>
            <button className={filter === "blocked" ? styles.activeFilter : ""} onClick={() => setFilter("blocked")}>Blocker <b>{blocked.length}</b></button>
            <button className={filter === "all" ? styles.activeFilter : ""} onClick={() => setFilter("all")}>Alle <b>{projects.length}</b></button>
          </div>
          <button className={styles.refresh} onClick={() => void load()}>↻ SYNC</button>
        </div>
        {error && <div className={styles.error} role="alert">{error}</div>}
        {toast && <div className={styles.toast} role="status">{toast}</div>}

        <section className={styles.projectGrid}>
          {visible.map((project) => {
            const progress = clamp(project.progress); const phase = LABELS[project.phase] || project.phase; const isBusy = busy === project.id; const isFinished = project.phase === "sent" || progress >= 100;
            return <article key={project.id} id={`project-${project.id}`} className={`${styles.card} ${project.blocker ? styles.blockedCard : ""}`}>
              <div className={styles.cardTop}>
                <div><span className={styles.phase}>{phase.toUpperCase()}</span><h2>{project.company}</h2><p>{project.next_action || "Nächsten Produktionsschritt festlegen"}</p></div>
                <div className={styles.progressNumber}><strong>{progress}</strong><span>%</span></div>
              </div>
              <div className={styles.progressTrack} aria-label={`${progress}% fertig`}><i style={{ width: `${progress}%` }} /></div>
              <div className={styles.gates} aria-label="Qualitäts-Gates">
                {CORE_GATES.map((gate) => {
                  const phaseIndex = PHASES.indexOf(project.phase as typeof PHASES[number]); const gateIndex = PHASES.indexOf(gate);
                  const completed = project.gates?.[gate] === true || phaseIndex > gateIndex || isFinished; const current = project.phase === gate;
                  return <span key={gate} className={`${completed ? styles.gateDone : ""} ${current ? styles.gateCurrent : ""}`}><i>{completed ? "✓" : "·"}</i>{LABELS[gate]}</span>;
                })}
              </div>
              {project.blocker && <div className={styles.blocker}><span>BLOCKER</span><strong>{project.blocker}</strong></div>}
              <div className={styles.projectLinks}>
                {project.website_url && <a href={normalizeUrl(project.website_url)} target="_blank" rel="noreferrer">IST-ZUSTAND ↗</a>}
                {project.repo_full_name && <a href={`https://github.com/${project.repo_full_name}`} target="_blank" rel="noreferrer">GITHUB ↗</a>}
                {project.preview_url && <a className={styles.previewLink} href={normalizeUrl(project.preview_url)} target="_blank" rel="noreferrer">PREVIEW ↗</a>}
                {!project.website_url && !project.repo_full_name && !project.preview_url && <span className={styles.noLinks}>Noch keine Links hinterlegt</span>}
              </div>
              <div className={styles.cardActions}>
                <button className={styles.primaryAction} disabled={isBusy || isFinished || Boolean(project.blocker)} onClick={() => void mutate(project.id, { action: "advance" }, `${project.company} → nächster Gate`)}>{isFinished ? "✓ GESENDET" : project.blocker ? "BLOCKER LÖSEN" : isBusy ? "SYNC …" : "NÄCHSTEN GATE SCHLIESSEN"}</button>
                <button className={styles.secondaryAction} disabled={isBusy || isFinished} onClick={() => void mutate(project.id, { action: project.status === "paused" ? "resume" : "pause" }, project.status === "paused" ? "Projekt reaktiviert" : "Projekt pausiert")}>{project.status === "paused" ? "REAKTIVIEREN" : "PAUSE"}</button>
              </div>
              <footer className={styles.cardFooter}><span>{project.sales_lead_id ? "CRM VERKNÜPFT" : project.source === "manual" ? "MANUELL" : project.source.toUpperCase()}</span><span>Sync {age(project.last_synced_at || project.updated_at)}</span></footer>
            </article>;
          })}
          {!visible.length && <div className={styles.empty}><strong>Kein Projekt in diesem Filter.</strong><span>Der Build Stream ist sauber.</span></div>}
        </section>
      </div>
    </main>
  );
}
