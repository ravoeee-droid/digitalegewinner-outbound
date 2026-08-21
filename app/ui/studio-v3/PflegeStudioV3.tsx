"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultStudioProject,
  resolveStudioText,
  studioResolution,
  studioTransform,
  STUDIO_PRESETS,
  type StudioItem,
  type StudioLead,
  type StudioMode,
  type StudioProject,
} from "@/lib/studio-v3-pflege";
import styles from "./studio-v3.module.css";

type VersionRow = { id: number; revision: number; note: string; created_at: string };
type StudioPayload = {
  leads: StudioLead[];
  project: StudioProject;
  revision: number;
  publishedRevision: number;
  versions: VersionRow[];
  updatedAt?: string | null;
  error?: string;
};

type SavePayload = { ok?: boolean; revision?: number; publishedRevision?: number; project?: StudioProject; error?: string };

const modes: Array<{ id: StudioMode; label: string; icon: string }> = [
  { id: "video", label: "Video Editor", icon: "▶" },
  { id: "landing", label: "Landingpage", icon: "▤" },
  { id: "brand", label: "Brand Kit", icon: "✦" },
  { id: "versions", label: "Versionen", icon: "↺" },
  { id: "render", label: "Render & Publish", icon: "↑" },
];

function formatTime(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 100) / 10);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function activeAt(item: StudioItem, timeMs: number) {
  return !item.hidden && item.startMs <= timeMs && item.endMs >= timeMs;
}

function StudioCanvas({ project, lead, timeMs, selectedItemId, onSelect }: {
  project: StudioProject;
  lead: StudioLead | null;
  timeMs: number;
  selectedItemId: string | null;
  onSelect: (id: string) => void;
}) {
  const items = useMemo(
    () => project.timeline.tracks.flatMap((track) => track.hidden ? [] : track.items).filter((item) => activeAt(item, timeMs)).sort((a, b) => a.zIndex - b.zIndex),
    [project.timeline.tracks, timeMs],
  );
  const ratio = project.timeline.width / project.timeline.height;
  const website = project.sources.websiteCaptureUrl || project.sources.websiteUrl || lead?.website || "";
  const presenter = project.sources.presenterUrl;
  const logo = project.sources.logoUrl || project.brand.logoUrl;

  function sourceFor(item: StudioItem) {
    if (item.sourceUrl) return item.sourceUrl;
    if (item.dynamicSource === "presenter") return presenter;
    if (item.dynamicSource === "website") return website;
    if (item.dynamicSource === "logo") return logo;
    if (item.dynamicSource === "portrait") return project.sources.portraitUrl || project.brand.portraitUrl;
    return "";
  }

  return <div className={styles.canvasStage}>
    <div className={styles.canvas} style={{ aspectRatio: String(ratio), background: project.timeline.backgroundColor }} aria-label="Studio Vorschau">
      {items.map((item) => {
        const t = item.transform;
        const itemStyle = {
          left: `${t.x}%`, top: `${t.y}%`, width: `${t.width}%`, height: `${t.height}%`,
          opacity: t.opacity, transform: `rotate(${t.rotation}deg) scale(${t.scale})`, borderRadius: `${t.borderRadius}px`, zIndex: item.zIndex,
        };
        const source = sourceFor(item);
        const selected = selectedItemId === item.id;
        const common = { type: "button" as const, className: `${styles.canvasItem} ${selected ? styles.selected : ""}`, style: itemStyle, onClick: () => onSelect(item.id), "aria-label": `${item.label} auswählen` };

        if (item.type === "website") {
          return <button key={item.id} {...common} className={`${common.className} ${styles.websiteItem}`}>
            {source ? <div className={styles.websiteMock}><div className={styles.browserBar}><i/><i/><i/><span>{source.replace(/^https?:\/\//, "")}</span></div><div className={styles.websiteBody}><strong>{lead?.company || "Unternehmenswebsite"}</strong><small>{source}</small><div/><div/><div/></div></div> : <div className={styles.emptyVisual}>Website / Capture hinterlegen</div>}
          </button>;
        }
        if (item.type === "presenter") {
          return <button key={item.id} {...common} className={`${common.className} ${styles.presenterItem}`}>
            {source ? <video src={source} muted playsInline aria-label="Sprecher-Vorschau" /> : <div className={styles.presenterPlaceholder}><span>RH</span><small>Sprecher-Video hinterlegen</small></div>}
          </button>;
        }
        if (item.type === "logo") {
          return <button key={item.id} {...common} className={`${common.className} ${styles.logoItem}`}>{source ? <img src={source} alt={`${project.brand.name} Logo`} /> : <span>{project.brand.name}</span>}</button>;
        }
        const text = resolveStudioText(item.text, lead, project);
        const subtext = resolveStudioText(item.subtext, lead, project);
        return <button key={item.id} {...common} className={`${common.className} ${item.type === "metric" ? styles.metricItem : styles.textItem}`} style={{ ...itemStyle, color: item.color || project.brand.textColor, background: item.backgroundColor || "transparent", fontSize: `${Math.max(12, (item.fontSize || 36) / 4)}px`, fontWeight: item.fontWeight || 700, textAlign: item.textAlign || "left" }}>
          <strong>{text}</strong>{subtext && <small>{subtext}</small>}
        </button>;
      })}
      <div className={styles.safeArea} aria-hidden="true" />
    </div>
  </div>;
}

function Timeline({ project, timeMs, selectedItemId, onTime, onSelect, onToggleTrack }: {
  project: StudioProject;
  timeMs: number;
  selectedItemId: string | null;
  onTime: (value: number) => void;
  onSelect: (id: string) => void;
  onToggleTrack: (trackId: string) => void;
}) {
  const duration = project.timeline.durationMs;
  return <section className={styles.timelinePanel} aria-labelledby="timeline-title">
    <div className={styles.timelineHeader}><div><span className={styles.eyebrow}>TIMELINE · V3</span><h2 id="timeline-title">Layer & Timing</h2></div><output aria-live="polite">{formatTime(timeMs)} / {formatTime(duration)}</output></div>
    <label className={styles.scrubberLabel}>Abspielposition
      <input className={styles.scrubber} type="range" min={0} max={duration} step={100} value={timeMs} onChange={(event) => onTime(Number(event.target.value))} />
    </label>
    <div className={styles.tracks}>
      {project.timeline.tracks.map((track) => <div className={styles.track} key={track.id}>
        <div className={styles.trackLabel}><button type="button" onClick={() => onToggleTrack(track.id)} aria-pressed={!track.hidden} aria-label={`${track.name} ${track.hidden ? "einblenden" : "ausblenden"}`}>{track.hidden ? "○" : "●"}</button><span><strong>{track.name}</strong><small>{track.type}</small></span></div>
        <div className={styles.trackLane}>
          {track.items.map((item) => {
            const left = (item.startMs / duration) * 100;
            const width = Math.max(1.4, ((item.endMs - item.startMs) / duration) * 100);
            return <button key={item.id} type="button" onClick={() => onSelect(item.id)} className={`${styles.clip} ${selectedItemId === item.id ? styles.clipSelected : ""}`} style={{ left: `${left}%`, width: `${width}%` }} aria-label={`${item.label}, ${formatTime(item.startMs)} bis ${formatTime(item.endMs)}`}><span>{item.label}</span></button>;
          })}
          <i className={styles.playhead} style={{ left: `${(timeMs / duration) * 100}%` }} aria-hidden="true" />
        </div>
      </div>)}
    </div>
  </section>;
}

export default function PflegeStudioV3() {
  const [mode, setMode] = useState<StudioMode>("video");
  const [leads, setLeads] = useState<StudioLead[]>([]);
  const [scope, setScope] = useState("global");
  const [project, setProject] = useState<StudioProject>(() => defaultStudioProject());
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [revision, setRevision] = useState(0);
  const [publishedRevision, setPublishedRevision] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState<string | null>("company-title");
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("Studio V3 lädt …");
  const [dirty, setDirty] = useState(false);
  const frameRef = useRef<number | null>(null);
  const playStart = useRef({ wall: 0, time: 0 });
  const idCounter = useRef(1000);
  const saveTimer = useRef<number | null>(null);

  const selectedLead = scope === "global" ? null : leads.find((lead) => lead.id === scope) || null;
  const selectedItem = useMemo(() => project.timeline.tracks.flatMap((track) => track.items).find((item) => item.id === selectedItemId) || null, [project.timeline.tracks, selectedItemId]);

  function applyProject(next: StudioProject) { setProject(next); setDirty(true); }
  function updateProject(mutator: (current: StudioProject) => StudioProject) { setProject((current) => mutator(current)); setDirty(true); }

  async function load(nextScope = scope) {
    setBusy("load");
    setMessage("Studio V3 wird geladen …");
    try {
      const response = await fetch(`/api/studio-v3?leadId=${encodeURIComponent(nextScope)}`, { cache: "no-store" });
      const json = await response.json() as StudioPayload;
      if (!response.ok) throw new Error(json.error || "Studio V3 konnte nicht geladen werden.");
      setLeads(json.leads || []);
      setProject(json.project || defaultStudioProject());
      setVersions(json.versions || []);
      setRevision(json.revision || 0);
      setPublishedRevision(json.publishedRevision || 0);
      setSelectedItemId("company-title");
      setTimeMs(0);
      setDirty(false);
      setMessage(nextScope === "global" ? "Master-Vorlage geladen" : `${json.leads.find((lead) => lead.id === nextScope)?.company || "Lead"} geladen`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Studio V3 Fehler"); }
    finally { setBusy(""); }
  }

  useEffect(() => { void load("global"); }, []);

  useEffect(() => {
    if (!playing) { if (frameRef.current) cancelAnimationFrame(frameRef.current); frameRef.current = null; return; }
    playStart.current = { wall: performance.now(), time: timeMs };
    const tick = (now: number) => {
      const next = Math.min(project.timeline.durationMs, playStart.current.time + (now - playStart.current.wall));
      setTimeMs(next);
      if (next >= project.timeline.durationMs) { setPlaying(false); return; }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [playing, project.timeline.durationMs]);

  async function save(publish = false, silent = false) {
    setBusy(publish ? "publish" : "save");
    try {
      const response = await fetch("/api/studio-v3", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId: scope, project, publish, note: publish ? "Veröffentlicht" : "Studio Autosave" }) });
      const json = await response.json() as SavePayload;
      if (!response.ok) throw new Error(json.error || "Speichern fehlgeschlagen.");
      setRevision(json.revision || revision + 1);
      setPublishedRevision(json.publishedRevision || publishedRevision);
      setDirty(false);
      if (!silent) setMessage(publish ? "Studio V3 veröffentlicht." : "Studio V3 gespeichert.");
      const refreshed = await fetch(`/api/studio-v3?leadId=${encodeURIComponent(scope)}`, { cache: "no-store" });
      if (refreshed.ok) setVersions(((await refreshed.json()) as StudioPayload).versions || []);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Speichern fehlgeschlagen."); }
    finally { setBusy(""); }
  }

  useEffect(() => {
    if (!dirty || busy) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void save(false, true); }, 1600);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [dirty, project, scope]);

  function chooseScope(next: string) { setScope(next); void load(next); }

  function updateItem(itemId: string, patch: Partial<StudioItem>) {
    updateProject((current) => ({ ...current, timeline: { ...current.timeline, tracks: current.timeline.tracks.map((track) => ({ ...track, items: track.items.map((item) => item.id === itemId ? { ...item, ...patch, transform: patch.transform ? { ...item.transform, ...patch.transform } : item.transform } : item) })) } }));
  }

  function toggleTrack(trackId: string) {
    updateProject((current) => ({ ...current, timeline: { ...current.timeline, tracks: current.timeline.tracks.map((track) => track.id === trackId ? { ...track, hidden: !track.hidden } : track) } }));
  }

  function addOverlay(kind: "text" | "metric") {
    idCounter.current += 1;
    const id = `${kind}-${idCounter.current}`;
    const item: StudioItem = {
      id, type: kind, label: kind === "text" ? "Neuer Text" : "Neue Kennzahl", trackId: "track-overlays", startMs: Math.round(timeMs), endMs: Math.min(project.timeline.durationMs, Math.round(timeMs) + 9000), zIndex: 64,
      text: kind === "text" ? "Neue Botschaft für {{company}}" : "Recruiting Signal", subtext: kind === "metric" ? "{{opportunity}} / 100" : "", color: "#ffffff", backgroundColor: kind === "metric" ? "#17181b" : "rgba(17,18,20,.86)", fontSize: 42, fontWeight: 800, transform: studioTransform({ x: 8, y: 66, width: kind === "metric" ? 30 : 55, height: 18, borderRadius: 18 }),
    };
    updateProject((current) => ({ ...current, timeline: { ...current.timeline, tracks: current.timeline.tracks.map((track) => track.id === "track-overlays" ? { ...track, items: [...track.items, item] } : track) } }));
    setSelectedItemId(id);
  }

  function deleteSelected() {
    if (!selectedItemId) return;
    updateProject((current) => ({ ...current, timeline: { ...current.timeline, tracks: current.timeline.tracks.map((track) => ({ ...track, items: track.items.filter((item) => item.id !== selectedItemId) })) } }));
    setSelectedItemId(null);
  }

  function changeRatio(event: ChangeEvent<HTMLSelectElement>) {
    const aspectRatio = event.target.value as StudioProject["timeline"]["aspectRatio"];
    const resolution = studioResolution(aspectRatio);
    updateProject((current) => ({ ...current, timeline: { ...current.timeline, aspectRatio, ...resolution } }));
  }

  async function renderVideo() {
    if (!selectedLead) { setMessage("Für den Render bitte zuerst einen Pflege-Lead auswählen."); return; }
    setBusy("render");
    setMessage(`Video-Render für ${selectedLead.company} wird gestartet …`);
    try {
      await save(false, true);
      const response = await fetch("/api/video/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId: selectedLead.id }) });
      const json = await response.json() as { status?: string; jobId?: string; videoUrl?: string; error?: string };
      if (!response.ok) throw new Error(json.error || "Video-Renderer nicht verfügbar.");
      setMessage(json.videoUrl ? "Video fertig und auf der Microsite verfügbar." : `Render gestartet${json.jobId ? ` · ${json.jobId}` : ""}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Render fehlgeschlagen."); }
    finally { setBusy(""); }
  }

  return <main className={styles.studioShell}>
    <a className={styles.skipLink} href="#studio-main">Zum Studio-Arbeitsbereich springen</a>
    <header className={styles.topbar}>
      <div className={styles.brand}><Link href="/" aria-label="Zurück zum Pflege Recruiting OS"><span>DG</span></Link><div><strong>Studio V3</strong><small>PERSONALIZED OUTBOUND CREATIVE ENGINE</small></div></div>
      <div className={styles.scopeGroup}>
        <label>Vorlage / Lead<select value={scope} onChange={(event) => chooseScope(event.target.value)}><option value="global">Master-Vorlage</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.company}</option>)}</select></label>
        <label>Preset<select value={project.presetKey} onChange={(event) => applyProject({ ...project, presetKey: event.target.value, name: STUDIO_PRESETS.find((preset) => preset.key === event.target.value)?.label || project.name })}>{STUDIO_PRESETS.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}</select></label>
        <label>Format<select value={project.timeline.aspectRatio} onChange={changeRatio}><option>16:9</option><option>9:16</option><option>1:1</option><option>4:5</option></select></label>
      </div>
      <div className={styles.topActions}><span className={dirty ? styles.unsaved : styles.saved} role="status">{dirty ? "Ungespeichert" : `Rev. ${revision}`}</span><button type="button" onClick={() => void save()} disabled={Boolean(busy)}>Speichern</button><button type="button" className={styles.publishButton} onClick={() => void save(true)} disabled={Boolean(busy)}>Veröffentlichen</button></div>
    </header>

    <nav className={styles.modeNav} aria-label="Studio Bereiche">{modes.map((item) => <button key={item.id} type="button" className={mode === item.id ? styles.modeActive : ""} onClick={() => setMode(item.id)} aria-current={mode === item.id ? "page" : undefined}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}</nav>

    <div id="studio-main" className={styles.workspace}>
      {mode === "video" && <>
        <aside className={styles.assetPanel} aria-label="Studio Assets">
          <div className={styles.panelTitle}><span className={styles.eyebrow}>ASSETS · V3</span><h2>Quellen</h2><p>Die gleichen V3-Bindings wie im Walkenhorst Studio: Sprecher, Website, Logo und Portrait.</p></div>
          <label>Sprecher-Video URL<input value={project.sources.presenterUrl} onChange={(event) => updateProject((current) => ({ ...current, sources: { ...current.sources, presenterUrl: event.target.value } }))} placeholder="https://…/raphael.mp4" /></label>
          <label>Website / Capture<input value={project.sources.websiteCaptureUrl || project.sources.websiteUrl} onChange={(event) => updateProject((current) => ({ ...current, sources: { ...current.sources, websiteCaptureUrl: event.target.value } }))} placeholder={selectedLead?.website || "https://unternehmen.de"} /></label>
          <label>Logo URL<input value={project.sources.logoUrl} onChange={(event) => updateProject((current) => ({ ...current, sources: { ...current.sources, logoUrl: event.target.value } }))} placeholder="https://…/logo.svg" /></label>
          <label>Portrait URL<input value={project.sources.portraitUrl} onChange={(event) => updateProject((current) => ({ ...current, sources: { ...current.sources, portraitUrl: event.target.value } }))} placeholder="https://…/portrait.jpg" /></label>
          <div className={styles.assetQuick}><button type="button" onClick={() => addOverlay("text")}>+ Text</button><button type="button" onClick={() => addOverlay("metric")}>+ Kennzahl</button></div>
          {selectedLead && <div className={styles.leadContext}><span className={styles.eyebrow}>LIVE PERSONALIZATION</span><strong>{selectedLead.company}</strong><small>{selectedLead.city || "—"} · Priority {selectedLead.priorityScore}</small><p>{selectedLead.notes || "Noch keine Research-Notiz."}</p></div>}
        </aside>

        <section className={styles.editorCenter} aria-label="Video Editor">
          <div className={styles.transport}><button type="button" onClick={() => setTimeMs(0)} aria-label="Zum Anfang">|◀</button><button type="button" className={styles.playButton} onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause" : "Abspielen"}>{playing ? "Ⅱ" : "▶"}</button><button type="button" onClick={() => setTimeMs(project.timeline.durationMs)} aria-label="Zum Ende">▶|</button><output>{formatTime(timeMs)}</output></div>
          <StudioCanvas project={project} lead={selectedLead} timeMs={timeMs} selectedItemId={selectedItemId} onSelect={setSelectedItemId} />
          <Timeline project={project} timeMs={timeMs} selectedItemId={selectedItemId} onTime={setTimeMs} onSelect={setSelectedItemId} onToggleTrack={toggleTrack} />
        </section>

        <aside className={styles.inspector} aria-label="Element Inspector">
          <div className={styles.panelTitle}><span className={styles.eyebrow}>INSPECTOR</span><h2>{selectedItem?.label || "Element wählen"}</h2><p>Position, Timing, Text und Styling direkt bearbeiten.</p></div>
          {selectedItem ? <>
            <label>Name<input value={selectedItem.label} onChange={(event) => updateItem(selectedItem.id, { label: event.target.value })} /></label>
            {(selectedItem.type === "text" || selectedItem.type === "metric") && <><label>Text<textarea value={selectedItem.text || ""} onChange={(event) => updateItem(selectedItem.id, { text: event.target.value })} /></label><label>Subtext<input value={selectedItem.subtext || ""} onChange={(event) => updateItem(selectedItem.id, { subtext: event.target.value })} /></label></>}
            <div className={styles.fieldGrid}><label>Start ms<input type="number" value={selectedItem.startMs} min={0} max={project.timeline.durationMs} onChange={(event) => updateItem(selectedItem.id, { startMs: clamp(Number(event.target.value), 0, selectedItem.endMs - 100) })} /></label><label>Ende ms<input type="number" value={selectedItem.endMs} min={100} max={project.timeline.durationMs} onChange={(event) => updateItem(selectedItem.id, { endMs: clamp(Number(event.target.value), selectedItem.startMs + 100, project.timeline.durationMs) })} /></label></div>
            <div className={styles.fieldGrid}><label>X %<input type="number" value={selectedItem.transform.x} onChange={(event) => updateItem(selectedItem.id, { transform: { ...selectedItem.transform, x: clamp(Number(event.target.value), -50, 100) } })} /></label><label>Y %<input type="number" value={selectedItem.transform.y} onChange={(event) => updateItem(selectedItem.id, { transform: { ...selectedItem.transform, y: clamp(Number(event.target.value), -50, 100) } })} /></label><label>Breite %<input type="number" value={selectedItem.transform.width} onChange={(event) => updateItem(selectedItem.id, { transform: { ...selectedItem.transform, width: clamp(Number(event.target.value), 2, 150) } })} /></label><label>Höhe %<input type="number" value={selectedItem.transform.height} onChange={(event) => updateItem(selectedItem.id, { transform: { ...selectedItem.transform, height: clamp(Number(event.target.value), 2, 150) } })} /></label></div>
            <div className={styles.fieldGrid}><label>Textfarbe<input type="color" value={selectedItem.color || "#ffffff"} onChange={(event) => updateItem(selectedItem.id, { color: event.target.value })} /></label><label>Deckkraft<input type="range" min={0.1} max={1} step={0.05} value={selectedItem.transform.opacity} onChange={(event) => updateItem(selectedItem.id, { transform: { ...selectedItem.transform, opacity: Number(event.target.value) } })} /></label></div>
            <button type="button" className={styles.dangerButton} onClick={deleteSelected}>Element löschen</button>
          </> : <div className={styles.emptyPanel}>Klicke ein Element im Canvas oder in der Timeline an.</div>}
        </aside>
      </>}

      {mode === "landing" && <section className={styles.fullPanel}>
        <div className={styles.sectionIntro}><div><span className={styles.eyebrow}>LANDINGPAGE BUILDER · V3</span><h1>Personalisierte Mini-Landingpage</h1><p>Direkt aus dem Studio-Projekt. Keine zweite Landingpage-Logik mehr.</p></div>{selectedLead && <a className={styles.openLink} href={`/a/${encodeURIComponent(selectedLead.id)}`} target="_blank" rel="noreferrer">Bestehende Microsite öffnen ↗</a>}</div>
        <div className={styles.landingLayout}><div className={styles.blockList}>{[...project.landing].sort((a,b) => a.order-b.order).map((block) => <article className={styles.blockCard} key={block.id}><div><span>{block.type}</span><strong>{block.headline || block.id}</strong></div><label className={styles.switchLabel}><input type="checkbox" checked={block.enabled} onChange={(event) => updateProject((current) => ({ ...current, landing: current.landing.map((item) => item.id === block.id ? { ...item, enabled: event.target.checked } : item) }))} /> Aktiv</label><label>Headline<input value={block.headline || ""} onChange={(event) => updateProject((current) => ({ ...current, landing: current.landing.map((item) => item.id === block.id ? { ...item, headline: event.target.value } : item) }))} /></label>{block.body !== undefined && <label>Text<textarea value={block.body || ""} onChange={(event) => updateProject((current) => ({ ...current, landing: current.landing.map((item) => item.id === block.id ? { ...item, body: event.target.value } : item) }))} /></label>}</article>)}</div>
          <div className={styles.landingPreview} style={{ background: project.brand.backgroundColor, color: project.brand.textColor }}><div className={styles.previewBrowser}><span/><span/><span/><small>{selectedLead?.company || "Master Preview"}</small></div>{project.landing.filter((block) => block.enabled).sort((a,b) => a.order-b.order).map((block) => <section key={block.id} className={`${styles.previewBlock} ${styles[`preview_${block.type}`] || ""}`}><small>{resolveStudioText(block.eyebrow, selectedLead, project)}</small>{block.headline && <h2>{resolveStudioText(block.headline, selectedLead, project)}</h2>}{block.body && <p>{resolveStudioText(block.body, selectedLead, project)}</p>}{block.type === "video" && <div className={styles.videoPreview}>▶ Studio V3 Video</div>}{block.type === "metrics" && <div className={styles.previewMetrics}><span><b>{selectedLead?.priorityScore || 0}</b>Priority</span><span><b>{selectedLead?.websiteScore || 0}</b>Website</span><span><b>{selectedLead?.opportunityScore || 0}</b>Opportunity</span></div>}{block.type === "cta" && <button type="button" style={{ background: project.brand.primaryColor, color: project.brand.buttonTextColor }}>{project.brand.defaultCtaLabel}</button>}</section>)}</div></div>
      </section>}

      {mode === "brand" && <section className={styles.fullPanel}>
        <div className={styles.sectionIntro}><div><span className={styles.eyebrow}>BRAND KIT · V3</span><h1>Digitale Gewinner Brand System</h1><p>Farben, Trust, CTA und Absender werden einmal gepflegt und für Video + Landingpage wiederverwendet.</p></div></div>
        <div className={styles.brandGrid}><div className={styles.brandForm}><label>Brand Name<input value={project.brand.name} onChange={(event) => updateProject((current) => ({ ...current, brand: { ...current.brand, name: event.target.value } }))} /></label><div className={styles.fieldGrid}><label>Primärfarbe<input type="color" value={project.brand.primaryColor} onChange={(event) => updateProject((current) => ({ ...current, brand: { ...current.brand, primaryColor: event.target.value } }))} /></label><label>Akzent<input type="color" value={project.brand.accentColor} onChange={(event) => updateProject((current) => ({ ...current, brand: { ...current.brand, accentColor: event.target.value } }))} /></label><label>Hintergrund<input type="color" value={project.brand.backgroundColor} onChange={(event) => updateProject((current) => ({ ...current, brand: { ...current.brand, backgroundColor: event.target.value } }))} /></label><label>Text<input type="color" value={project.brand.textColor} onChange={(event) => updateProject((current) => ({ ...current, brand: { ...current.brand, textColor: event.target.value } }))} /></label></div><label>CTA Text<input value={project.brand.defaultCtaLabel} onChange={(event) => updateProject((current) => ({ ...current, brand: { ...current.brand, defaultCtaLabel: event.target.value } }))} /></label><label>Kalender / CTA URL<input value={project.brand.defaultCtaUrl} onChange={(event) => updateProject((current) => ({ ...current, brand: { ...current.brand, defaultCtaUrl: event.target.value } }))} /></label><label>Trust Headline<input value={project.brand.trustHeadline} onChange={(event) => updateProject((current) => ({ ...current, brand: { ...current.brand, trustHeadline: event.target.value } }))} /></label><label>Trust Text<textarea value={project.brand.trustBody} onChange={(event) => updateProject((current) => ({ ...current, brand: { ...current.brand, trustBody: event.target.value } }))} /></label><div className={styles.fieldGrid}><label>Kontaktname<input value={project.brand.contactName} onChange={(event) => updateProject((current) => ({ ...current, brand: { ...current.brand, contactName: event.target.value } }))} /></label><label>E-Mail<input value={project.brand.contactEmail} onChange={(event) => updateProject((current) => ({ ...current, brand: { ...current.brand, contactEmail: event.target.value } }))} /></label></div></div>
          <div className={styles.brandPreview} style={{ background: project.brand.backgroundColor, color: project.brand.textColor }}><span className={styles.brandPreviewMark} style={{ background: project.brand.primaryColor, color: project.brand.buttonTextColor }}>DG</span><small style={{ color: project.brand.accentColor }}>PFLEGE RECRUITING SYSTEM</small><h2>{project.brand.trustHeadline}</h2><p>{project.brand.trustBody}</p><button type="button" style={{ background: project.brand.primaryColor, color: project.brand.buttonTextColor }}>{project.brand.defaultCtaLabel}</button></div></div>
      </section>}

      {mode === "versions" && <section className={styles.fullPanel}><div className={styles.sectionIntro}><div><span className={styles.eyebrow}>VERSION HISTORY · V3</span><h1>Autosaves & Releases</h1><p>Jeder Save erzeugt eine Revision. Veröffentlichte Revision: {publishedRevision || "—"}.</p></div></div><div className={styles.versionList}>{versions.length ? versions.map((version) => <article key={version.id}><span>REV {version.revision}</span><div><strong>{version.note || "Gespeichert"}</strong><small>{new Date(version.created_at).toLocaleString("de-DE")}</small></div>{version.revision === publishedRevision && <b>LIVE</b>}</article>) : <div className={styles.emptyPanel}>Noch keine gespeicherten Revisionen.</div>}</div></section>}

      {mode === "render" && <section className={styles.fullPanel}><div className={styles.sectionIntro}><div><span className={styles.eyebrow}>RENDER & PUBLISH · V3</span><h1>Vom Studio direkt in den Outbound-Flow</h1><p>Ein Projekt, ein Lead, ein Video und eine personalisierte Landingpage.</p></div></div><div className={styles.renderGrid}><article><span>01</span><h2>Projekt speichern</h2><p>Master oder Lead-Variante inklusive Timeline, Brand Kit und Landingpage sichern.</p><button type="button" onClick={() => void save()} disabled={Boolean(busy)}>Jetzt speichern</button></article><article><span>02</span><h2>Video rendern</h2><p>Der bestehende Video-Renderer bekommt den ausgewählten Lead und die im CRM gespiegelten Talking Points.</p><button type="button" onClick={() => void renderVideo()} disabled={!selectedLead || Boolean(busy)}>Video rendern</button></article><article><span>03</span><h2>Version veröffentlichen</h2><p>Die aktuelle Studio-Revision wird als veröffentlichte Version markiert.</p><button type="button" onClick={() => void save(true)} disabled={Boolean(busy)}>Studio veröffentlichen</button></article><article><span>04</span><h2>Landingpage prüfen</h2><p>Die personalisierte Microsite des ausgewählten Leads im neuen Tab öffnen.</p>{selectedLead ? <a href={`/a/${encodeURIComponent(selectedLead.id)}`} target="_blank" rel="noreferrer">Microsite öffnen ↗</a> : <button type="button" disabled>Lead auswählen</button>}</article></div></section>}
    </div>

    <footer className={styles.statusbar}><span role="status" aria-live="polite">{busy ? "Arbeitet …" : message}</span><span>{selectedLead ? selectedLead.company : "MASTER"} · {project.timeline.aspectRatio} · {project.timeline.fps} FPS · {project.timeline.tracks.reduce((sum, track) => sum + track.items.length, 0)} Elemente</span></footer>
  </main>;
}
