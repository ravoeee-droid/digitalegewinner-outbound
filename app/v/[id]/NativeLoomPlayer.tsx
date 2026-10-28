"use client";

import { useRef, useState } from "react";
import styles from "./page.module.css";
import { track } from "./track";

export default function NativeLoomPlayer({src,screenshot,company,posterId}:{
  src:string;screenshot:string;company:string;posterId:string;
}) {
  const video=useRef<HTMLVideoElement>(null);
  const [started,setStarted]=useState(false);
  const [playing,setPlaying]=useState(false);
  const [error,setError]=useState("");
  const milestones=useRef(new Set<number>());
  const startedTrack=useRef(false);
  const confirmedTrack=useRef(false);
  const errorTrack=useRef(false);
  function reportPlayerError(code:number) {
    if(!errorTrack.current) { errorTrack.current=true; track("player_error",code); }
  }

  async function play() {
    const el=video.current;
    if(!el)return;
    track("play_intent");
    setStarted(true);
    setError("");
    try {
      if (el.paused) await el.play();
      else el.pause();
    } catch (err) {
      const reason=err instanceof Error?`${err.name}: ${err.message}`:String(err);
      const details=`code=${el.error?.code||0}, ready=${el.readyState}, network=${el.networkState}`;
      console.error("[loom-player] play rejected",reason,details);
      reportPlayerError(el.error?.code||408);
      setError(`Wiedergabefehler: ${reason} (${details})`);
    }
  }

  function onTime() {
    const el=video.current;
    if(!el||!el.duration)return;
    if(el.currentTime>=3 && !confirmedTrack.current){confirmedTrack.current=true;track("play_confirmed",3);}
    const percent=Math.floor(el.currentTime/el.duration*100);
    for(const value of [25,50,75,100]) {
      if(percent>=value && !milestones.current.has(value)) {
        milestones.current.add(value);track("progress",value);
      }
    }
  }

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
          onPause={()=>setPlaying(false)}
          onTimeUpdate={onTime}
          onEnded={()=>{setPlaying(false);if(!milestones.current.has(100)){milestones.current.add(100);track("progress",100);}track("watch",Math.round(video.current?.duration||0));}}
          onError={()=>{const el=video.current;setPlaying(false);reportPlayerError(el?.error?.code||408);setError(`Video-Ladefehler: ${el?.error?.message||"Unbekannt"} (Code ${el?.error?.code||0}, Netzwerk ${el?.networkState||0})`);}}
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
