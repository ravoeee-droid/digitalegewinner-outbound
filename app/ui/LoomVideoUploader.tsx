"use client";

import { upload } from "@vercel/blob/client";
import { useEffect, useState } from "react";

type Segment = "pv" | "pflege";
type VideoRow = {segment:string;video_url:string};
const roles: {key:Segment;title:string}[] = [
  {key:"pv",title:"PV-Trust – persönliche Aufnahme"},
  {key:"pflege",title:"Pflege – persönliche Aufnahme"},
];

export default function LoomVideoUploader() {
  const [urls,setUrls]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState<Record<string,boolean>>({});
  const [pct,setPct]=useState<Record<string,number>>({});
  const [message,setMessage]=useState<Record<string,string>>({});

  async function refresh() {
    const response = await fetch("/api/admin/loom-video-upload",{cache:"no-store"});
    const json = await response.json() as {videos?:VideoRow[];error?:string};
    if(!response.ok) throw new Error(json.error || "Speicherstatus nicht verfügbar.");
    setUrls(Object.fromEntries((json.videos||[]).map(row=>[row.segment,row.video_url])));
  }
  useEffect(()=>{void refresh().catch(()=>null);},[]);

  async function uploadFile(segment:Segment,file?:File) {
    if (!file) return;
    if (file.type !== "video/mp4" && !file.name.toLowerCase().endsWith(".mp4")) {
      setMessage(x=>({...x,[segment]:"Bitte eine MP4-Datei auswählen."})); return;
    }
    if(file.size>500_000_000){setMessage(x=>({...x,[segment]:"Die Datei darf maximal 500 MB groß sein."}));return;}
    setBusy(x=>({...x,[segment]:true}));
    setPct(x=>({...x,[segment]:0}));
    setMessage(x=>({...x,[segment]:"Übertrage direkt in den Videospeicher …"}));
    try {
      const blob = await upload(`loom-videos/${segment}.mp4`,file,{
        access:"public",
        handleUploadUrl:"/api/admin/loom-video-upload",
        multipart:true,
        clientPayload:segment,
        onUploadProgress:({percentage})=>setPct(x=>({...x,[segment]:Math.round(percentage)})),
      });
      setMessage(x=>({...x,[segment]:"Hochgeladen. Verknüpfung wird aktiviert …"}));
      // Webhook is async. The source URL is immediately available and playback
      // activates as soon as the server callback registers it.
      for(let n=0;n<5;n++) {
        await new Promise(resolve=>setTimeout(resolve,1100));
        await refresh();
      }
      setMessage(x=>({...x,[segment]:`Upload abgeschlossen: ${blob.url}`}));
    } catch(error) {
      setMessage(x=>({...x,[segment]:error instanceof Error?error.message:"Upload fehlgeschlagen"}));
    } finally {
      setBusy(x=>({...x,[segment]:false}));
    }
  }

  return <main style={{maxWidth:880,margin:"0 auto",padding:"48px 20px",color:"#ecf7ef",fontFamily:"Inter,system-ui,sans-serif"}}>
    <a href="/studio" style={{color:"#72f0ab"}}>← Studio</a>
    <h1 style={{fontSize:34,marginBottom:12}}>Loom-Videos austauschen</h1>
    <p style={{color:"#a7bdaf",lineHeight:1.6}}>
      Die Dateien werden direkt in Vercel Blob geladen – niemals in Neon oder GitHub.
      Sobald eine Datei aktiviert ist, verwenden auch bereits versendete persönliche Links automatisch die neue Aufnahme.
    </p>
    <div style={{display:"grid",gap:18,marginTop:28}}>
      {roles.map(({key,title})=><section key={key} style={{border:"1px solid #345847",borderRadius:16,padding:22,background:"#122219"}}>
        <h2 style={{fontSize:20,marginTop:0}}>{title}</h2>
        <p style={{color:urls[key]?"#72f0ab":"#ffc38e",fontSize:13}}>
          {urls[key]?"MP4 aktiv – neue personalisierte Videoseiten verwenden diese Datei.":"Noch keine MP4 aktiv – derzeit läuft die alte YouTube-Variante."}
        </p>
        <input aria-label={title} type="file" accept="video/mp4,.mp4" disabled={Boolean(busy[key])}
          onChange={event=>{void uploadFile(key,event.target.files?.[0]);}} />
        {busy[key]&&<progress value={pct[key]||0} max={100} style={{display:"block",width:"100%",marginTop:14}}/>}
        <p style={{fontSize:13,overflowWrap:"anywhere",color:"#b5cbbd"}}>{message[key] || ""}</p>
        {urls[key]&&<a href={urls[key]} target="_blank" rel="noopener noreferrer" style={{color:"#72f0ab",fontSize:13}}>Videodatei prüfen ↗</a>}
      </section>)}
    </div>
    <p style={{color:"#a7bdaf",fontSize:13,marginTop:20}}>
      Nach dem Upload auf „<a href="/v/demo?segment=pv" style={{color:"#72f0ab"}}>PV testen</a>“ oder „<a href="/v/demo?segment=pflege" style={{color:"#72f0ab"}}>Pflege testen</a>“ klicken.
    </p>
  </main>;
}
