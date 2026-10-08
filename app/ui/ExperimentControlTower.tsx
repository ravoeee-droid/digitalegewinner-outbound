"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Arm={
  experiment_id:string;
  arm_key:string;
  label:string;
  weight:number|string;
  status:"active"|"paused";
  exposed:string;
};
type Evaluation={
  id:string;
  status:"insufficient_data"|"monitoring"|"srm_warning"|"guardrail_risk"|"evidence_signal"|"no_clear_signal";
  totalExposed:number;
  srmPValue:number|string|null;
  primaryMetric:string;
  primaryResults:Record<string,{
    n:number;
    count:number|null;
    value:number;
    ci:{low:number;high:number}|null;
    label:string;
    weight:number;
    comparison?:{
      delta:number;
      improvement:number;
      pValue:number|null;
      adjustedAlpha:number;
      practical:boolean;
      statisticallySupported:boolean;
      supported:boolean;
    }|null;
  }>;
  guardrailResults:Record<string,Record<string,{
    n:number;
    count:number|null;
    value:number;
    pValue:number|null;
    risk:boolean;
  }>>;
  recommendation:{
    action:string;
    reviewArm:string|null;
    controlArm:string;
    noAutomaticWinner:boolean;
    rationale:string;
  };
  safetyAction:string|null;
  evaluatedAt:string;
};
type Experiment={
  id:string;
  experiment_key:string;
  version:number;
  status:"draft"|"review"|"running"|"paused"|"completed"|"archived";
  hypothesis:string;
  primary_metric:string;
  guardrail_metrics:string[];
  minimum_sample_per_arm:number;
  practical_effect_threshold:number|string;
  legacy_campaign_id:string|null;
  control_arm_key:string|null;
  safety_stop_enabled:boolean;
  paused_at:string|null;
  pause_reason:string|null;
  campaign_name:string;
  latest_evaluation:Evaluation|null;
  arms:Arm[];
};
type Dashboard={
  policyVersion:string;
  optimizationAutopilot:boolean;
  summary:{running:number;paused:number;evidence:number;safety:number};
  experiments:Experiment[];
};

const statusMeta:Record<string,{label:string;tone:string}>={
  insufficient_data:{label:"Noch keine Daten",tone:"#89939d"},
  monitoring:{label:"Sammelt Daten",tone:"#8edfff"},
  srm_warning:{label:"SRM Warnung",tone:"#ff9b9b"},
  guardrail_risk:{label:"Safety Risk",tone:"#ff9b9b"},
  evidence_signal:{label:"Evidenz zur Prüfung",tone:"#bffb84"},
  no_clear_signal:{label:"Kein klarer Effekt",tone:"#f2d98c"},
};

export default function ExperimentControlTower(){
  const [dashboard,setDashboard]=useState<Dashboard|null>(null);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [selected,setSelected]=useState<string|null>(null);

  const load=useCallback(async()=>{
    setError("");
    try{
      const response=await fetch("/api/outbound/v3/experiments",{cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw new Error(data?.error||"Experiment Dashboard konnte nicht geladen werden.");
      setDashboard(data as Dashboard);
      if(!selected&&data.experiments?.[0]?.id)setSelected(data.experiments[0].id);
    }catch(err){
      setError(err instanceof Error?err.message:"Experiment Dashboard konnte nicht geladen werden.");
    }
  },[selected]);

  useEffect(()=>{
    const first=window.setTimeout(()=>void load(),0);
    const timer=window.setInterval(()=>void load(),60_000);
    return()=>{window.clearTimeout(first);window.clearInterval(timer)};
  },[load]);

  async function post(payload:Record<string,unknown>,key:string){
    setBusy(key);setError("");setNotice("");
    try{
      const response=await fetch("/api/outbound/v3/experiments",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(payload),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data?.error||"Experiment-Aktion fehlgeschlagen.");
      setNotice("Experiment Engine aktualisiert.");
      await load();
    }catch(err){
      setError(err instanceof Error?err.message:"Experiment-Aktion fehlgeschlagen.");
    }finally{setBusy("")}
  }

  const current=useMemo(
    ()=>dashboard?.experiments.find(item=>item.id===selected)||dashboard?.experiments[0]||null,
    [dashboard,selected],
  );

  async function changeStatus(exp:Experiment,action:"pause"|"resume"|"complete"){
    const reason=window.prompt(
      action==="pause"?"Warum wird der Test pausiert?":action==="resume"?"Warum wird der Test wieder gestartet?":"Warum wird der Test abgeschlossen?",
      action==="pause"?"Manuelle Prüfung":"Manuell geprüft",
    );
    if(!reason)return;
    await post({action:"status",experimentId:exp.id,statusAction:action,reason},action+exp.id);
  }

  return (
    <section style={{maxWidth:1540,margin:"0 auto 18px",padding:"0 28px"}}>
      <div style={{border:"1px solid rgba(213,255,89,.16)",background:"linear-gradient(145deg,rgba(16,20,9,.93),rgba(8,10,8,.95))",borderRadius:24,padding:20}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:10,fontWeight:900,letterSpacing:".13em",color:"#d5ff59"}}>M6 · EXPERIMENT ENGINE</div>
            <h2 style={{fontSize:25,letterSpacing:"-.035em",margin:"7px 0 6px"}}>Company-Level A/B/n Testing</h2>
            <p style={{margin:0,color:"#939b89",fontSize:12,lineHeight:1.55,maxWidth:900}}>
              Deterministische Firmen-Zuweisung, echte Provider-Exposure, SRM-Checks, Guardrails und multiplicity-adjustierte Performance-Signale. Safety darf pausieren; Performance ändert niemals automatisch den Traffic.
            </p>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <Badge label="Autopilot" value={dashboard?.optimizationAutopilot?"ON":"LOCKED"} active={false}/>
            <Badge label="Policy" value={dashboard?.policyVersion||"…"}/>
          </div>
        </div>

        {error&&<Notice kind="error">{error}</Notice>}
        {notice&&<Notice kind="ok">{notice}</Notice>}

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10,marginTop:18}}>
          <Stat title="Running" value={dashboard?.summary.running??0}/>
          <Stat title="Paused" value={dashboard?.summary.paused??0}/>
          <Stat title="Evidenz" value={dashboard?.summary.evidence??0}/>
          <Stat title="Safety Alerts" value={dashboard?.summary.safety??0}/>
        </div>

        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>
          <button disabled={Boolean(busy)} onClick={()=>void post({action:"evaluate_all"},"all")} style={buttonStyle(true)}>↻ Alle Tests auswerten</button>
          <span style={{fontSize:9,color:"#798171",alignSelf:"center"}}>Automatische Auswertung: alle 15 Minuten · kein Auto-Winner</span>
        </div>

        {(dashboard?.experiments||[]).length===0
          ? <div style={{marginTop:14,padding:18,borderRadius:16,border:"1px solid rgba(255,255,255,.07)",background:"rgba(255,255,255,.02)",color:"#8f9786",fontSize:11,lineHeight:1.6}}>
              Noch kein Experiment vorhanden. Sobald eine Kampagne mindestens einen Schritt mit Varianten A/B oder A/B/C startet, legt M6 automatisch eine versionierte Experiment-Definition an. Eine bloße Zuweisung zählt noch nicht – erst die erste vom Provider akzeptierte Mail wird als Exposure gewertet.
            </div>
          : <div style={{display:"grid",gridTemplateColumns:"minmax(310px,.7fr) minmax(0,1.3fr)",gap:12,marginTop:14}}>
              <Panel title={"Experimente · "+dashboard!.experiments.length}>
                <div style={{maxHeight:560,overflow:"auto"}}>
                  {dashboard!.experiments.map(exp=>{
                    const ev=exp.latest_evaluation;
                    const meta=ev?statusMeta[ev.status]:null;
                    return <button key={exp.id} onClick={()=>setSelected(exp.id)} style={{
                      width:"100%",display:"block",textAlign:"left",border:"0",borderBottom:"1px solid rgba(255,255,255,.05)",
                      background:selected===exp.id?"rgba(213,255,89,.065)":"transparent",padding:"12px 8px",cursor:"pointer",color:"inherit",
                    }}>
                      <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                        <strong style={{fontSize:10,color:"#edf2e8"}}>{exp.campaign_name}</strong>
                        <span style={{fontSize:8,fontWeight:900,color:exp.status==="running"?"#bffb84":exp.status==="paused"?"#f2d98c":"#8e9587"}}>{exp.status.toUpperCase()}</span>
                      </div>
                      <div style={{fontSize:9,color:"#7d8577",marginTop:4}}>{exp.experiment_key} · v{exp.version}</div>
                      <div style={{fontSize:9,color:meta?.tone||"#7d8577",marginTop:5}}>{meta?.label||"Noch nicht ausgewertet"} · {ev?.totalExposed??0} Firmen</div>
                    </button>
                  })}
                </div>
              </Panel>

              <Panel title="Experiment Detail">
                {!current?<Empty text="Wähle links ein Experiment."/>:<ExperimentDetail exp={current} busy={busy} post={post} changeStatus={changeStatus}/>}
              </Panel>
            </div>
        }
      </div>
    </section>
  );
}

function ExperimentDetail({exp,busy,post,changeStatus}:{exp:Experiment;busy:string;post:(payload:Record<string,unknown>,key:string)=>Promise<void>;changeStatus:(exp:Experiment,action:"pause"|"resume"|"complete")=>Promise<void>}){
  const ev=exp.latest_evaluation;
  const primary=ev?.primaryResults||{};
  const guardrails=ev?.guardrailResults||{};
  const status=ev?statusMeta[ev.status]:null;
  return <>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
      <div>
        <strong style={{fontSize:14,color:"#edf2e8"}}>{exp.campaign_name}</strong>
        <div style={subStyle}>{exp.hypothesis}</div>
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        <Badge label="Primary" value={exp.primary_metric}/>
        <Badge label="Status" value={status?.label||exp.status} active={ev?.status==="evidence_signal"}/>
      </div>
    </div>

    {exp.pause_reason&&<Notice kind="warn">Pause-Grund: {exp.pause_reason}</Notice>}

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:8,marginTop:12}}>
      <Info title="Exposure" value={String(ev?.totalExposed??0)}/>
      <Info title="Min/Arm" value={String(exp.minimum_sample_per_arm)}/>
      <Info title="Practical Delta" value={formatPct(Number(exp.practical_effect_threshold))}/>
      <Info title="SRM p" value={ev?.srmPValue===null||ev?.srmPValue===undefined?"—":Number(ev.srmPValue).toFixed(5)}/>
    </div>

    <div style={{marginTop:12,border:"1px solid rgba(255,255,255,.06)",borderRadius:12,overflow:"hidden"}}>
      <div style={{display:"grid",gridTemplateColumns:"90px 70px 90px 1fr",gap:8,padding:"9px 10px",fontSize:8,fontWeight:900,color:"#737b6d",background:"rgba(255,255,255,.02)"}}>
        <span>ARM</span><span>N</span><span>{exp.primary_metric}</span><span>EVIDENCE</span>
      </div>
      {exp.arms.map(arm=>{
        const result=primary[arm.arm_key];
        const comparison=result?.comparison;
        return <div key={arm.arm_key} style={{display:"grid",gridTemplateColumns:"90px 70px 90px 1fr",gap:8,padding:"10px",fontSize:9,borderTop:"1px solid rgba(255,255,255,.045)",alignItems:"center"}}>
          <span style={{fontWeight:900,color:arm.arm_key===exp.control_arm_key?"#d5ff59":"#dce2d6"}}>{arm.arm_key}{arm.arm_key===exp.control_arm_key?" · CTRL":""}</span>
          <span style={{color:"#8b9384"}}>{result?.n??Number(arm.exposed||0)}</span>
          <span style={{color:"#c1c9ba"}}>{result?formatMetric(exp.primary_metric,result.value):"—"}</span>
          <span style={{color:comparison?.supported?"#bffb84":"#7f8779"}}>
            {comparison
              ? comparison.supported
                ? "Signal zur menschlichen Prüfung"
                : `Δ ${formatMetric(exp.primary_metric,comparison.delta)} · p ${comparison.pValue===null?"—":comparison.pValue.toFixed(4)}`
              : arm.arm_key===exp.control_arm_key?"Baseline":"Noch nicht vergleichbar"}
          </span>
        </div>
      })}
    </div>

    {Object.keys(guardrails).length>0&&<div style={{marginTop:12}}>
      <div style={{fontSize:9,fontWeight:900,color:"#737b6d",marginBottom:7}}>GUARDRAILS</div>
      {Object.entries(guardrails).map(([metric,rows])=>{
        const risky=Object.entries(rows).filter(([,row])=>row.risk);
        return <div key={metric} style={{padding:"8px 10px",borderRadius:10,background:risky.length?"rgba(255,80,80,.06)":"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.05)",marginTop:6,fontSize:9,color:risky.length?"#ffadad":"#8e9687"}}>
          <strong>{metric}</strong> · {Object.entries(rows).map(([arm,row])=>`${arm} ${formatPct(row.value)}`).join(" · ")}
          {risky.length>0&&<span> · RISK: {risky.map(([arm])=>arm).join(", ")}</span>}
        </div>
      })}
    </div>}

    <div style={{marginTop:12,padding:12,borderRadius:12,border:"1px solid rgba(213,255,89,.1)",background:"rgba(213,255,89,.025)"}}>
      <div style={{fontSize:9,fontWeight:900,color:"#b7d84b"}}>EMPFEHLUNG · KEIN AUTO-WINNER</div>
      <div style={{fontSize:10,color:"#aab2a2",lineHeight:1.55,marginTop:6}}>
        {ev?.recommendation?.rationale||"Noch nicht genug Exposure für eine belastbare Empfehlung."}
      </div>
      {ev?.recommendation?.reviewArm&&<div style={{fontSize:9,color:"#bffb84",marginTop:7}}>Zur Prüfung: Arm {ev.recommendation.reviewArm}</div>}
    </div>

    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
      <button disabled={Boolean(busy)} onClick={()=>void post({action:"evaluate",experimentId:exp.id},"eval"+exp.id)} style={buttonStyle(true)}>Jetzt auswerten</button>
      {exp.status==="running"&&<button disabled={Boolean(busy)} onClick={()=>void changeStatus(exp,"pause")} style={buttonStyle(false)}>Pausieren</button>}
      {exp.status==="paused"&&<button disabled={Boolean(busy)} onClick={()=>void changeStatus(exp,"resume")} style={buttonStyle(true)}>Wieder starten</button>}
      {!["completed","archived"].includes(exp.status)&&<button disabled={Boolean(busy)} onClick={()=>void changeStatus(exp,"complete")} style={buttonStyle(false)}>Abschließen</button>}
    </div>
  </>;
}

function Panel({title,children}:{title:string;children:React.ReactNode}){
  return <div style={{border:"1px solid rgba(255,255,255,.07)",borderRadius:16,padding:14,background:"rgba(255,255,255,.018)"}}>
    <div style={{fontSize:10,fontWeight:850,letterSpacing:".1em",color:"#7c8476",marginBottom:10}}>{title.toUpperCase()}</div>
    {children}
  </div>;
}
function Stat({title,value}:{title:string;value:number}){
  return <div style={{padding:13,borderRadius:14,border:"1px solid rgba(255,255,255,.07)",background:"rgba(255,255,255,.025)"}}>
    <div style={{fontSize:9,fontWeight:850,letterSpacing:".1em",color:"#71796b"}}>{title.toUpperCase()}</div>
    <div style={{fontSize:20,fontWeight:900,marginTop:5,color:"#edf2e8"}}>{value}</div>
  </div>;
}
function Info({title,value}:{title:string;value:string}){
  return <div style={{padding:10,borderRadius:10,background:"rgba(255,255,255,.025)",border:"1px solid rgba(255,255,255,.05)"}}>
    <div style={{fontSize:8,fontWeight:850,color:"#71796b"}}>{title.toUpperCase()}</div>
    <div style={{fontSize:10,color:"#bec6b7",marginTop:4}}>{value}</div>
  </div>;
}
function Badge({label,value,active=false}:{label:string;value:string;active?:boolean}){
  return <span style={{padding:"7px 9px",borderRadius:999,border:"1px solid rgba(255,255,255,.08)",background:active?"rgba(213,255,89,.09)":"rgba(255,255,255,.035)",fontSize:9,color:active?"#d5ff59":"#90988a",fontWeight:850}}>{label}: {value}</span>;
}
function Notice({kind,children}:{kind:"error"|"warn"|"ok";children:React.ReactNode}){
  const cfg=kind==="error"?["rgba(255,80,80,.08)","#ffb3b3"]:kind==="warn"?["rgba(242,217,140,.07)","#f2d98c"]:["rgba(52,199,89,.07)","#8be9b2"];
  return <div style={{marginTop:12,padding:"9px 11px",borderRadius:10,background:cfg[0],color:cfg[1],fontSize:10}}>{children}</div>;
}
function Empty({text}:{text:string}){return <div style={{fontSize:10,color:"#737b6d",padding:"6px 0"}}>{text}</div>}
function formatPct(value:number){return Number.isFinite(value)?(value*100).toFixed(value<0.01?2:1)+"%":"—"}
function formatMetric(metric:string,value:number){return metric==="revenue_per_100_companies"?Number(value||0).toFixed(0):formatPct(Number(value||0))}
const subStyle:React.CSSProperties={fontSize:9,color:"#7f8779",marginTop:4,lineHeight:1.45,maxWidth:720};
function buttonStyle(primary:boolean):React.CSSProperties{
  return {border:primary?"1px solid rgba(213,255,89,.28)":"1px solid rgba(255,255,255,.1)",background:primary?"rgba(213,255,89,.09)":"rgba(255,255,255,.04)",color:primary?"#d5ff59":"#adb5a6",padding:"9px 11px",borderRadius:10,fontSize:10,fontWeight:850,cursor:"pointer"};
}
