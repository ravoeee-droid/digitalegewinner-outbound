"use client";

import { useState } from "react";
import styles from "./page.module.css";
import { track } from "./track";

// Native YouTube embed: no dependency on the fragile iframe_api boot process.
// A personalized screenshot and Raphael's camera thumbnail remain the preview.
// The real player is only created by the visitor's click.
export default function VideoPlayer({ youtubeId, screenshot, company }: {
  youtubeId: string;
  screenshot: string;
  company: string;
}) {
  const [opened, setOpened] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const safeId = /^[A-Za-z0-9_-]{11}$/.test(youtubeId) ? youtubeId : "";
  const youtubeUrl = safeId ? "https://www.youtube.com/watch?v=" + safeId : "";
  const embedUrl = safeId
    ? "https://www.youtube-nocookie.com/embed/" + safeId + "?autoplay=1&playsinline=1&rel=0&controls=1"
    : "";

  function openVideo() {
    if (!safeId) return;
    track("play_intent");
    setOpened(true);
  }

  return (
    <div role="group" aria-label={`Persönliches Video für ${company}`}>
      <div className={styles.player}>
        {opened && safeId ? (
          <iframe
            key={safeId}
            src={embedUrl}
            title={`Persönliche Videonachricht für ${company}`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            loading="eager"
            onLoad={() => setFrameLoaded(true)}
            style={{width:"100%",height:"100%",position:"absolute",inset:0,border:0,background:"#161616"}}
          />
        ) : (
          <>
            <div className={styles.screen}
              style={screenshot ? {backgroundImage:`url(${screenshot})`} : undefined}
            />
            <div className={styles.cam}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={safeId ? `https://i.ytimg.com/vi/${safeId}/hqdefault.jpg` : ""}
                alt=""
                style={{width:"100%",height:"100%",objectFit:"cover"}}
              />
            </div>
            {safeId ? (
              <button className={styles.bigPlay} type="button" onClick={openVideo}
                aria-label="Persönliche Videonachricht abspielen">
                <span className={styles.bigIcon} aria-hidden="true">▶</span>
                <span className={styles.bigLabel}>Persönliche Videonachricht ansehen</span>
              </button>
            ) : (
              <div className={styles.videoFinish}><strong>Video momentan nicht verfügbar.</strong></div>
            )}
          </>
        )}
      </div>
      {safeId && (
        <div style={{display:"flex",gap:12,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",marginTop:10,fontSize:12}}>
          <span style={{color:"#777571"}}>
            {opened ? (frameLoaded ? "Video geöffnet · Wiedergabe über YouTube" : "YouTube-Player wird geladen …") : "Ein Klick öffnet das persönliche Video."}
          </span>
          <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" onClick={() => track("play_intent")}
             style={{color:"#a34d22",textDecoration:"underline",textUnderlineOffset:3,fontWeight:750}}>
            Falls das Video nicht startet: direkt auf YouTube ansehen ↗
          </a>
        </div>
      )}
    </div>
  );
}
