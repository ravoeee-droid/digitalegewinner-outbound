"use client";

import { useState } from "react";
import styles from "./page.module.css";
import { track } from "./track";

// Personalized Loom composition: the company's screenshot ALWAYS stays on screen.
// Only Raphael's circular facecam contains the YouTube video, never the full frame.
export default function VideoPlayer({ youtubeId, screenshot, company }: {
  youtubeId: string; screenshot: string; company: string;
}) {
  const [started, setStarted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const valid = /^[A-Za-z0-9_-]{11}$/.test(youtubeId);
  const url = valid
    ? `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&playsinline=1&rel=0&controls=1`
    : "";

  function start() {
    if (!valid) return;
    track("play_intent");
    setStarted(true);
  }

  return (
    <div role="group" aria-label={`Persönliche Videonachricht für ${company}`}>
      <div className={styles.player}>
        <div
          className={styles.screen}
          style={screenshot ? { backgroundImage: `url(${screenshot})` } : undefined}
          aria-label={`Website von ${company}`}
          role="img"
        />
        <div className={styles.cam} style={started ? {width:"35%",left:"3.5%",bottom:"9%",borderRadius:18} : undefined}>
          {started ? (
            <iframe
              src={url}
              title={`Raphael Hermann – Video für ${company}`}
              allow="autoplay; encrypted-media; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              loading="eager"
              onLoad={() => setLoaded(true)}
              style={{position:"absolute",inset:0,width:"100%",height:"100%",border:0,background:"#171717"}}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={valid ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : ""}
              alt="Raphael Hermann"
              style={{width:"100%",height:"100%",objectFit:"cover"}}
            />
          )}
        </div>
        {!started && (
          valid ? (
            <button className={styles.bigPlay} type="button" onClick={start} aria-label="Persönliche Videonachricht starten">
              <span className={styles.bigIcon} aria-hidden="true">▶</span>
              <span className={styles.bigLabel}>Persönliche Videonachricht starten</span>
            </button>
          ) : (
            <div className={styles.videoFinish}><strong>Video nicht verfügbar.</strong></div>
          )
        )}
      </div>
      <p style={{margin:"10px 0 0",fontSize:12,color:"#777571"}}>
        {started
          ? (loaded ? "Sie sehen die Firmenwebsite mit Raphaels Videonachricht. Falls die Wiedergabe nicht startet, bitte im Videofenster auf Play tippen." : "Video wird geladen – Ihre Website bleibt sichtbar.")
          : "Ein Klick startet Raphaels persönliche Nachricht zur Website Ihres Betriebs."}
      </p>
    </div>
  );
}
