"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import { track } from "./track";
import VideoPlayer from "./VideoBubble";

export default function NativeLoomPlayer({src,screenshot,company,posterId}:{
  src:string;screenshot:string;company:string;posterId:string;
}) {
  const video=useRef<HTMLVideoElement>(null);
  const [started,setStarted]=useState(false);
  const [playing,setPlaying]=useState(false);
  const [error,setError]=useState("");
  const [youtubeFallback,setYoutubeFallback]=useState(false);
  const validYoutube=/^[A-Za-z0-9_-]{11}$/.test(posterId);
  const milestones=useRef(new Set<number>());
  const startedTrack=useRef(false);
  const confirmedTrack=useRef(false);
  const errorTrack=useRef(false);
  const watchdogTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const watchdogPosition=useRef(0);
  function clearWatchdog() {
    if(watchdogTimer.current!==null){clearTimeout(watchdogTimer.current);watchdogTimer.current=null;}
  }
  function armWatchdog() {
    clearWatchdog();
    const el=video.current;
    if(!el)return;
    watchdogPosition.current=el.currentTime;
    watchdogTimer.current=setTimeout(()=>{
      watchdogTimer.current=null;
      const current=video.current;
      // Do not count a stalled/failed play as a confirmed video start.
      // A pending play() promise may still report paused=true, so also check
      // whether playback ever actually started.
      if(current && current.currentTime < watchdogPosition.current+0.5 && (!current.paused || !startedTrack.current)){
        reportPlayerError(408);
        setError("Video lädt zu lange. Alternative Wiedergabe wird geöffnet.");
        if(validYoutube)setYoutubeFallback(true);
      }
    },12000);
  }
  useEffect(()=>()=>clearWatchdog(),[]);
  function reportPlayerError(code:number) {
    if(!errorTrack.current) { errorTrack.current=true; track("player_error",code); }
  }

  async function play() {
    const el=video.current;
    if(!el)return;
    track("play_intent");
    setStarted(true);
    setError("");
    if(el.paused)armWatchdog();
    else clearWatchdog();
    try {
      if (el.paused) await el.play();
      else el.pause();
    } catch (err) {
      const reason=err instanceof Error?`${err.name}: ${err.message}`:String(err);
      const details=`code=${el.error?.code||0}, ready=${el.readyState}, network=${el.networkState}`;
      console.error("[loom-player] play rejected",reason,details);
      reportPlayerError(el.error?.code||408);
      setError(`Wiedergabefehler: ${reason} (${details})`);
      if(validYoutube)setYoutubeFallback(true);
    }
  }

  function onTime() {
    const el=video.current;
    if(!el||!el.duration)return;
    if(el.currentTime>=watchdogPosition.current+0.5)clearWatchdog();
    if(el.currentTime>=3 && !confirmedTrack.current){confirmedTrack.current=true;track("play_confirmed",3);}
    const percent=Math.floor(el.currentTime/el.duration*100);
    for(const value of [25,50,75,100]) {
      if(percent>=value && !milestones.current.has(value)) {
        milestones.current.add(value);track("progress",value);
      }
    }
  }

  // Never leave prospects stranded on a broken MP4: retain the existing
  // YouTube facecam as an explicit fallback, with its own 3-second tracking.
  if(youtubeFallback && validYoutube)
    return <VideoPlayer youtubeId={posterId} screenshot={screenshot} company={company} autoStart/>;

  return <div role="group" aria-label={`Persönliches Video für ${company}`}>
    <div className={styles.player}>
      <div className={styles.screen}
        style={screenshot?{backgroundImage:`url(${screenshot})`}:undefined}
        role="img" aria-label={`Website von ${company}`}/>
      <div className={styles.cam} style={{width:"22%",left:"4%",bottom:"11%",zIndex:2}}>
        <video ref={video} src={src} playsInline preload="none"
          poster={posterId?`https://i.ytimg.com/vi/${posterId}/hqdefault.jpg`:undefined}
          style={{width:"100%",height:"100%",objectFit:"cover",background:"#171717"}}
          onPlay={()=>{
            setPlaying(true);setStarted(true);setError("");
            if(!startedTrack.current){startedTrack.current=true;track("play");}
          }}
          onPause={()=>{setPlaying(false);clearWatchdog();}}
          onTimeUpdate={onTime}
          onWaiting={()=>{if(startedTrack.current)armWatchdog();}}
          onStalled={()=>{if(started)armWatchdog();}}
          onEnded={()=>{clearWatchdog();setPlaying(false);if(!milestones.current.has(100)){milestones.current.add(100);track("progress",100);}track("watch",Math.round(video.current?.duration||0));}}
          onError={()=>{clearWatchdog();const el=video.current;setPlaying(false);reportPlayerError(el?.error?.code||408);setError(`Video-Ladefehler: ${el?.error?.message||"Unbekannt"} (Code ${el?.error?.code||0}, Netzwerk ${el?.networkState||0})`);if(validYoutube)setYoutubeFallback(true);}}
        />
      </div>
      {!playing&&<button className={styles.bigPlay} type="button" onClick={play}
        aria-label={started?"Persönliches Video fortsetzen":"Persönliches Video starten"}
        style={{zIndex:3,background:"rgba(0,0,0,.16)"}}>
        <span className={styles.bigIcon} aria-hidden="true">▶</span>
        <span className={styles.bigLabel}>{started?"Video fortsetzen":"Persönliche Videonachricht starten"}</span>
      </button>}
      {playing&&<button type="button" onClick={play}
        aria-label="Video pausieren" title="Video pausieren"
        style={{position:"absolute",right:12,bottom:12,zIndex:4,padding:"9px 13px",border:"1px solid #eee",borderRadius:8,background:"#202021",color:"#fff",cursor:"pointer"}}>
        ❚❚ Pause
      </button>}
    </div>
    <p style={{fontSize:12,color:"#777571",margin:"10px 0 0"}}>
      {error||"Firmenwebsite und persönliche Videobotschaft – ohne YouTube-Anmeldung."}
    </p>
  </div>;
}
