"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Candidate={
  lead_id:string;contact_id:string;company_id:string|null;contact_name:string|null;
  email:string;company_name:string|null;city:string|null
};
type Review={
  id:string;company_id:string|null;contact_id:string|null;channel:string;jurisdiction:string;
  requested_basis:string;status:string;source:string|null;evidence:Record<string,unknown>;
  requested_by:string;reviewed_by:string|null;reviewed_at:string|null;decision_reason:string|null;
  created_at:string;contact_name:string|null;email:string|null;company_name:string|null
};
type Permission={
  id:string;company_id:string|null;contact_id:string|null;channel:string;jurisdiction:string;
  basis:string;status:string;source:string|null;verified_by:string|null;verified_at:string|null;
  valid_until:string|null;decision_reason:string|null;updated_at:string;
  contact_name:string|null;email:string|null;company_name:string|null
};
type Suppression={
  id:string;identifier:string;reason:string;status:string;source:string|null;created_by:string;
  created_at:string;contact_id:string|null;company_id:string|null;lead_id:string|null
};
type Dashboard={
  counts:{emailContacts:number;verifiedPermissions:number;activeSuppressions:number;pendingReviews:number};
  readiness:{queued:number;allowed:number;blocked:number;reasons:Record<string,number>;pendingReviews:number;ready:boolean};
  reviews:Review[];
  permissions:Permission[];
  suppressions:Suppression[];
  candidates:Candidate[];
  policyVersion:string;
};
type Control={
  stored:{version:number;complianceMode:"off"|"shadow"|"enforce"}|null;
  resolved:{complianceMode:"off"|"shadow"|"enforce"};
  capabilities:{complianceEnforcement:boolean};
  environmentOverrides:{complianceMode:boolean;emergencyKillSwitch:boolean};
};

const basisOptions=[
  ["explicit_consent","Explizite Einwilligung"],
  ["inbound_request","Inbound-Anfrage"],
  ["existing_customer_exception","Bestandskunden-Ausnahme"],
  ["contractual_necessity","Vertragliche Notwendigkeit"],
] as const;

export default function ComplianceControlTower(){
  const [dashboard,setDashboard]=useState<Dashboard|null>(null);
  const [control,setControl]=useState<Control|null>(null);
  const [candidateId,setCandidateId]=useState("");
  const [basis,setBasis]=useState<(typeof basisOptions)[number][0]>("explicit_consent");
  const [jurisdiction,setJurisdiction]=useState("DE");
  const [source,setSource]=useState("");
  const [evidence,setEvidence]=useState("");
  const [manualEmail,setManualEmail]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");

  const load=useCallback(async()=>{
    setError("");
    try{
      const [d,c]=await Promise.all([
        fetch("/api/outbound/v3/compliance",{cache:"no-store"}),
        fetch("/api/outbound/v3/control",{cache:"no-store"}),
      ]);
      const [dj,cj]=await Promise.all([d.json(),c.json()]);
      if(!d.ok)throw new Error(dj?.error||"Compliance Dashboard konnte nicht geladen werden.");
      if(!c.ok)throw new Error(cj?.error||"Control Plane konnte nicht geladen werden.");
      setDashboard(dj as Dashboard);
      setControl(cj as Control);
      if(!candidateId&&dj.candidates?.[0]?.contact_id)setCandidateId(dj.candidates[0].contact_id);
    }catch(err){setError(err instanceof Error?err.message:"Compliance Dashboard konnte nicht geladen werden.")}
  },[candidateId]);

  useEffect(()=>{void load()},[load]);

  const candidate=useMemo(
    ()=>dashboard?.candidates.find(item=>item.contact_id===candidateId)||null,
    [dashboard,candidateId],
  );

  async function post(action:string,payload:Record<string,unknown>){
    setBusy(true);setError("");setMessage("");
    try{
      const response=await fetch("/api/outbound/v3/compliance",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({action,payload}),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data?.error||"Compliance-Aktion fehlgeschlagen.");
      setMessage("Compliance-Aktion gespeichert.");
      await load();
      return true;
    }catch(err){
      setError(err instanceof Error?err.message:"Compliance-Aktion fehlgeschlagen.");
      return false;
    }finally{setBusy(false)}
  }

  async function requestReview(){
    if(!candidate)return;
    const ok=await post("request_review",{
      contactId:candidate.contact_id,
      companyId:candidate.company_id,
      channel:"email",
      jurisdiction,
      basis,
      source,
      evidenceSummary:evidence,
    });
    if(ok){setSource("");setEvidence("")}
  }

  async function decide(reviewId:string,decision:"approved"|"rejected"){
    const reason=window.prompt(
      decision==="approved"
        ?"Warum ist diese Permission-Basis belegt?"
        :"Warum wird die Permission abgelehnt?"
    );
    if(!reason)return;
    await post("decide_review",{reviewId,decision,reason});
  }

  async function suppress(){
    if(!manualEmail.trim())return;
    const reason=window.prompt("Grund der Sperre (kurz):","Manuelle Do-not-contact Sperre");
    if(reason===null)return;
    const ok=await post("suppress",{
      email:manualEmail.trim(),
      reason:"manual",
      source:"compliance-control-tower",
      evidenceSummary:reason,
    });
    if(ok)setManualEmail("");
  }

  async function setEnforcement(mode:"shadow"|"enforce"){
    if(!control?.stored)return;
    setBusy(true);setError("");setMessage("");
    try{
      const response=await fetch("/api/outbound/v3/control",{
        method:"PUT",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({
          expectedVersion:control.stored.version,
          complianceMode:mode,
          reason:mode==="enforce"
            ?"Enable hard compliance send gates after M4 readiness review"
            :"Return compliance engine to shadow mode",
        }),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(Array.isArray(data?.blockers)?data.blockers.join(" "):data?.error||"Modus konnte nicht geändert werden.");
      setMessage("Compliance-Modus aktualisiert.");
      await load();
    }catch(err){setError(err instanceof Error?err.message:"Modus konnte nicht geändert werden.")}
    finally{setBusy(false)}
  }

  const pending=dashboard?.reviews.filter(item=>item.status==="pending")||[];
  const recentPermissions=dashboard?.permissions.slice(0,12)||[];
  const suppressions=dashboard?.suppressions.slice(0,12)||[];
  const envPinned=Boolean(control?.environmentOverrides.complianceMode);

  return (
    <section style={{maxWidth:1540,margin:"0 auto 18px",padding:"0 28px"}}>
      <div style={{border:"1px solid rgba(151,140,255,.18)",background:"linear-gradient(145deg,rgba(15,13,27,.92),rgba(8,9,13,.94))",borderRadius:24,padding:20}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:10,fontWeight:900,letterSpacing:".13em",color:"#b9b0ff"}}>M4 · COMPLIANCE ENGINE</div>
            <h2 style={{fontSize:25,letterSpacing:"-.035em",margin:"7px 0 6px"}}>Permission Evidence & Hard Send Gates</h2>
            <p style={{margin:0,color:"#8f919d",fontSize:12,lineHeight:1.55,maxWidth:840}}>
              Keine Permission wird von der KI erfunden. Evidence wird dokumentiert, menschlich geprüft und am Launch sowie unmittelbar vor dem Versand erneut ausgewertet.
            </p>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <Badge label="Mode" value={(control?.resolved.complianceMode||"…").toUpperCase()} active={control?.resolved.complianceMode==="enforce"} />
            <Badge label="Policy" value={dashboard?.policyVersion||"…"} />
          </div>
        </div>

        {error&&<Notice kind="error">{error}</Notice>}
        {message&&<Notice kind="ok">{message}</Notice>}
        {envPinned&&<Notice kind="warn">Compliance-Modus ist per Environment gepinnt.</Notice>}

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,marginTop:18}}>
          <Stat title="E-Mail Kontakte" value={dashboard?.counts.emailContacts??0} />
          <Stat title="Verifiziert" value={dashboard?.counts.verifiedPermissions??0} />
          <Stat title="Suppressed" value={dashboard?.counts.activeSuppressions??0} />
          <Stat title="Reviews offen" value={dashboard?.counts.pendingReviews??0} />
          <Stat title="Queue blockiert" value={dashboard?.readiness.blocked??0} />
        </div>

        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>
          <button
            disabled={busy||envPinned||control?.resolved.complianceMode==="shadow"}
            onClick={()=>void setEnforcement("shadow")}
            style={buttonStyle(false)}
          >Shadow</button>
          <button
            disabled={busy||envPinned||!control?.capabilities.complianceEnforcement||!dashboard?.readiness.ready||control?.resolved.complianceMode==="enforce"}
            onClick={()=>void setEnforcement("enforce")}
            style={buttonStyle(true)}
          >Hard Gates aktivieren</button>
          <span style={{fontSize:10,color:dashboard?.readiness.ready?"#8be9b2":"#f2d98c",alignSelf:"center"}}>
            Queue: {dashboard?.readiness.allowed??0} allow · {dashboard?.readiness.blocked??0} deny
          </span>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"minmax(0,1.15fr) minmax(320px,.85fr)",gap:12,marginTop:14}}>
          <Panel title="Permission Review anlegen">
            <label style={labelStyle}>Kontakt</label>
            <select value={candidateId} onChange={e=>setCandidateId(e.target.value)} style={inputStyle}>
              {(dashboard?.candidates||[]).map(item=>
                <option key={item.contact_id} value={item.contact_id}>
                  {(item.contact_name||"Ohne Name")+" · "+(item.company_name||"Ohne Firma")+" · "+item.email}
                </option>
              )}
            </select>
            <div style={{display:"grid",gridTemplateColumns:"1fr 130px",gap:8,marginTop:8}}>
              <select value={basis} onChange={e=>setBasis(e.target.value as typeof basis)} style={inputStyle}>
                {basisOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}
              </select>
              <input value={jurisdiction} onChange={e=>setJurisdiction(e.target.value)} placeholder="DE" style={inputStyle}/>
            </div>
            <input value={source} onChange={e=>setSource(e.target.value)} placeholder="Quelle, z. B. E-Mail vom 27.09." style={{...inputStyle,marginTop:8}}/>
            <textarea value={evidence} onChange={e=>setEvidence(e.target.value)} placeholder="Welche konkrete Evidence belegt die Permission-Basis?" style={{...inputStyle,marginTop:8,minHeight:84,resize:"vertical"}}/>
            <button disabled={busy||!candidate||source.trim().length<2||evidence.trim().length<10} onClick={()=>void requestReview()} style={{...buttonStyle(true),marginTop:8}}>
              Review anlegen
            </button>
            <p style={{fontSize:9,color:"#70737f",lineHeight:1.5,margin:"9px 0 0"}}>
              Für DE/E-Mail akzeptiert die aktuelle Produkt-Policy nur explizite Einwilligung, Inbound-Anfrage, Bestandskunden-Ausnahme oder vertragliche Notwendigkeit.
            </p>
          </Panel>

          <Panel title="Manuelle Suppression">
            <input value={manualEmail} onChange={e=>setManualEmail(e.target.value)} placeholder="kontakt@firma.de" style={inputStyle}/>
            <button disabled={busy||!manualEmail.includes("@")} onClick={()=>void suppress()} style={{...buttonStyle(false),marginTop:8}}>
              Do-not-contact setzen
            </button>
            <p style={{fontSize:9,color:"#70737f",lineHeight:1.5,margin:"9px 0 0"}}>
              Stoppt wartende Sequenzen, setzt den Lead auf Do-not-contact und widerruft bestehende E-Mail-Permissions.
            </p>
          </Panel>
        </div>

        <Panel title={"Offene Reviews · "+pending.length} top>
          {pending.length===0
            ? <Empty text="Keine offenen Permission Reviews."/>
            : pending.map(item=>
              <div key={item.id} style={rowStyle}>
                <div>
                  <strong style={{color:"#e8e7ef"}}>{item.contact_name||item.email||item.contact_id||item.company_id}</strong>
                  <div style={subStyle}>{item.company_name||"—"} · {item.requested_basis} · {item.jurisdiction}</div>
                  <div style={{...subStyle,marginTop:3}}>{String(item.evidence?.summary||"")}</div>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button disabled={busy} onClick={()=>void decide(item.id,"approved")} style={buttonStyle(true)}>Freigeben</button>
                  <button disabled={busy} onClick={()=>void decide(item.id,"rejected")} style={buttonStyle(false)}>Ablehnen</button>
                </div>
              </div>
            )}
        </Panel>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:12}}>
          <Panel title="Letzte Permissions">
            {recentPermissions.length===0?<Empty text="Noch keine verifizierten Permissions."/>:recentPermissions.map(item=>
              <div key={item.id} style={rowStyle}>
                <div>
                  <strong style={{color:"#e8e7ef"}}>{item.contact_name||item.email||item.contact_id||item.company_id}</strong>
                  <div style={subStyle}>{item.basis} · {item.status} · {item.jurisdiction}</div>
                </div>
                <span style={{fontSize:9,color:item.status==="verified"?"#8be9b2":"#f2d98c"}}>{item.status.toUpperCase()}</span>
              </div>
            )}
          </Panel>
          <Panel title="Suppression Ledger">
            {suppressions.length===0?<Empty text="Keine Suppressions."/>:suppressions.map(item=>
              <div key={item.id} style={rowStyle}>
                <div>
                  <strong style={{color:"#e8e7ef"}}>{item.identifier}</strong>
                  <div style={subStyle}>{item.reason} · {item.source||"—"}</div>
                </div>
                <span style={{fontSize:9,color:"#ffb3b3"}}>{item.status.toUpperCase()}</span>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </section>
  );
}

function Panel({title,children,top=false}:{title:string;children:React.ReactNode;top?:boolean}){
  return <div style={{border:"1px solid rgba(255,255,255,.07)",borderRadius:16,padding:14,marginTop:top?12:0,background:"rgba(255,255,255,.018)"}}>
    <div style={{fontSize:10,fontWeight:850,letterSpacing:".1em",color:"#858895",marginBottom:10}}>{title.toUpperCase()}</div>
    {children}
  </div>;
}
function Stat({title,value}:{title:string;value:number}){
  return <div style={{padding:13,borderRadius:14,border:"1px solid rgba(255,255,255,.07)",background:"rgba(255,255,255,.025)"}}>
    <div style={{fontSize:9,fontWeight:850,letterSpacing:".1em",color:"#70737f"}}>{title.toUpperCase()}</div>
    <div style={{fontSize:20,fontWeight:900,marginTop:5,color:"#e8e7ef"}}>{value}</div>
  </div>;
}
function Badge({label,value,active=false}:{label:string;value:string;active?:boolean}){
  return <span style={{padding:"7px 9px",borderRadius:999,border:"1px solid rgba(255,255,255,.08)",background:active?"rgba(151,140,255,.12)":"rgba(255,255,255,.035)",fontSize:9,color:active?"#c9c2ff":"#8f919d",fontWeight:850}}>{label}: {value}</span>;
}
function Notice({kind,children}:{kind:"error"|"warn"|"ok";children:React.ReactNode}){
  const cfg=kind==="error"?["rgba(255,80,80,.08)","#ffb3b3"]:kind==="warn"?["rgba(242,217,140,.07)","#f2d98c"]:["rgba(52,199,89,.07)","#8be9b2"];
  return <div style={{marginTop:12,padding:"9px 11px",borderRadius:10,background:cfg[0],color:cfg[1],fontSize:10}}>{children}</div>;
}
function Empty({text}:{text:string}){return <div style={{fontSize:10,color:"#676a75",padding:"5px 0"}}>{text}</div>}
const labelStyle:React.CSSProperties={fontSize:9,color:"#777a86",display:"block",marginBottom:5};
const inputStyle:React.CSSProperties={width:"100%",boxSizing:"border-box",border:"1px solid rgba(255,255,255,.09)",background:"rgba(255,255,255,.035)",color:"#e8e7ef",borderRadius:10,padding:"9px 10px",fontSize:10,outline:"none"};
const rowStyle:React.CSSProperties={display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,.05)",fontSize:10};
const subStyle:React.CSSProperties={fontSize:9,color:"#747782",lineHeight:1.45};
function buttonStyle(primary:boolean):React.CSSProperties{
  return {border:primary?"1px solid rgba(151,140,255,.3)":"1px solid rgba(255,255,255,.1)",background:primary?"rgba(151,140,255,.12)":"rgba(255,255,255,.04)",color:primary?"#c9c2ff":"#aeb0ba",padding:"9px 11px",borderRadius:10,fontSize:10,fontWeight:850,cursor:"pointer"};
}
