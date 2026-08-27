"use client";

import { MouseEvent, useEffect, useState } from "react";
import PflegeProRuntime from "./PflegeProRuntime";
import GermanyCoverageRadar from "./GermanyCoverageRadar";
import SeoRadarWorkspace from "./SeoRadarWorkspace";
import styles from "./pflege-unified-runtime.module.css";

function isLeadFinderTrigger(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  const button = element?.closest("button");
  if (!button) return false;
  return button.textContent?.trim().toLowerCase().includes("lead finder") ?? false;
}

export default function PflegeUnifiedRuntime() {
  const [radarOpen, setRadarOpen] = useState(false);
  const [seoOpen, setSeoOpen] = useState(false);
  const [workspaceKey, setWorkspaceKey] = useState(0);

  useEffect(() => {
    const openRadar = () => setRadarOpen(true);
    const openSeo = () => setSeoOpen(true);
    window.addEventListener("dg:open-germany-radar", openRadar);
    window.addEventListener("dg:open-seo-radar", openSeo);
    return () => {
      window.removeEventListener("dg:open-germany-radar", openRadar);
      window.removeEventListener("dg:open-seo-radar", openSeo);
    };
  }, []);

  function captureNavigation(event: MouseEvent<HTMLDivElement>) {
    if (!isLeadFinderTrigger(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    setRadarOpen(true);
  }

  function crmChanged() {
    setWorkspaceKey((value) => value + 1);
  }

  return (
    <div className={styles.root} onClickCapture={captureNavigation}>
      <PflegeProRuntime key={workspaceKey} />

      <button className={styles.seoLauncher} type="button" onClick={() => setSeoOpen(true)} aria-label="SEO Radar öffnen">
        <span>⌕</span>
        <div><b>SEO Radar</b><small>Keywords · Reports</small></div>
        <i>NEW</i>
      </button>

      {radarOpen && (
        <div className={styles.radarLayer} role="dialog" aria-modal="true" aria-label="Deutschland Lead Finder">
          <div className={styles.radarTopbar}>
            <div>
              <span>PFLEGE SALES OS · LEAD FINDER</span>
              <strong>Deutschland Radar</strong>
            </div>
            <div className={styles.radarActions}>
              <span>Discovery → Enrichment → Call-ready → Kontaktiert</span>
              <button type="button" onClick={() => setRadarOpen(false)}>Zurück zum Workspace</button>
            </div>
          </div>
          <div className={styles.radarBody}>
            <GermanyCoverageRadar onCrmChanged={crmChanged} />
          </div>
        </div>
      )}

      {seoOpen && (
        <div className={styles.seoLayer} role="dialog" aria-modal="true" aria-label="SEO Radar">
          <div className={styles.radarTopbar}>
            <div>
              <span>DIGITALE GEWINNER · GROWTH INTELLIGENCE</span>
              <strong>SEO Radar</strong>
            </div>
            <div className={styles.radarActions}>
              <span>Keywords → Website → Social Search → Kundenreport</span>
              <button type="button" onClick={() => setSeoOpen(false)}>Zurück zum Sales OS</button>
            </div>
          </div>
          <div className={styles.seoBody}>
            <SeoRadarWorkspace embedded />
          </div>
        </div>
      )}
    </div>
  );
}
