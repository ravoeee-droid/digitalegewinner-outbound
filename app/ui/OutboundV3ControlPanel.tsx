"use client";

import { useCallback, useEffect, useState } from "react";

type RuntimeMode="off"|"shadow"|"active";
type ControlSnapshot={
  resolved:{
    v3Mode:RuntimeMode;
    complianceMode:"off"|"shadow"|"enforce";
    autonomyLevel:number;
    durableWorkflowsMode:RuntimeMode;
    source:string;
    version:number|null;
  };
  stored:{
    v3Mode:RuntimeMode;
    complianceMode:"off"|"shadow"|"enforce";
    autonomyLevel:number;
    durableWorkflowsMode:RuntimeMode;
    version:number;
    updatedBy:string;
    updatedAt:string;
  }|null;
  schema:{expectedTables:number;presentTables:number;ready:boolean};
  capabilities:{
    schemaFoundation:boolean;
    shadowEventLedger:boolean;
    nativeV3Execution:boolean;
    complianceEnforcement:boolean;
    durableWorkflowExecution:boolean;
    conversationAutopilot:boolean;
    optimizationAutopilot:boolean;
  };
  parity:{
    window:string;
    sends:{legacy:number;v3:number};
    replies:{legacy:number;v3:number};
    bounces:{legacy:number;v3:number};
  };
  complianceShadow:{
    window:string;
    evaluated:number;
    allowed:number;
    denied:number;
    reasons:Record<string,number>;
  };
  environmentOverrides:{
    v3Mode:boolean;
    complianceMode:boolean;
    autonomyLevel:boolean;
    durableWorkflowsMode:boolean;
    emergencyKillSwitch:boolean;
  };
};

export default function OutboundV3ControlPanel(){
  const [snapshot,setSnapshot]=useState<ControlSnapshot|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");

  const load=useCallback(async()=>{
    setError("");
    try{
      const response=await fetch("/api/outbound/v3/control",{cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw new Error(data?.error||"V3 Control Plane konnte nicht geladen werden.");
      setSnapshot(data as ControlSnapshot);
    }catch(err){
      setError(err instanceof Error?err.message:"V3 Control Plane konnte nicht geladen werden.");
    }
  },[]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{void load()},0);
    return()=>window.clearTimeout(timer);
  },[load]);

  async function update(body:Record<string,unknown>){
    if(!snapshot?.stored)return;
    setBusy(true);setError("");setNotice("");
    try{
      const response=await fetch("/api/outbound/v3/control",{
        method:"PUT",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({expectedVersion:snapshot.stored.version,...body}),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(
        Array.isArray(data?.blockers)?data.blockers.join(" "):data?.error||"Runtime-Änderung fehlgeschlagen."
      );
      setNotice("Runtime-Konfiguration aktualisiert.");
      await load();
    }catch(err){
      setError(err instanceof Error?err.message:"Runtime-Änderung fehlgeschlagen.");
      await load();
    }finally{setBusy(false)}
  }

  const envPinned=snapshot?Object.entries(snapshot.environmentOverrides).some(([key,value])=>key!=="emergencyKillSwitch"&&value):false;
  const shadow=snapshot?.resolved.v3Mode==="shadow";
  const parityRows=[
    ["Provider accepted",snapshot?.parity.sends],
    ["Replies",snapshot?.parity.replies],
    ["Bounces",snapshot?.parity.bounces],
  ] as const;

  return (
    <section style={{maxWidth:1540,margin:"0 auto 18px",padding:"0 28px"}}>
      <div style={{
        border:"1px solid rgba(94,234,160,.17)",
        background:"linear-gradient(145deg,rgba(16,25,21,.88),rgba(7,11,9,.92))",
        borderRadius:24,
        padding:20,
        boxShadow:"inset 0 1px 0 rgba(255,255,255,.04),0 24px 80px rgba(0,0,0,.2)",
      }}>
        <div style={{display:"flex",justifyContent:"space-between",gap:18,alignItems:"flex-start",flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:10,fontWeight:900,letterSpacing:".13em",color:"#5eeaa0"}}>OUTBOUND OS V3 · CONTROL PLANE</div>
            <h2 style={{fontSize:25,letterSpacing:"-.035em",margin:"7px 0 6px"}}>Zero-Downtime Migration</h2>
            <p style={{margin:0,color:"#8f9b94",fontSize:12,lineHeight:1.55,maxWidth:760}}>
              Legacy bleibt die Versand-Quelle, bis V3 im Shadow-Betrieb Event-Parität nachweist. Aktive Cutover-Modi sind bis zum jeweiligen Quality Gate technisch gesperrt.
            </p>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <ModeBadge label="V3" value={snapshot?.resolved.v3Mode||"…"} />
            <ModeBadge label="Compliance" value={snapshot?.resolved.complianceMode||"…"} />
            <ModeBadge label="AI" value={snapshot?("L"+snapshot.resolved.autonomyLevel):"…"} />
            <ModeBadge label="Workflows" value={snapshot?.resolved.durableWorkflowsMode||"…"} />
          </div>
        </div>

        {error&&<div style={alertStyle("error")}>{error}</div>}
        {notice&&<div style={alertStyle("ok")}>{notice}</div>}
        {snapshot?.environmentOverrides.emergencyKillSwitch&&
          <div style={alertStyle("error")}>Emergency Kill-Switch ist aktiv. V3 bleibt unabhängig von DB-Einstellungen ausgeschaltet.</div>}
        {envPinned&&
          <div style={alertStyle("warn")}>Mindestens ein Runtime-Modus ist per Environment gepinnt und überschreibt die Control-Plane-Datenbank.</div>}

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10,marginTop:18}}>
          <Card title="Schema">
            <strong style={metricStyle}>{snapshot?(snapshot.schema.presentTables+"/"+snapshot.schema.expectedTables):"—"}</strong>
            <span style={subStyle}>{snapshot?.schema.ready?"Foundation bereit":"Schema unvollständig"}</span>
          </Card>
          <Card title="Migration">
            <strong style={metricStyle}>{shadow?"SHADOW":snapshot?.resolved.v3Mode.toUpperCase()||"—"}</strong>
            <span style={subStyle}>Quelle: {snapshot?.resolved.source||"…"}</span>
          </Card>
          <Card title="Autopilot">
            <strong style={metricStyle}>{snapshot?("LEVEL "+snapshot.resolved.autonomyLevel):"—"}</strong>
            <span style={subStyle}>L2 = Safety Autopilot</span>
          </Card>
          <Card title="Native V3 Sender">
            <strong style={metricStyle}>{snapshot?.capabilities.nativeV3Execution?"READY":"LOCKED"}</strong>
            <span style={subStyle}>Cutover erst nach Shadow-Parität</span>
          </Card>
          <Card title="Permission Gate">
            <strong style={metricStyle}>{snapshot?snapshot.complianceShadow.evaluated:"—"}</strong>
            <span style={subStyle}>
              {snapshot?(snapshot.complianceShadow.allowed+" allow · "+snapshot.complianceShadow.denied+" deny"):"24h Shadow-Auswertung"}
            </span>
          </Card>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"minmax(0,1.35fr) minmax(280px,.65fr)",gap:12,marginTop:12}}>
          <div style={{border:"1px solid rgba(255,255,255,.07)",borderRadius:16,overflow:"hidden"}}>
            <div style={{padding:"11px 13px",fontSize:10,fontWeight:850,letterSpacing:".1em",color:"#849088",borderBottom:"1px solid rgba(255,255,255,.06)"}}>24H EVENT PARITY</div>
            {parityRows.map(([label,data])=>(
              <div key={label} style={{display:"grid",gridTemplateColumns:"1fr 90px 90px 90px",gap:8,padding:"10px 13px",borderBottom:"1px solid rgba(255,255,255,.045)",fontSize:11,alignItems:"center"}}>
                <span style={{color:"#c2cbc6"}}>{label}</span>
                <span style={{color:"#7f8c85"}}>Legacy {data?.legacy??"—"}</span>
                <span style={{color:"#7f8c85"}}>V3 {data?.v3??"—"}</span>
                <b style={{color:data&&data.legacy===data.v3?"#84f5c8":"#f2d98c",textAlign:"right"}}>
                  {data?data.legacy===data.v3?"MATCH":"LEARNING":"—"}
                </b>
              </div>
            ))}
          </div>

          <div style={{border:"1px solid rgba(255,255,255,.07)",borderRadius:16,padding:14}}>
            <div style={{fontSize:10,fontWeight:850,letterSpacing:".1em",color:"#849088"}}>SAFE ACTIONS</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
              <button
                disabled={busy||!snapshot?.schema.ready||shadow||envPinned}
                onClick={()=>void update({
                  v3Mode:"shadow",
                  complianceMode:"shadow",
                  autonomyLevel:2,
                  durableWorkflowsMode:"off",
                  reason:"Start production shadow telemetry for Outbound OS V3",
                })}
                style={actionStyle(true)}
              >
                ▶ Shadow starten
              </button>
              <button
                disabled={busy||snapshot?.resolved.v3Mode==="off"||envPinned}
                onClick={()=>void update({
                  v3Mode:"off",
                  complianceMode:"off",
                  autonomyLevel:2,
                  durableWorkflowsMode:"off",
                  reason:"Pause V3 shadow telemetry and keep legacy canonical",
                })}
                style={actionStyle(false)}
              >
                ■ V3 pausieren
              </button>
              <button disabled style={actionStyle(false)}>Active Cutover · gesperrt</button>
            </div>
            <p style={{...subStyle,marginTop:12}}>
              Einstellungen werden optimistisch versioniert. Paralleländerungen erzeugen einen Conflict statt still überschrieben zu werden.
            </p>
            {snapshot&&snapshot.complianceShadow.denied>0&&
              <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid rgba(255,255,255,.06)",fontSize:9,color:"#89958e",lineHeight:1.6}}>
                Deny-Gründe: {Object.entries(snapshot.complianceShadow.reasons).map(([reason,count])=>reason+" "+count).join(" · ")}
              </div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function ModeBadge({label,value}:{label:string;value:string}){
  const active=value==="shadow"||value==="active"||value==="enforce"||value==="L2";
  return <span style={{padding:"7px 9px",borderRadius:999,border:"1px solid rgba(255,255,255,.08)",background:active?"rgba(52,199,89,.09)":"rgba(255,255,255,.035)",fontSize:9,color:active?"#84f5c8":"#8f9b94",fontWeight:850}}>
    {label}: {value.toUpperCase()}
  </span>;
}

function Card({title,children}:{title:string;children:React.ReactNode}){
  return <div style={{padding:14,borderRadius:16,border:"1px solid rgba(255,255,255,.07)",background:"rgba(255,255,255,.025)"}}>
    <div style={{fontSize:9,fontWeight:850,letterSpacing:".1em",color:"#77837d"}}>{title.toUpperCase()}</div>
    <div style={{marginTop:7,display:"flex",flexDirection:"column",gap:3}}>{children}</div>
  </div>;
}

const metricStyle:React.CSSProperties={fontSize:18,color:"#eef4f0",letterSpacing:"-.025em"};
const subStyle:React.CSSProperties={fontSize:10,color:"#718078",lineHeight:1.45};
function alertStyle(kind:"error"|"warn"|"ok"):React.CSSProperties{
  const map={
    error:{border:"rgba(255,110,110,.25)",bg:"rgba(255,80,80,.07)",text:"#ffb3b3"},
    warn:{border:"rgba(242,217,140,.24)",bg:"rgba(242,217,140,.06)",text:"#f2d98c"},
    ok:{border:"rgba(94,234,160,.22)",bg:"rgba(52,199,89,.06)",text:"#84f5c8"},
  }[kind];
  return {marginTop:14,padding:"10px 12px",borderRadius:12,border:"1px solid "+map.border,background:map.bg,color:map.text,fontSize:11};
}
function actionStyle(primary:boolean):React.CSSProperties{
  return {border:primary?"1px solid rgba(94,234,160,.25)":"1px solid rgba(255,255,255,.1)",background:primary?"rgba(52,199,89,.1)":"rgba(255,255,255,.04)",color:primary?"#84f5c8":"#aeb9b3",padding:"9px 11px",borderRadius:10,fontSize:10,fontWeight:850,cursor:"pointer"};
}
