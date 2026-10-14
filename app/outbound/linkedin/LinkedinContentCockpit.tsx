"use client";
import { useCallback, useEffect, useState } from "react";

type Post = { id:string; text:string; scheduled_at:string|null; status:string; error:string|null; post_urn:string|null };
type Data = { posts:Post[]; connected:boolean; oauthConfigured:boolean; tokenExpiresAt:string|null; error?:string };
const panel={background:"#102119",border:"1px solid #30523d",borderRadius:16,padding:22} as const;
const button={background:"#68e8a7",color:"#092317",border:0,borderRadius:9,padding:"12px 17px",fontWeight:800,cursor:"pointer"} as const;

function toBerlinUTC(value:string) {
  if (!value) throw new Error("Datum und Uhrzeit auswählen.");
  const naive=new Date(value+":00Z").getTime();
  function offset(at:number){
    const part=new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Berlin",timeZoneName:"shortOffset"}).formatToParts(new Date(at)).find(x=>x.type==="timeZoneName")?.value||"GMT";
    const m=part.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
    return m?(m[1]==="-"?-1:1)*(Number(m[2])*60+Number(m[3]||0)):0;
  }
  let adjusted=naive-offset(naive)*60000;
  adjusted=naive-offset(adjusted)*60000;
  const date=new Date(adjusted);
  if(!Number.isFinite(date.getTime()))throw new Error("Ungültiger Termin.");
  return date.toISOString();
}
function german(iso:string|null) {
  if(!iso)return "Entwurf";
  return new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",dateStyle:"medium",timeStyle:"short"}).format(new Date(iso));
}
export default function LinkedinContentCockpit(){
  const [data,setData]=useState<Data|null>(null);
  const [text,setText]=useState("");
  const [date,setDate]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const reload=useCallback(async()=>{
    try{
      const r=await fetch("/api/linkedin/posts",{cache:"no-store"});
      const x=await r.json() as Data;
      if(!r.ok)throw new Error(x.error||"Fehler beim Laden");
      setData(x);
    }catch(e){setMessage(e instanceof Error?e.message:String(e))}
  },[]);
  useEffect(()=>{void reload()},[reload]);
  async function create(draft:boolean){
    setBusy(true);setMessage("");
    try{
      const r=await fetch("/api/linkedin/posts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text,scheduledAt:draft?null:toBerlinUTC(date)})});
      const x=await r.json() as {error?:string};
      if(!r.ok)throw new Error(x.error||"Speichern fehlgeschlagen");
      setText("");setDate("");setMessage(draft?"Entwurf gespeichert":"Beitrag eingeplant. Für die Veröffentlichung muss LinkedIn verbunden und Cron aktiv sein.");
      await reload();
    }catch(e){setMessage(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  async function cancel(id:string){
    if(!confirm("Beitrag wirklich stornieren?"))return;
    setBusy(true);setMessage("");
    try{
      const r=await fetch("/api/linkedin/posts",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id,action:"cancel"})});
      const x=await r.json() as {error?:string};
      if(!r.ok)throw new Error(x.error||"Stornierung fehlgeschlagen");
      setMessage("Beitrag storniert.");await reload();
    }catch(e){setMessage(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  const scheduled=data?.posts.filter(p=>p.status==="scheduled").length||0;
  const published=data?.posts.filter(p=>p.status==="published").length||0;
  return <main style={{minHeight:"100vh",background:"#07150e",color:"#ecfff3",padding:"clamp(18px,4vw,42px)",fontFamily:"system-ui"}}>
    <p style={{fontSize:12,letterSpacing:2,color:"#68e8a7",fontWeight:900}}>DG OUTBOUND / SOCIAL CONTENT</p>
    <h1 style={{fontSize:"clamp(28px,4vw,42px)",margin:"8px 0"}}>LinkedIn Content Cockpit</h1>
    <p style={{color:"#9dbfa9"}}>Dein Redaktionsplan – ohne externen Social-Media-Planer. Zeiten beziehen sich auf Deutschland.</p>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",margin:"20px 0"}}>
      <div style={panel}>Geplant: <strong>{scheduled}</strong></div>
      <div style={panel}>Veröffentlicht: <strong>{published}</strong></div>
      <div style={panel}>Status: <strong>{data?.connected?"LinkedIn verbunden":"Nicht verbunden"}</strong></div>
    </div>
    <div style={{...panel,display:"flex",justifyContent:"space-between",alignItems:"center",gap:15,flexWrap:"wrap",marginBottom:18}}>
      <div><strong>{data?.connected?"● LinkedIn ist autorisiert":"○ LinkedIn-Verbindung fehlt"}</strong>
        <p style={{fontSize:12,color:"#9dbfa9"}}>{data?.connected?"Token gültig bis "+german(data.tokenExpiresAt):"Zur Aktivierung wird eine eigene LinkedIn-Developer-App benötigt."}</p></div>
      {data?.oauthConfigured?<a href="/api/linkedin/oauth/start" style={{...button,textDecoration:"none"}}>{data?.connected?"Erneut verbinden":"LinkedIn verbinden"}</a>:<small>Einrichtung: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, NEXT_PUBLIC_APP_URL</small>}
    </div>
    {message&&<p role="status" style={{...panel,color:"#ffd48e"}}>{message}</p>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,370px),1fr))",gap:18,alignItems:"start"}}>
      <section style={panel}>
        <h2>Beitrag erstellen</h2>
        <label htmlFor="li-post">Beitragstext</label>
        <textarea id="li-post" value={text} onChange={e=>setText(e.target.value)} maxLength={3000} rows={12}
          style={{display:"block",boxSizing:"border-box",width:"100%",margin:"10px 0",border:"1px solid #426e50",borderRadius:10,padding:14,background:"#08150d",color:"white"}} placeholder="Hook · konkrete Situation · Perspektivwechsel · Frage …"/>
        <small>{text.length}/3000 Zeichen</small>
        <label htmlFor="li-date" style={{display:"block",marginTop:22}}>Veröffentlichung (Deutschland, Europe/Berlin)</label>
        <input id="li-date" type="datetime-local" value={date} onChange={e=>setDate(e.target.value)}
          style={{display:"block",boxSizing:"border-box",width:"100%",margin:"10px 0",padding:12,background:"#08150d",color:"white",colorScheme:"dark",border:"1px solid #426e50",borderRadius:10}}/>
        <div style={{display:"flex",gap:12,marginTop:18,flexWrap:"wrap"}}>
          <button style={button} disabled={busy||!text.trim()||!date} onClick={()=>void create(false)}>Planen</button>
          <button style={{...button,background:"#29523b",color:"#d5ffe5"}} disabled={busy||!text.trim()} onClick={()=>void create(true)}>Entwurf</button>
        </div>
        <p style={{fontSize:12,color:"#94af9e",lineHeight:1.6}}>Die 56 bestehenden Metricool-Posts bleiben dort. Keine automatische Übernahme, damit wir nichts doppelt posten. Veröffentlichung nur mit gültigem OAuth-Token und aktiviertem Cron.</p>
      </section>
      <section style={panel}>
        <h2>Beitragsübersicht</h2>
        <div style={{maxHeight:750,overflowY:"auto",display:"grid",gap:12}}>
          {data?.posts.map(p=><article key={p.id} style={{background:"#08150d",padding:14,borderRadius:10,border:"1px solid #27412f"}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:8}}><strong>{p.status}</strong><small>{german(p.scheduled_at)}</small></div>
            <p style={{whiteSpace:"pre-wrap",fontSize:13,lineHeight:1.5,maxHeight:150,overflow:"auto"}}>{p.text}</p>
            {p.error&&<small style={{color:"#ffb580"}}>{p.error}</small>}
            {p.post_urn&&<small style={{display:"block",wordBreak:"break-all"}}>{p.post_urn}</small>}
            {["draft","scheduled","failed"].includes(p.status)&&<button disabled={busy} style={{...button,padding:8,fontSize:12,background:"#534035",color:"#ffebd8"}} onClick={()=>void cancel(p.id)}>Stornieren</button>}
          </article>)}
          {data?.posts.length===0&&<p>Noch keine DG-Beiträge. Du kannst mit einem Entwurf beginnen.</p>}
        </div>
        <button onClick={()=>void reload()} style={{...button,marginTop:18,background:"#29523b",color:"#d5ffe5"}}>Aktualisieren</button>
      </section>
    </div>
  </main>;
}
