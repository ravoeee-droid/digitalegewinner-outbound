"use client";
import { useState } from "react";
const modes = [
["reel","Reel-Skript"],["viral-analysis","Viral-Analyse"],["carousel","Carousel"],["caption","Caption"],
["story","Story"],["weekly-plan","Wochenplan"],["profile-audit","Profil-Audit"],
["comment","Kommentar"],["reply","Antworten"],["dm","DM-Sequenz"],["repurpose","Wiederverwertung"],
["post-audit","Post-Audit"],["humanize","Humanizer"]
];
export default function ContentIntelligencePage() {
 const [kind,setKind]=useState("reel"),[industry,setIndustry]=useState("Pflege"),[brief,setBrief]=useState(""),[voice,setVoice]=useState("Direkt, persönlich, konkret, unaufgeregt. Keine KI-Floskeln; Raphael erklärt praxisnah Probleme und Lösungen.");
 const [result,setResult]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 async function generate() {
  setBusy(true);setError("");setResult("");
  try {
   const res=await fetch("/api/content-intelligence",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind,industry,brief,voice})});
   const data=await res.json();if(!res.ok)throw new Error(data.error||"Fehlgeschlagen");setResult(data.draft);
  } catch(e){setError(e instanceof Error?e.message:"Fehler");}finally{setBusy(false);}
 }
 return <main style={{maxWidth:1000,margin:"30px auto",padding:24,fontFamily:"system-ui",color:"#e9f1ff",background:"#101a2a",borderRadius:20,minHeight:"80vh"}}>
  <a href="/heute" style={{color:"#8bc6ff"}}>← Zurück zum Cockpit</a>
  <h1 style={{fontSize:34,marginBottom:4}}>DG Content Intelligence</h1>
  <p style={{color:"#b2c0d4"}}>13 KI-Werkzeuge für Instagram, LinkedIn und B2B-Vertrieb. Alles bleibt bis zur Freigabe ein Entwurf.</p>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:14}}>
  <label>Werkzeug<select value={kind} onChange={e=>setKind(e.target.value)} style={field}>{modes.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
  <label>Zielgruppe<select value={industry} onChange={e=>setIndustry(e.target.value)} style={field}><option>Pflege</option><option>Photovoltaik / Handwerk</option><option>Personal Brand Raphael</option></select></label></div>
  <label style={{display:"block",marginTop:20}}>Thema, Ausgangsmaterial oder Reel-Zahlen<textarea value={brief} onChange={e=>setBrief(e.target.value)} rows={7} placeholder="Beispiel: PV-Leads werden an fünf Betriebe gleichzeitig verkauft. Reel: 35 Sekunden. Oder: 5 Reel-Links mit Views + Account-Durchschnitt einfügen." style={field}/></label>
  <label style={{display:"block",marginTop:15}}>Tonfall / Voice Guide<textarea rows={3} value={voice} onChange={e=>setVoice(e.target.value)} style={field}/></label>
  <button onClick={generate} disabled={!brief.trim()||busy} style={{padding:"13px 24px",borderRadius:12,background:"#47d9b0",color:"#0c1c20",border:0,fontWeight:700,cursor:"pointer",marginTop:16}}>{busy?"Erstelle Entwurf …":"Entwurf erstellen"}</button>
  {error&&<p role="alert" style={{color:"#ffa6a6"}}>{error}</p>}
  {result&&<section style={{marginTop:26,padding:23,border:"1px solid #3c5872",borderRadius:16,background:"#172539"}}><div style={{display:"flex",justifyContent:"space-between",gap:12}}><strong>Entwurf · nicht veröffentlicht</strong><button onClick={()=>navigator.clipboard.writeText(result)}>Kopieren</button></div><pre style={{whiteSpace:"pre-wrap",fontFamily:"inherit",lineHeight:1.7}}>{result}</pre></section>}
  <p style={{fontSize:13,color:"#9ab0c7",marginTop:22}}>Viral-Analysen beruhen ausschließlich auf eingegebenen Referenzen und Zahlen. Keine automatischen Instagram-Scrapes, Posts oder DMs.</p>
 </main>;
}
const field:React.CSSProperties={display:"block",width:"100%",marginTop:8,padding:12,background:"#23334a",color:"#fff",border:"1px solid #51627a",borderRadius:10,font:"inherit",boxSizing:"border-box"};
