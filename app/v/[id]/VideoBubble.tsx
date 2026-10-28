"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import { track } from "./track";

// Loom-style composition: the prospect's screenshot is always visible and the
// YouTube clip is always cropped INSIDE the circular facecam, never full-frame.
export default function VideoPlayer({ youtubeId, screenshot, company, autoStart = false }: {
  youtubeId: string; screenshot: string; company: string; autoStart?: boolean;
}) {
  const [started, setStarted] = useState(autoStart);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [showRescue, setShowRescue] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const confirmedTrack = useRef(false);
  const valid = /^[A-Za-z0-9_-]{11}$/.test(youtubeId);
  const embedUrl = valid
    ? `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&playsinline=1&rel=0&controls=0&modestbranding=1&iv_load_policy=3&fs=0&enablejsapi=1`
    : "";

  // The first click opens the facecam player. YouTube may refuse autoplay,
  // in which case the large, central Play control remains accessible.
  function play() {
    if (!valid) return;
    track("play_intent");
    if (!started) {
      setShowRescue(false);
      setStarted(true);
      return;
    }
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({event:"command",func:"playVideo",args:[]}), "*"
    );
  }

  useEffect(() => {
    if (!started) return;
    function onMessage(event: MessageEvent) {
      if (!/^https:\/\/(www\.)?youtube(-nocookie)?\.com$/.test(event.origin)) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      let data: {event?: string; info?: number} | undefined;
      try { data = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch { return; }
      if (data?.event === "onError") { track("player_error",typeof data.info==="number"?data.info:408,{source:"youtube",visibility:document.visibilityState}); setShowRescue(true); }
      if (data?.event === "onStateChange" && typeof data.info === "number") {
        setPlaying(data.info === 1);
        if (data.info === 1) { setShowRescue(false); track("play"); }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [started]);

  // If the embedded player never starts, show an actionable rescue path instead of a silent thumbnail.
  useEffect(() => {
    if (!started || playing || showRescue) return;
    const timer = window.setTimeout(() => setShowRescue(true), 8000);
    return () => window.clearTimeout(timer);
  }, [started, playing, showRescue]);

  // YouTube fallback has no native video currentTime event. Confirm a start only
  // after the iframe reports three uninterrupted seconds in PLAYING state.
  useEffect(() => {
    if(!playing || confirmedTrack.current) return;
    const timer=window.setTimeout(() => {
      confirmedTrack.current=true;
      track("play_confirmed",3);
    },3000);
    return () => window.clearTimeout(timer);
  },[playing]);

  return (
    <div role="group" aria-label={`Persönliche Videonachricht für ${company}`}>
      <div className={styles.player}>
        <div className={styles.screen}
          style={screenshot ? {backgroundImage: `url(${screenshot})`} : undefined}
          role="img" aria-label={`Website von ${company}`} />
        <div className={styles.cam} style={started ? {width:"22%",bottom:"11%",left:"4%"} : undefined}>
          <div className={styles.camInner} style={{pointerEvents:started?"auto":"none"}}>
            {started ? (
              <iframe ref={iframeRef} src={embedUrl}
                title={`Raphael Hermann – Facecam für ${company}`}
                allow="autoplay; encrypted-media"
                referrerPolicy="strict-origin-when-cross-origin"
                loading="eager"
                onLoad={() => {
                  setLoaded(true);
                  iframeRef.current?.contentWindow?.postMessage(
                    JSON.stringify({event:"listening"}), "*"
                  );
                }}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.poster}
                src={valid ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : ""}
                alt="Raphael Hermann" />
            )}
          </div>
        </div>
        {started && (
          <button type="button" onClick={() => {setStarted(false);setLoaded(false);setPlaying(false);setShowRescue(false);}}
            aria-label="Persönliche Videonachricht stoppen"
            style={{position:"absolute",right:12,bottom:12,zIndex:5,padding:"8px 12px",background:"#202021",color:"#fff",border:"1px solid #ddd",borderRadius:8,fontSize:12,cursor:"pointer"}}>
            ■ Video stoppen
          </button>
        )}
        {valid ? (!playing && (
          <button type="button" className={styles.bigPlay} onClick={play}
            aria-label={started ? "Videowiedergabe starten" : "Persönliche Videonachricht starten"}
            style={started ? {background:"transparent",pointerEvents:"none"} : undefined}>
            <span className={styles.bigIcon}
              style={started ? {pointerEvents:"auto",cursor:"pointer"} : undefined} aria-hidden="true">▶</span>
            <span className={styles.bigLabel} style={started ? {pointerEvents:"auto",cursor:"pointer"} : undefined}>
              {started ? (loaded ? "Video abspielen" : "Video wird geladen …") : "Persönliche Videonachricht starten"}
            </span>
          </button>
        )) : (
          <div className={styles.videoFinish}><strong>Video nicht verfügbar.</strong></div>
        )}
      </div>
      <p style={{margin:"10px 0 0",fontSize:12,color:"#777571"}}>
        {started ? "Die Firmenwebsite bleibt sichtbar. Ihre persönliche Nachricht läuft in der runden Facecam." :
          "▶ Klicken Sie auf Play, um Ihre persönliche Videonachricht anzusehen."}
        {started && !playing && valid && !showRescue && <><span> </span><a href={`https://www.youtube.com/watch?v=${youtubeId}`} target="_blank" rel="noopener noreferrer">Video startet nicht? Direkt auf YouTube ansehen.</a></>}
        {started && !playing && valid && showRescue && <span role="status" style={{display:"block",marginTop:8,padding:"12px 14px",border:"1px solid #d6b56a",borderRadius:10,background:"#fff9eb",color:"#3c3322",fontSize:14}}><strong>Video lädt nicht?</strong> <a href={`https://www.youtube.com/watch?v=${youtubeId}`} target="_blank" rel="noopener noreferrer" style={{fontWeight:700,textDecoration:"underline",color:"#292929"}}>Video direkt auf YouTube ansehen</a>. Alternativ können Sie unten sofort einen kostenlosen Termin wählen.</span>}
      </p>
    </div>
  );
}
