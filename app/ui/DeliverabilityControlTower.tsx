"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type HealthStatus="healthy"|"watch"|"degraded"|"paused";
type HealthRow={
  target_type:"mailbox"|"domain";
  target_id:string;
  domain:string|null;
  health_status:HealthStatus;
  health_score:number;
  base_daily_limit:number|null;
  recommended_daily_limit:number|null;
  enforced_daily_limit:number|null;
  last_action:string|null;
  last_reason:string|null;
  reasons:string[];
  metrics:Record<string,unknown>;
  observed_at:string;
};
type Snapshot={
  resolved:{deliverabilityMode:"off"|"shadow"|"enforce";autonomyLevel:number};
  stored:{deliverabilityMode:"off"|"shadow"|"enforce";version:number}|null;
  capabilities:{deliverabilityShadow:boolean;deliverabilityEnforcement:boolean};
  deliverability:{
    mode:"off"|"shadow"|"enforce";
    summary:{healthy:number;watch:number;degraded:number;paused:number};
    domains:HealthRow[];
    mailboxes:HealthRow[];
  };
  environmentOverrides:{deliverabilityMode:boolean;emergencyKillSwitch:boolean};
};

export default function DeliverabilityControlTower(){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");

  const load=useCallback(async()=>{
    try{
      setError("");
      const response=await fetch("/api/outbound/v3/control",{cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw new Error(data?.error||"Deliverability-Daten konnten nicht geladen werden.");
      setSnapshot(data as Snapshot);
    }catch(err){setError(err instanceof Error?err.message:"Deliverability-Daten konnten nicht geladen werden.")}
  },[]);

  useEffect(()=>{
    const first=window.setTimeout(()=>void load(),0);
    const timer=window.setInterval(()=>void load(),60_000);
    return()=>{window.clearTimeout(first);window.clearInterval(timer)};
  },[load]);

  async function runHealthCheck(){
    setBusy(true);setError("");setMessage("");
    try{
      const response=await fetch("/api/outbound/v3/deliverability/check",{method:"POST"});
      const data=await response.json();
      if(!response.ok)throw new Error(data?.error||"Health Check fehlgeschlagen.");
      setMessage("Health Check abgeschlossen.");
      await load();
    }catch(err){setError(err instanceof Error?err.message:"Health Check fehlgeschlagen.")}
    finally{setBusy(false)}
  }

  async function setMode(mode:"off"|"shadow"|"enforce"){
    if(!snapshot?.stored)return;
    setBusy(true);setError("");setMessage("");
    try{
      const response=await fetch("/api/outbound/v3/control",{
        method:"PUT",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({
          expectedVersion:snapshot.stored.version,
          deliverabilityMode:mode,
          reason:`Set deliverability control tower to ${mode}`,
        }),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(Array.isArray(data?.blockers)?data.blockers.join(" "):data?.error||"Modus konnte nicht geändert werden.");
      setMessage("Deliverability-Modus aktualisiert.");
      await load();
    }catch(err){setError(err instanceof Error?err.message:"Modus konnte nicht geändert werden.")}
    finally{setBusy(false)}
  }

  const staleCount=useMemo(()=>{
    if(!snapshot)return 0;
    const rows=[...snapshot.deliverability.domains,...snapshot.deliverability.mailboxes];
    // eslint-disable-next-line react-hooks/purity -- Anzeige des Alters, bewusst aktuelle Zeit
    return rows.filter(row=>Date.now()-new Date(row.observed_at).getTime()>3*60*60*1000).length;
  },[snapshot]);

  const envPinned=Boolean(snapshot?.environmentOverrides.deliverabilityMode);
  const mode=snapshot?.resolved.deliverabilityMode||"off";

  return (
    <section style={{maxWidth:1540,margin:"0 auto 18px",padding:"0 28px"}}>
      <div style={{border:"1px solid rgba(255,255,255,.08)",background:"rgba(8,13,10,.92)",borderRadius:24,padding:20}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:10,fontWeight:900,letterSpacing:".13em",color:"#8be9b2"}}>M3 · DELIVERABILITY CONTROL TOWER</div>
            <h2 style={{fontSize:25,letterSpacing:"-.035em",margin:"7px 0 6px"}}>Sender Health & Adaptive Capacity</h2>
            <p style={{margin:0,color:"#89958e",fontSize:12,lineHeight:1.55,maxWidth:820}}>
              Domain-Authentifizierung, SMTP/IMAP-Erreichbarkeit, Bounces, Deferrals und Complaints werden getrennt bewertet.
              Im Enforce-Modus wird die effektive Tageskapazität automatisch reduziert oder pausiert.
            </p>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <Badge label="Mode" value={mode.toUpperCase()} emphasis={mode==="enforce"} />
            <Badge label="AI" value={snapshot?("L"+snapshot.resolved.autonomyLevel):"—"} emphasis />
            <Badge label="Stale" value={String(staleCount)} emphasis={staleCount>0} />
          </div>
        </div>

        {error&&<Notice kind="error">{error}</Notice>}
        {message&&<Notice kind="ok">{message}</Notice>}
        {snapshot?.environmentOverrides.emergencyKillSwitch&&<Notice kind="error">Emergency Kill-Switch aktiv.</Notice>}
        {envPinned&&<Notice kind="warn">Deliverability-Modus ist per Environment gepinnt und überschreibt die Control Plane.</Notice>}

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10,marginTop:18}}>
          <Stat title="Healthy" value={snapshot?.deliverability.summary.healthy??0} />
          <Stat title="Watch" value={snapshot?.deliverability.summary.watch??0} />
          <Stat title="Degraded" value={snapshot?.deliverability.summary.degraded??0} />
          <Stat title="Paused" value={snapshot?.deliverability.summary.paused??0} />
        </div>

        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>
          <button disabled={busy} onClick={()=>void runHealthCheck()} style={buttonStyle(true)}>↻ Jetzt prüfen</button>
          <button disabled={busy||envPinned||mode==="shadow"} onClick={()=>void setMode("shadow")} style={buttonStyle(false)}>Shadow</button>
          <button
            disabled={busy||envPinned||!snapshot?.capabilities.deliverabilityEnforcement||snapshot.deliverability.mailboxes.length===0||staleCount>0||mode==="enforce"}
            onClick={()=>void setMode("enforce")}
            style={buttonStyle(true)}
          >
            Safety Enforce
          </button>
          <button disabled={busy||envPinned||mode==="off"} onClick={()=>void setMode("off")} style={buttonStyle(false)}>Off</button>
        </div>

        <HealthTable title="Domains" rows={snapshot?.deliverability.domains||[]} />
        <HealthTable title="Mailboxes" rows={snapshot?.deliverability.mailboxes||[]} />
      </div>
    </section>
  );
}

function HealthTable({title,rows}:{title:string;rows:HealthRow[]}){
  return (
    <div style={{marginTop:14,border:"1px solid rgba(255,255,255,.07)",borderRadius:16,overflow:"hidden"}}>
      <div style={{padding:"11px 13px",fontSize:10,fontWeight:850,letterSpacing:".1em",color:"#849088",borderBottom:"1px solid rgba(255,255,255,.06)"}}>{title.toUpperCase()}</div>
      {rows.length===0
        ? <div style={{padding:14,color:"#6f7b75",fontSize:11}}>Noch kein Health-Snapshot. „Jetzt prüfen“ startet den ersten Lauf.</div>
        : rows.map(row=><HealthRowView key={row.target_type+row.target_id} row={row}/>)}
    </div>
  );
}

function HealthRowView({row}:{row:HealthRow}){
  const rates=row.metrics||{};
  // eslint-disable-next-line react-hooks/purity -- Anzeige des Alters, bewusst aktuelle Zeit
  const ageMinutes=Math.max(0,Math.round((Date.now()-new Date(row.observed_at).getTime())/60000));
  return (
    <div style={{display:"grid",gridTemplateColumns:"minmax(180px,1.4fr) 90px 110px 160px minmax(180px,1fr)",gap:10,padding:"11px 13px",borderBottom:"1px solid rgba(255,255,255,.045)",alignItems:"center",fontSize:10}}>
      <div>
        <div style={{fontWeight:800,color:"#dce5df"}}>{row.target_id}</div>
        <div style={{color:"#68746d",marginTop:2}}>{row.domain||"—"} · vor {ageMinutes} min</div>
      </div>
      <span style={{fontWeight:900,color:statusColor(row.health_status)}}>{row.health_status.toUpperCase()}</span>
      <span style={{color:"#a8b3ad"}}>Score {row.health_score}</span>
      <span style={{color:"#8d9992"}}>
        {row.base_daily_limit??"—"} → {row.recommended_daily_limit??"—"} → {row.enforced_daily_limit??"—"}/Tag
      </span>
      <div style={{color:"#78857e",lineHeight:1.45}}>
        {row.reasons?.length?row.reasons.join(" · "):"keine Warnung"}
        {typeof rates["bounceRate"]==="number"&&<span> · Bounce {(Number(rates["bounceRate"])*100).toFixed(1)}%</span>}
      </div>
    </div>
  );
}

function Stat({title,value}:{title:string;value:number}){
  return <div style={{padding:13,borderRadius:14,border:"1px solid rgba(255,255,255,.07)",background:"rgba(255,255,255,.025)"}}>
    <div style={{fontSize:9,fontWeight:850,letterSpacing:".1em",color:"#6f7b75"}}>{title.toUpperCase()}</div>
    <div style={{fontSize:20,fontWeight:900,marginTop:5,color:"#e8efeb"}}>{value}</div>
  </div>;
}
function Badge({label,value,emphasis=false}:{label:string;value:string;emphasis?:boolean}){
  return <span style={{padding:"7px 9px",borderRadius:999,border:"1px solid rgba(255,255,255,.08)",background:emphasis?"rgba(52,199,89,.09)":"rgba(255,255,255,.035)",fontSize:9,color:emphasis?"#8be9b2":"#89958e",fontWeight:850}}>{label}: {value}</span>;
}
function Notice({kind,children}:{kind:"error"|"warn"|"ok";children:React.ReactNode}){
  const cfg=kind==="error"?["rgba(255,80,80,.08)","#ffb3b3"]:kind==="warn"?["rgba(242,217,140,.07)","#f2d98c"]:["rgba(52,199,89,.07)","#8be9b2"];
  return <div style={{marginTop:12,padding:"9px 11px",borderRadius:10,background:cfg[0],color:cfg[1],fontSize:10}}>{children}</div>;
}
function buttonStyle(primary:boolean):React.CSSProperties{
  return {border:primary?"1px solid rgba(94,234,160,.25)":"1px solid rgba(255,255,255,.1)",background:primary?"rgba(52,199,89,.1)":"rgba(255,255,255,.04)",color:primary?"#8be9b2":"#aab5af",padding:"9px 11px",borderRadius:10,fontSize:10,fontWeight:850,cursor:"pointer"};
}
function statusColor(status:HealthStatus){
  if(status==="healthy")return "#8be9b2";
  if(status==="watch")return "#f2d98c";
  if(status==="degraded")return "#ffbd75";
  return "#ff9292";
}
