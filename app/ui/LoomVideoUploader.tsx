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
  const [stage,setStage]=useState<Record<string,string>>({});
  const [probeBusy,setProbeBusy]=useState(false);
  const [probeStatus,setProbeStatus]=useState("");
  async function testUpload() {
    setProbeBusy(true);
    setProbeStatus("Teste zunächst die Server-Freigabe …");
    try {
      const response = await fetch("/api/admin/loom-video-upload",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"diagnose"}),credentials:"same-origin"
      });
      const json = await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!json.ok)throw new Error(json.error||"Freigabe fehlgeschlagen.");
      setProbeStatus("Freigabe OK. Lade nur 8 KB direkt in Vercel Blob …");
      const diagnosticFile = new File([new Uint8Array(8192)],"probe.mp4",{type:"video/mp4"});
      await Promise.race([
        upload("loom-videos/probe.mp4",diagnosticFile,{
          access:"public",handleUploadUrl:"/api/admin/loom-video-upload",
          contentType:"video/mp4",multipart:false,clientPayload:"probe",
          onUploadProgress:({percentage})=>setProbeStatus("Testupload: "+Math.round(percentage)+" %")
        }),
        new Promise<never>((_,reject)=>window.setTimeout(()=>reject(new Error("Testupload kommt innerhalb von 15 Sekunden nicht bei Vercel Blob an. Ursache vermutlich Browser-Netzwerk, CORS oder Speicherfreigabe.")),15000))
      ]);
      setProbeStatus("✓ Testupload erfolgreich – die Verbindung funktioniert. Der große Multipart-Upload ist das Problem.");
    } catch(error) {
      setProbeStatus("✕ "+(error instanceof Error?error.message:"Test fehlgeschlagen."));
    } finally {setProbeBusy(false);}
  }


  async function refresh() {
    const response = await fetch("/api/admin/loom-video-upload",{cache:"no-store"});
    const json = await response.json() as {videos?:VideoRow[];error?:string};
    if(!response.ok) throw new Error(json.error || "Speicherstatus nicht verfügbar.");
    setUrls(Object.fromEntries((json.videos||[]).map(row=>[row.segment,row.video_url])));
  }
  useEffect(()=>{void refresh().catch(()=>null);},[]);

  async function uploadFile(segment:Segment,file?:File) {
    if (!file) return;
    if(Object.values(busy).some(Boolean)) {setMessage(x=>({...x,[segment]:"Bitte zuerst den anderen Upload beenden."}));return;}
    if (file.type !== "video/mp4" && !file.name.toLowerCase().endsWith(".mp4")) {
      setMessage(x=>({...x,[segment]:"Bitte eine MP4-Datei auswählen."})); return;
    }
    if(file.size>500_000_000){setMessage(x=>({...x,[segment]:"Die Datei darf maximal 500 MB groß sein."}));return;}
    setBusy(x=>({...x,[segment]:true}));
    setPct(x=>({...x,[segment]:0}));
    setMessage(x=>({...x,[segment]:`Verbindung zum Videospeicher wird aufgebaut · ${Math.round(file.size/1048576)} MB …`}));
    let lastProgress=Date.now();
    const controller = new AbortController();
    // Keep the operator informed while Vercel negotiates multipart tokens.
    const heartbeat = window.setInterval(() => {
      if(Date.now()-lastProgress>30000){
        setMessage(x=>({...x,[segment]:"Noch keine Datenübertragung bestätigt. Bitte Internetverbindung und Browser-Netzwerk prüfen. Nicht erneut starten, solange dieser Upload läuft."}));
      }
    },5000);
    try {
      setStage(x=>({...x,[segment]:"Prüfe Anmeldung und Blob-Speicher …"}));
      const check=await Promise.race([
        fetch("/api/admin/loom-video-upload",{
          method:"POST",headers:{"content-type":"application/json"},
          credentials:"same-origin",body:JSON.stringify({action:"diagnose"})
        }),
        new Promise<never>((_,reject)=>window.setTimeout(()=>reject(new Error("Verbindungstest nach 15 Sekunden ohne Antwort. Browser-Konsole oder Netzwerksperre prüfen.")),15000))
      ]);
      const diagnostic=await check.json() as {ok?:boolean;error?:string};
      if(!check.ok||!diagnostic.ok) throw new Error(diagnostic.error||`Verbindungstest fehlgeschlagen (HTTP ${check.status})`);
      lastProgress=Date.now();
      setStage(x=>({...x,[segment]:"Blob-Upload wird initialisiert …"}));
      setMessage(x=>({...x,[segment]:"Verbindung bestätigt ✓  Der Upload wird jetzt gestartet."}));
      const watchdog=window.setTimeout(()=>{
        if(lastProgress && Date.now()-lastProgress>70000) controller.abort();
      },70000);
      let blob: Awaited<ReturnType<typeof upload>>;
      try {
        blob=await upload(`loom-videos/${segment}.mp4`,file,{
        access:"public",
        handleUploadUrl:"/api/admin/loom-video-upload",
        multipart:true,
        contentType:"video/mp4",
        abortSignal:controller.signal,
        clientPayload:segment,
        onUploadProgress:({loaded,total,percentage})=>{
          lastProgress=Date.now();
          setStage(x=>({...x,[segment]:"Daten werden übertragen"}));
          setPct(x=>({...x,[segment]:Math.round(percentage)}));
          setMessage(x=>({...x,[segment]:`Hochladen: ${(loaded/1048576).toFixed(1)} von ${(total/1048576).toFixed(1)} MB · ${Math.round(percentage)} %`}));
        },
      });
      } finally {window.clearTimeout(watchdog);}
      setStage(x=>({...x,[segment]:"Prüfe Speicherung"}));
      setPct(x=>({...x,[segment]:100}));
      setMessage(x=>({...x,[segment]:"100 % übertragen. Video wird geprüft und aktiviert …"}));
      const response=await fetch("/api/admin/loom-video-upload",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"activate",segment,url:blob.url})
      });
      const result=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||"Datei übertragen, aber Aktivierung fehlgeschlagen.");
      await refresh();
      setStage(x=>({...x,[segment]:"Fertig"}));
      setMessage(x=>({...x,[segment]:"✓ Video aktiv – persönliche Links benutzen jetzt die neue MP4."}));
    } catch(error) {
      setStage(x=>({...x,[segment]:"Fehler"}));
      setMessage(x=>({...x,[segment]:controller.signal.aborted?"Upload nach 70 Sekunden ohne Fortschritt beendet. Keine MP4 wurde aktiviert.":error instanceof Error?error.message:"Upload fehlgeschlagen"}));
    } finally {
      window.clearInterval(heartbeat);
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
    <section style={{marginTop:22,padding:18,border:"1px solid #345847",borderRadius:12}}>
      <button type="button" onClick={()=>void testUpload()} disabled={probeBusy||Object.values(busy).some(Boolean)}
        style={{background:"#5eeaa0",color:"#07180d",padding:"13px 18px",borderRadius:9,border:0,fontWeight:800,cursor:"pointer"}}>
        {probeBusy?"Verbindung wird geprüft …":"Nur Verbindung testen (8 KB)"}
      </button>
      <p role="status" style={{fontSize:13,color:"#d3eada",overflowWrap:"anywhere"}}>{probeStatus||"Kein großer Video-Upload erforderlich."}</p>
    </section>
    <div style={{display:"grid",gap:18,marginTop:28}}>
      {roles.map(({key,title})=><section key={key} style={{border:"1px solid #345847",borderRadius:16,padding:22,background:"#122219"}}>
        <h2 style={{fontSize:20,marginTop:0}}>{title}</h2>
        <p style={{color:urls[key]?"#72f0ab":"#ffc38e",fontSize:13}}>
          {urls[key]?"MP4 aktiv – neue personalisierte Videoseiten verwenden diese Datei.":"Noch keine MP4 aktiv – derzeit läuft die alte YouTube-Variante."}
        </p>
        <input aria-label={title} type="file" accept="video/mp4,.mp4" disabled={Boolean(busy[key])}
          onChange={event=>{void uploadFile(key,event.target.files?.[0]);}} />
        {busy[key]&&<div style={{marginTop:14}}>
          <progress value={pct[key]||0} max={100} style={{display:"block",width:"100%",height:16,accentColor:"#34c759"}}/>
          <strong style={{fontSize:14,color:"#72f0ab"}}>{pct[key]||0} %</strong>
          <strong style={{fontSize:12,marginLeft:12,color:"#72f0ab"}}>{stage[key]||"Upload vorbereiten"}</strong>
          <span style={{fontSize:12,marginLeft:12,color:"#a7bdaf"}}>{!pct[key] ? "Verbindung wird hergestellt – noch kein Uploadfortschritt bestätigt." : "Übertragung läuft."}</span>
        </div>}
        <p role="status" style={{fontSize:13,overflowWrap:"anywhere",color:"#b5cbbd"}}>{message[key] || ""}</p>
        {urls[key]&&<a href={urls[key]} target="_blank" rel="noopener noreferrer" style={{color:"#72f0ab",fontSize:13}}>Videodatei prüfen ↗</a>}
      </section>)}
    </div>
    <p style={{color:"#a7bdaf",fontSize:13,marginTop:20}}>
      Nach dem Upload auf „<a href="/v/demo?segment=pv" style={{color:"#72f0ab"}}>PV testen</a>“ oder „<a href="/v/demo?segment=pflege" style={{color:"#72f0ab"}}>Pflege testen</a>“ klicken.
    </p>
  </main>;
}
