"use client";
import {useCallback,useEffect,useState} from "react";
type Row={campaign_version_id:string;campaign_name:string;version:number;experiment_arm_key:string|null;exposed:number;meetings:number;opportunities:number;wins:number;revenue:number;revenuePer100:number};
type Fact={id:string;fact_type:string;company_name:string|null;occurred_at:string;amount:number|null;currency:string;campaign_version_id:string|null;experiment_arm_key:string|null;attribution_model:string;attribution_confidence:number};
type D={policyVersion:string;attributionWindowDays:number;summary:{facts:number;attributed:number;meetings:number;opportunities:number;wins:number;revenue:number};campaigns:Row[];recent:Fact[]};
export default function RevenueAttributionControlTower(){
 const[d,setD]=useState<D|null>(null),[busy,setBusy]=useState(false),[err,setErr]=useState("");
 const load=useCallback(async()=>{try{const r=await fetch("/api/outbound/v3/revenue",{cache:"no-store"});const j=await r.json();if(!r.ok)throw new Error(j?.error||"Load failed");setD(j)}catch(e){setErr(e instanceof Error?e.message:"Load failed")}},[]);
 useEffect(()=>{const t=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(t)},[load]);
 async function sync(){setBusy(true);setErr("");try{const r=await fetch("/api/outbound/v3/revenue",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"sync"})});const j=await r.json();if(!r.ok)throw new Error(j?.error||"Sync failed");await load()}catch(e){setErr(e instanceof Error?e.message:"Sync failed")}finally{setBusy(false)}}
 return <section style={{maxWidth:1540,margin:"0 auto 18px",padding:"0 28px"}}><div style={{border:"1px solid rgba(91,255,178,.16)",background:"rgba(7,14,10,.94)",borderRadius:24,padding:20}}>
  <div style={{display:"flex",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}><div><div style={{fontSize:10,fontWeight:900,letterSpacing:".12em",color:"#70f0ad"}}>M9 · REVENUE ATTRIBUTION</div><h2 style={{fontSize:24,margin:"7px 0 6px"}}>Campaign → Meeting → Opportunity → Revenue</h2><p style={{fontSize:12,color:"#89958e",margin:0,maxWidth:900}}>Conversions werden nur an eine beobachtete frühere Exposure attribuiert. Ohne passende Exposure bleibt ein Fact unattributed.</p></div><div style={{display:"flex",gap:6}}><span style={pill}>Window: {d?.attributionWindowDays||180}d</span><span style={pill}>Policy: {d?.policyVersion||"…"}</span></div></div>
  {err&&<div style={{fontSize:10,color:"#ffb3b3",marginTop:10}}>{err}</div>}
  <div style={stats}><Stat t="Facts" v={d?.summary.facts||0}/><Stat t="Attributed" v={d?.summary.attributed||0}/><Stat t="Meetings" v={d?.summary.meetings||0}/><Stat t="Wins" v={d?.summary.wins||0}/><Stat t="Revenue €" v={Math.round(d?.summary.revenue||0)}/></div>
  <button disabled={busy} style={{...btn,marginTop:14}} onClick={()=>void sync()}>Attribution synchronisieren</button>
  <div style={box}><div style={title}>REVENUE PRO CAMPAIGN / ARM</div>{(d?.campaigns||[]).length?(d?.campaigns||[]).map(r=><div key={r.campaign_version_id+String(r.experiment_arm_key)} style={{display:"grid",gridTemplateColumns:"1.6fr 70px 70px 70px 90px 110px",gap:8,padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,.05)",fontSize:9}}><span>{r.campaign_name} v{r.version}{r.experiment_arm_key?" · "+r.experiment_arm_key:""}</span><span>{r.exposed} exp.</span><span>{r.meetings} mtg</span><span>{r.wins} wins</span><span>{money(r.revenue)}</span><span>{money(r.revenuePer100)}/100</span></div>):<div style={sub}>Noch keine attribuierten Campaigns.</div>}</div>
  <div style={box}><div style={title}>LETZTE CONVERSION FACTS</div>{(d?.recent||[]).length?(d?.recent||[]).slice(0,30).map(f=><div key={f.id} style={row}><span>{f.fact_type} · {f.company_name||"—"}</span><span style={sub}>{f.amount!==null?money(f.amount)+" "+f.currency+" · ":""}{f.campaign_version_id?"ATTRIBUTED":"UNATTRIBUTED"} · {Math.round(f.attribution_confidence*100)}%</span></div>):<div style={sub}>Noch keine Conversion Facts.</div>}</div>
 </div></section>
}
const pill:React.CSSProperties={fontSize:9,padding:"7px 9px",border:"1px solid rgba(255,255,255,.08)",borderRadius:999,color:"#aab7b0"};
const stats:React.CSSProperties={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginTop:18};
const row:React.CSSProperties={display:"flex",justifyContent:"space-between",gap:12,padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,.05)",fontSize:10};
const sub:React.CSSProperties={fontSize:9,color:"#7f8b84",lineHeight:1.45,marginTop:3};
const box:React.CSSProperties={marginTop:12,border:"1px solid rgba(255,255,255,.07)",borderRadius:14,padding:12,overflowX:"auto"};
const title:React.CSSProperties={fontSize:9,fontWeight:900,color:"#78847d",marginBottom:6};
const btn:React.CSSProperties={border:"1px solid rgba(91,255,178,.2)",background:"rgba(91,255,178,.08)",color:"#8fffc0",borderRadius:9,padding:"8px 10px",fontSize:9,fontWeight:850,cursor:"pointer"};
function Stat({t,v}:{t:string;v:number}){return <div style={{padding:12,border:"1px solid rgba(255,255,255,.06)",borderRadius:12}}><div style={sub}>{t.toUpperCase()}</div><div style={{fontSize:20,fontWeight:900}}>{v}</div></div>}
function money(v:number){return new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(Number(v||0))}
