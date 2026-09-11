"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import styles from "./DGCoreHologram.module.css";

export type DGCoreState = "idle" | "listening" | "thinking" | "acting" | "speaking" | "error";

type Props = {
  state: DGCoreState;
  note: string;
  className?: string;
};

const PARTICLES = [
  [12, 18, 0.1, 2.2], [21, 28, 1.8, 1.6], [33, 13, 2.6, 1.9], [46, 22, 0.9, 1.4],
  [61, 15, 3.4, 2.2], [74, 30, 1.1, 1.7], [88, 20, 2.8, 1.6], [15, 52, 4.1, 1.3],
  [29, 63, 0.6, 1.8], [43, 48, 2.1, 1.2], [58, 59, 4.8, 1.5], [71, 51, 1.7, 2.1],
  [84, 68, 3.8, 1.3], [20, 82, 2.9, 1.6], [39, 76, 0.4, 1.4], [64, 80, 2.4, 1.8],
  [78, 88, 4.4, 1.2], [50, 90, 1.4, 1.5],
] as const;

const STATE_COPY: Record<DGCoreState, { label: string; sub: string }> = {
  idle: { label: "Operator online", sub: "Präsent · bereit" },
  listening: { label: "Ich höre zu", sub: "Audio-Reaktion aktiv" },
  thinking: { label: "Ich analysiere", sub: "Kontext · Strategie · Priorität" },
  acting: { label: "Ich setze um", sub: "Sichere Aktionen laufen" },
  speaking: { label: "Ich antworte", sub: "Voice-Ausgabe aktiv" },
  error: { label: "Safe Mode", sub: "Manuelle Prüfung nötig" },
};

export default function DGCoreHologram({ state, note, className = "" }: Props) {
  const copy = STATE_COPY[state];
  return (
    <section className={`${className} ${styles.scene}`} data-state={state} aria-live="polite">
      <div className={styles.backGlow} />
      <div className={styles.verticalBeam} />
      <div className={styles.scanline} />
      <div className={styles.microGrid} />

      <div className={styles.particleField} aria-hidden="true">
        {PARTICLES.map(([x, y, delay, size], index) => (
          <i
            key={index}
            style={{
              "--x": `${x}%`,
              "--y": `${y}%`,
              "--delay": `${delay}s`,
              "--size": `${size}px`,
            } as CSSProperties}
          />
        ))}
      </div>

      <div className={styles.orbitSystem} aria-hidden="true">
        <i className={styles.orbitA} />
        <i className={styles.orbitB} />
        <i className={styles.orbitC} />
        <span className={styles.orbitNodeA} />
        <span className={styles.orbitNodeB} />
        <span className={styles.orbitNodeC} />
      </div>

      <div className={styles.waveLeft} aria-hidden="true">
        {Array.from({ length: 11 }).map((_, index) => <i key={index} style={{ "--i": index } as CSSProperties} />)}
      </div>
      <div className={styles.waveRight} aria-hidden="true">
        {Array.from({ length: 11 }).map((_, index) => <i key={index} style={{ "--i": index } as CSSProperties} />)}
      </div>

      <div className={styles.logicCloud} aria-hidden="true">
        <span className={styles.logicCardA}><b>ANALYSE</b><small>Kontext · Muster · Chancen</small></span>
        <span className={styles.logicCardB}><b>PRIORITÄT</b><small>Score 93 · hoher Fit</small></span>
        <span className={styles.logicCardC}><b>STRATEGIE</b><small>Nächster sinnvoller Schritt</small></span>
      </div>

      <div className={styles.actionCloud} aria-hidden="true">
        <span className={styles.actionCardA}><i /> <b>Leads priorisiert</b><small>120 geprüft</small></span>
        <span className={styles.actionCardB}><i /> <b>Follow-up vorbereitet</b><small>persönlich · sicher</small></span>
        <span className={styles.actionCardC}><i /> <b>Pipeline aktualisiert</b><small>CRM synchron</small></span>
      </div>

      <div className={styles.operatorHalo} aria-hidden="true" />
      <div className={styles.operatorWrap}>
        <Image
          src="/dg-ai-operator-v5.webp"
          alt="DG Core holografischer KI Operator"
          width={460}
          height={990}
          priority
          className={styles.operator}
        />
        <div className={styles.operatorChromatic} aria-hidden="true" />
        <div className={styles.bodySweep} aria-hidden="true" />
      </div>

      <div className={styles.statusRail}>
        <span>ANALYSIERT</span>
        <span>PRIORISIERT</span>
        <span>HANDELT</span>
        <span>SKALIERT</span>
      </div>

      <div className={styles.stateCard}>
        <div><i /><strong>DG CORE</strong></div>
        <b>{copy.label}</b>
        <small>{copy.sub}</small>
      </div>

      <div className={styles.thoughtBubble} title={note}>{note}</div>

      <div className={styles.emitter} aria-hidden="true">
        <i className={styles.ringOuter} />
        <i className={styles.ringMiddle} />
        <i className={styles.ringInner} />
        <i className={styles.ringCore} />
        <span className={styles.emitterGlow} />
      </div>
    </section>
  );
}
