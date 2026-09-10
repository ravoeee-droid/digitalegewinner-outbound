"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./RevenueCommandDeck.module.css";

type MissionSnapshot = {
  mission: {
    type: string;
    kicker: string;
    title: string;
    detail: string;
    actionLabel: string;
    href: string;
    progress: number;
  };
  metrics: {
    callsDone: number;
    callsTarget: number;
    callsReady: number;
    connected: number;
    connectRate: number;
    activeBuilds: number;
    buildAverage: number;
    dueFollowups: number;
    weightedPipeline: number;
    openOpportunities: number;
  };
};

function compactEuro(value: number) {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1).replace(".", ",")} Mio. €`;
  if (number >= 1000) return `${Math.round(number / 1000)}k €`;
  return `${Math.round(number)} €`;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export default function RevenueCommandDeck() {
  const [data, setData] = useState<MissionSnapshot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/mission-control", { cache: "no-store" });
        const json = await response.json();
        if (!response.ok) throw new Error(json?.error || "Mission Control offline");
        if (!cancelled) {
          setData(json);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Mission Control offline");
      }
    };
    void load();
    const timer = window.setInterval(load, 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const metrics = data?.metrics;
  const mission = data?.mission;
  const callProgress = metrics ? clamp(metrics.callsDone / Math.max(1, metrics.callsTarget) * 100) : 0;

  return (
    <section className={styles.deck} aria-label="Digitale Gewinner Mission Control">
      <div className={styles.scanline} aria-hidden="true" />
      <header className={styles.top}>
        <Link href="/outbound" className={styles.brand}>
          <span className={styles.logo}>DG</span>
          <span><strong>DIGITALE GEWINNER</strong><small>REVENUE OPERATING SYSTEM // 2050</small></span>
        </Link>
        <nav className={styles.nav} aria-label="Revenue OS Navigation">
          <Link href="/outbound">OUTBOUND</Link>
          <Link href="/call">CALL COCKPIT</Link>
          <Link href="/websites">WEBSITE BUILDS</Link>
          <Link href="/outreach">OUTREACH</Link>
        </nav>
        <div className={styles.status}><i /> SYSTEM LIVE</div>
      </header>

      <div className={styles.grid}>
        <div className={styles.mission}>
          <span className={styles.eyebrow}>{mission?.kicker || "MISSION CONTROL"}</span>
          <div className={styles.missionRow}>
            <div>
              <h2>{mission?.title || (error ? "Core-System läuft weiter" : "Nächste Mission wird berechnet …")}</h2>
              <p>{mission?.detail || error || "Revenue-, Call- und Build-Daten werden synchronisiert."}</p>
            </div>
            <Link href={mission?.href || "/outbound"} className={styles.primary}>
              {mission?.actionLabel || "SYSTEM ÖFFNEN"}<span>↗</span>
            </Link>
          </div>
          {mission?.progress ? <div className={styles.missionProgress}><i style={{ width: `${clamp(mission.progress)}%` }} /></div> : null}
        </div>

        <div className={styles.telemetry}>
          <div className={styles.metric}>
            <span>CALL VELOCITY</span>
            <strong>{metrics?.callsDone ?? "—"}<small> / {metrics?.callsTarget ?? 120}</small></strong>
            <div className={styles.bar}><i style={{ width: `${callProgress}%` }} /></div>
            <em>{metrics?.callsReady ?? 0} bereit · {metrics?.connectRate ?? 0}% Connect</em>
          </div>
          <div className={styles.metric}>
            <span>BUILD STREAM</span>
            <strong>{metrics?.activeBuilds ?? "—"}<small> aktiv</small></strong>
            <div className={styles.bar}><i style={{ width: `${clamp(metrics?.buildAverage || 0)}%` }} /></div>
            <em>Ø {metrics?.buildAverage ?? 0}% Fortschritt</em>
          </div>
          <div className={styles.metric}>
            <span>WEIGHTED PIPELINE</span>
            <strong>{metrics ? compactEuro(metrics.weightedPipeline) : "—"}</strong>
            <em>{metrics?.openOpportunities ?? 0} Chancen · {metrics?.dueFollowups ?? 0} fällig</em>
          </div>
        </div>
      </div>
    </section>
  );
}
