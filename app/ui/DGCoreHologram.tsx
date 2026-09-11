"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import styles from "./DGCoreHologram.module.css";

export type DGCoreState = "idle" | "listening" | "thinking" | "acting" | "speaking" | "error";

type Props = { state: DGCoreState; note: string; className?: string };

const PARTICLES = [
  [8,18,.3,1.5],[16,33,2.2,2],[27,11,4.1,1.6],[39,24,1.4,1.2],[53,14,3.2,1.8],[66,28,.8,1.4],[82,16,2.9,1.8],[91,36,4.7,1.2],
  [11,59,3.6,1.7],[23,72,1.1,1.3],[37,52,2.8,1.6],[52,68,.4,2],[69,54,4.4,1.2],[84,71,1.9,1.5],[18,87,3.1,1.2],[43,83,1.5,1.6],[63,89,4,1.2],[79,84,.7,1.7],
] as const;

const LABEL: Record<DGCoreState, string> = {
  idle: "Operator online",
  listening: "Ich höre zu",
  thinking: "Ich analysiere",
  acting: "Ich setze um",
  speaking: "Ich antworte",
  error: "Safe Mode",
};

export default function DGCoreHologram({ state, note, className = "" }: Props) {
  return (
    <section className={`${className} ${styles.scene}`} data-state={state} aria-live="polite">
      <div className={styles.aurora} />
      <div className={styles.gridFloor} />
      <div className={styles.beam} />
      <div className={styles.scan} />

      <div className={styles.particles} aria-hidden="true">
        {PARTICLES.map(([x,y,d,s],i)=><i key={i} style={{"--x":`${x}%`,"--y":`${y}%`,"--d":`${d}s`,"--s":`${s}px`} as CSSProperties}/>) }
      </div>

      <div className={styles.orbits} aria-hidden="true">
        <i/><i/><i/><span/><span/><span/>
      </div>

      <div className={styles.listeningWaves} aria-hidden="true">
        <div>{Array.from({length:9}).map((_,i)=><i key={i} style={{"--i":i} as CSSProperties}/>)}</div>
        <div>{Array.from({length:9}).map((_,i)=><i key={i} style={{"--i":i} as CSSProperties}/>)}</div>
      </div>

      <div className={styles.operatorFrame}>
        <div className={styles.headHalo}/>
        <Image src="/dg-ai-operator-v5.webp" alt="DG Core holografischer KI Operator" width={520} height={990} priority className={styles.operator}/>
        <div className={styles.holoNoise}/>
        <div className={styles.bodyScan}/>
      </div>

      <div className={styles.thinkingCards} aria-hidden="true">
        <article><span>01</span><b>Kontext</b><small>Website · Bedarf · Timing</small></article>
        <article><span>02</span><b>Priorität</b><small>Fit · Intent · Wahrscheinlichkeit</small></article>
        <article><span>03</span><b>Nächster Schritt</b><small>klar · sicher · messbar</small></article>
      </div>

      <div className={styles.actionCards} aria-hidden="true">
        <article><i/><div><b>Leads priorisiert</b><small>120 geprüft · Top Fit zuerst</small></div></article>
        <article><i/><div><b>Follow-up vorbereitet</b><small>personalisierte Nachricht</small></div></article>
        <article><i/><div><b>Pipeline synchronisiert</b><small>CRM · Status · nächste Aktion</small></div></article>
      </div>

      <div className={styles.coreBadge}><i/><span>DG CORE</span><b>{LABEL[state]}</b></div>
      <div className={styles.note} title={note}>{note}</div>

      <div className={styles.emitter} aria-hidden="true"><i/><i/><i/><i/><span/></div>
    </section>
  );
}
