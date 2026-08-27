"use client";

import { MouseEvent, useEffect, useState } from "react";
import PflegeProRuntime from "./PflegeProRuntime";
import GermanyCoverageRadar from "./GermanyCoverageRadar";
import styles from "./pflege-unified-runtime.module.css";

function isLeadFinderTrigger(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  const button = element?.closest("button");
  if (!button) return false;
  return button.textContent?.trim().toLowerCase().includes("lead finder") ?? false;
}

export default function PflegeUnifiedRuntime() {
  const [radarOpen, setRadarOpen] = useState(false);
  const [workspaceKey, setWorkspaceKey] = useState(0);

  useEffect(() => {
    const open = () => setRadarOpen(true);
    window.addEventListener("dg:open-germany-radar", open);
    return () => window.removeEventListener("dg:open-germany-radar", open);
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
    </div>
  );
}
