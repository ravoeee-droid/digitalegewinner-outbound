"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import { track } from "./track";

export default function NativeLoomPlayer({src,screenshot,company,posterId,debug=false}:{
  src:string;screenshot:string;company:string;posterId:string;debug?:boolean;
}) {
  const video=useRef<HTMLVideoElement>(null);
  const [started,setStarted]=useState(false);
  const [playing,setPlaying]=useState(false);
  const [error,setError]=useState("");
  const [youtubeFallback,setYoutubeFallback]=useState(false);
  const [probe,setProbe]=useState("");
  const validYoutube=/^[A-Za-z0-9_-]{11}$/.test(posterId);
  const milestones=useRef(new Set<number>());
  const startedTrack=useRef(false);
  const confirmedTrack=useRef(false);
  // Accumulate real media progression; a seek to 3s is not 3s watched.
  const watchedSeconds=useRef(0);
  // Distinct media intervals: seeking to the end or replaying the same section
  // must not create false 25/50/75/100% watch milestones.
  const watchedRanges=useRef<Array<[number,number]>>([]);
  const lastPlaybackPosition=useRef(0);
  function uniqueWatchedSeconds() {
    return watchedRanges.current.reduce((total,[start,end])=>total+end-start,0);
  }
  function recordWatchedRange(start:number,end:number) {
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return;
    const merged:Array<[number,number]>=[];
    let left=start,right=end,inserted=false;
    for(const [a,b] of watchedRanges.current) {
      if(b<left){merged.push([a,b]);continue;}
      if(a>right){
        if(!inserted){merged.push([left,right]);inserted=true;}
        merged.push([a,b]);continue;
      }
      left=Math.min(left,a);
      right=Math.max(right,b);
    }
    if(!inserted)merged.push([left,right]);
    watchedRanges.current=merged;
  }
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
      // A user-initiated play that made no progress is stalled even when
      // the browser unexpectedly reports paused=true. Manual pause clears this timer.
      if(current && current.currentTime < watchdogPosition.current+0.5){
        reportPlayerError(408);
        setError("Video lädt zu lange. Alternative Wiedergabe wird geöffnet.");
        if(validYoutube)setYoutubeFallback(true);
      }
    },12000);
  }
  useEffect(()=>()=>clearWatchdog(),[]);
  function reportPlayerError(code:number) {
    if(!errorTrack.current) { errorTrack.current=true; track("player_error",code,{source:"native",ready:video.current?.readyState??0,network:video.current?.networkState??0,position:Math.round(video.current?.currentTime||0),visibility:document.visibilityState}); }
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
    const delta=el.currentTime-lastPlaybackPosition.current;
    if(delta>0 && delta<=1.5 && !el.paused && !el.seeking) {
      watchedSeconds.current+=delta;
      recordWatchedRange(lastPlaybackPosition.current,el.currentTime);
    }
    lastPlaybackPosition.current=el.currentTime;
    if(watchedSeconds.current>=3 && !confirmedTrack.current){confirmedTrack.current=true;track("play_confirmed",3);}
    const uniquePercent=Math.min(100,Math.floor(uniqueWatchedSeconds()/el.duration*100));
    for(const value of [25,50,75,100]) {
      if(uniquePercent>=value && !milestones.current.has(value)) {
        milestones.current.add(value);track("progress",value);
      }
    }
  }

  // Preview-only differential diagnosis: compare the streamed response with
  // a fully buffered Blob and inspect metadata. Never fetch the full asset in
  // production; this is enabled only on the protected preview deployment.
  useEffect(()=>{
    if(!debug || !youtubeFallback)return;
    let cancelled=false;
    (async()=>{
      try{
        const response=await fetch(src,{headers:{Range:"bytes=0-"}});
        const bytes=await response.arrayBuffer();
        if(cancelled)return;
        const test=document.createElement("video");
        const blobUrl=URL.createObjectURL(new Blob([bytes],{type:"video/mp4"}));
        test.preload="metadata";
        const mediaResult=await new Promise<string>(resolve=>{
          const timeout=window.setTimeout(()=>resolve("metadata_timeout"),8000);
          test.onloadedmetadata=()=>{clearTimeout(timeout);resolve("metadata_ok duration="+test.duration);};
          test.onerror=()=>{clearTimeout(timeout);resolve("metadata_error code="+(test.error?.code??0));};
          test.src=blobUrl;
        });
        URL.revokeObjectURL(blobUrl);
        if(!cancelled)setProbe("HTTP "+response.status+" received="+bytes.byteLength+" length="+response.headers.get("content-length")+" range="+response.headers.get("content-range")+" buffered="+mediaResult+" canPlay="+test.canPlayType('video/mp4; codecs="avc1.64001f"'));
      }catch(err){
        if(!cancelled)setProbe("fetch_error "+(err instanceof Error?err.message:String(err)));
      }
    })();
    return ()=>{cancelled=true;};
  },[debug,youtubeFallback,src]);

  // Do not embed YouTube after a native decoder/network failure: automated
  // visitors hit YouTube's anti-bot gate and never reach the video. Offer the
  // same first-party MP4 as a direct browser/OS player instead.
  if(youtubeFallback)
    return <div role="group" aria-label={`Video-Alternative für ${company}`}>
      <div className={styles.player} style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14,padding:24,textAlign:"center"}}>
        <div className={styles.screen} style={screenshot?{backgroundImage:`url(${screenshot})`}:undefined} aria-hidden="true"/>
        <div style={{position:"relative",zIndex:3,maxWidth:450,color:"#fff",background:"rgba(10,10,10,.84)",padding:18,borderRadius:12}}>
          <strong>Das Video konnte hier nicht abgespielt werden.</strong>
          <p style={{fontSize:14,margin:"8px 0 14px"}}>Öffnen Sie die Videodatei direkt im Browser oder im Videoplayer Ihres Geräts.</p>
          <a href={src} target="_blank" rel="noopener noreferrer" style={{display:"inline-block",padding:"12px 18px",borderRadius:8,background:"#ff641e",color:"#fff",fontWeight:700,textDecoration:"none"}}>Video direkt öffnen ↗</a>
          <p style={{fontSize:12,margin:"12px 0 0"}}>
            {validYoutube?<a href={`https://www.youtube.com/watch?v=${posterId}`} target="_blank" rel="noopener noreferrer" style={{color:"#fff",textDecoration:"underline"}}>Alternativ auf YouTube öffnen ↗</a>:null}
          </p>
        </div>
      </div>
      {debug && <p role="status" data-testid="native-mp4-diagnostic" style={{fontSize:13,color:"#a00000",padding:8}}>
        Native MP4 failed: {error||"Unknown error"}; ready={video.current?.readyState??"n/a"}; network={video.current?.networkState??"n/a"}; time={video.current?.currentTime??"n/a"}; {probe||"probe pending"}
      </p>}
    </div>;

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
            lastPlaybackPosition.current=video.current?.currentTime??0;
            if(!startedTrack.current){startedTrack.current=true;track("play");}
          }}
          onPause={()=>{setPlaying(false);clearWatchdog();}}
          onTimeUpdate={onTime}
          onWaiting={()=>{if(startedTrack.current)armWatchdog();}}
          onStalled={()=>{if(started)armWatchdog();}}
          onEnded={()=>{clearWatchdog();setPlaying(false);const duration=video.current?.duration||0;if(duration>0&&uniqueWatchedSeconds()>=duration*.95){if(!milestones.current.has(100)){milestones.current.add(100);track("progress",100);}track("watch",Math.round(duration));}}}
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
