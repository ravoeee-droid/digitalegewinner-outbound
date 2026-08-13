"use client";

import { useRef } from "react";

export default function TrackedVideo({leadId,src}:{leadId:string;src:string}){
  const sent=useRef(0);
  function onProgress(event:React.SyntheticEvent<HTMLVideoElement>){
    const video=event.currentTarget;
    if(!Number.isFinite(video.duration)||video.duration<=0)return;
    const percent=Math.min(100,Math.round((video.currentTime/video.duration)*100));
    const threshold=percent>=90?90:percent>=75?75:percent>=50?50:percent>=25?25:0;
    if(!threshold||threshold<=sent.current)return;
    sent.current=threshold;
    void fetch("/api/jj-media/track",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({leadId,type:"video_view",value:threshold}),keepalive:true}).catch(()=>undefined);
  }
  return <video controls preload="metadata" src={src} onTimeUpdate={onProgress} style={{width:"100%",display:"block",borderRadius:22,aspectRatio:"16/9",background:"#050505"}}/>;
}
