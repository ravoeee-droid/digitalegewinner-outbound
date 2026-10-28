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
    ? `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&playsinline=1&rel=0&controls=0&modestbranding=1&iv_load_policy=3&fs=0`
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
        <div className={styles.cam} style={started ? { width: "22%", bottom: "11%", left: "4%" } : undefined}>
          <div className={styles.camInner} style={{pointerEvents: started ? "auto" : "none"}}>
            {started ? (
              <iframe
                src={url}
                title={`Raphael Hermann – Facecam für ${company}`}
                allow="autoplay; encrypted-media"
                referrerPolicy="strict-origin-when-cross-origin"
                loading="eager"
                onLoad={() => setLoaded(true)}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className={styles.poster}
                src={valid ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : ""}
                alt="Raphael Hermann"
              />
            )}
          </div>
        </div>
        {started && (
          <button
            type="button"
            onClick={() => { setStarted(false); setLoaded(false); }}
            aria-label="Persönliches Video stoppen"
            style={{ position:"absolute",right:12,bottom:12,zIndex:5,padding:"8px 12px",background:"#202021",color:"#fff",border:"1px solid #ddd",borderRadius:8,fontSize:12,cursor:"pointer" }}
          >■ Video stoppen</button>
        )}
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
          ? (loaded ? "Die Firmenwebsite bleibt sichtbar. Raphaels Video läuft ausschließlich in der runden Facecam. Falls es nicht startet, tippen Sie in die Facecam." : "Video wird geladen – Ihre Website bleibt sichtbar.")
          : "Ein Klick startet Raphaels persönliche Nachricht zur Website Ihres Betriebs."}
      </p>
    </div>
  );
}
