"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ReplyClass=
  |"positive"|"meeting_intent"|"needs_information"|"objection_price"
  |"objection_existing_solution"|"objection_timing"|"not_responsible"|"referral"
  |"not_interested"|"already_filled"|"out_of_office"|"unsubscribe"
  |"legal_complaint"|"unknown";

type Escalation={
  id:string;
  thread_id:string;
  message_id:string;
  classification_id:string|null;
  reason:string;
  priority:"low"|"normal"|"high"|"urgent";
  recommended_action:string|null;
  draft_reply:string|null;
  status:string;
  due_at:string|null;
  created_at:string;
  reply_class:ReplyClass|null;
  confidence:number|null;
  subject:string;
  body_text:string;
  lead_id:string;
  contact_name:string|null;
  email:string|null;
  company_name:string|null;
};
type Recent={
  thread_id:string;
  lead_id:string;
  status:string;
  last_reply_class:ReplyClass|null;
  requires_human:boolean;
  priority:string;
  last_message_at:string|null;
  contact_name:string|null;
  email:string|null;
  company_name:string|null;
  subject:string|null;
  body_text:string|null;
  confidence:number|null;
};
type Dashboard={
  mode:"off"|"shadow"|"assist";
  autonomyLevel:number;
  aiConfigured:boolean;
  model:string;
  policyVersion:string;
  promptVersion:string;
  counts:{pending:number;openEscalations:number;classified24h:number;highIntent24h:number;failed:number};
  escalations:Escalation[];
  recent:Recent[];
};
type Control={
  stored:{version:number;conversationMode:"off"|"shadow"|"assist"}|null;
  resolved:{conversationMode:"off"|"shadow"|"assist"};
  capabilities:{conversationIntelligence:boolean;conversationAutopilot:boolean};
  environmentOverrides:{conversationMode:boolean;emergencyKillSwitch:boolean};
};

const classes:ReplyClass[]=[
  "positive","meeting_intent","needs_information","objection_price","objection_existing_solution",
  "objection_timing","not_responsible","referral","not_interested","already_filled",
  "out_of_office","unsubscribe","legal_complaint","unknown",
];

const labels:Record<ReplyClass,string>={
  positive:"Positiv",
  meeting_intent:"Termininteresse",
  needs_information:"Mehr Infos",
  objection_price:"Preis-Einwand",
  objection_existing_solution:"Bestehende Lösung",
  objection_timing:"Timing-Einwand",
  not_responsible:"Nicht zuständig",
  referral:"Weiterleitung",
  not_interested:"Kein Interesse",
  already_filled:"Stelle/Bedarf erledigt",
  out_of_office:"Abwesend",
  unsubscribe:"Opt-out",
  legal_complaint:"Rechtlich/DSGVO",
  unknown:"Unklar",
};

export default function ConversationControlTower(){
  const [dashboard,setDashboard]=useState<Dashboard|null>(null);
  const [control,setControl]=useState<Control|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [selected,setSelected]=useState<string|null>(null);

  const load=useCallback(async()=>{
    setError("");
    try{
      const [d,c]=await Promise.all([
        fetch("/api/outbound/v3/conversations",{cache:"no-store"}),
        fetch("/api/outbound/v3/control",{cache:"no-store"}),
      ]);
      const [dj,cj]=await Promise.all([d.json(),c.json()]);
      if(!d.ok)throw new Error(dj?.error||"Conversation Dashboard konnte nicht geladen werden.");
      if(!c.ok)throw new Error(cj?.error||"Control Plane konnte nicht geladen werden.");
      setDashboard(dj as Dashboard);
      setControl(cj as Control);
      if(!selected&&dj.escalations?.[0]?.id)setSelected(dj.escalations[0].id);
    }catch(err){
      setError(err instanceof Error?err.message:"Conversation Dashboard konnte nicht geladen werden.");
    }
  },[selected]);

  useEffect(()=>{
    void load();
    const timer=window.setInterval(()=>void load(),60_000);
    return()=>window.clearInterval(timer);
  },[load]);

  async function post(payload:Record<string,unknown>){
    setBusy(true);setError("");setMessage("");
    try{
      const response=await fetch("/api/outbound/v3/conversations",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(payload),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data?.error||"Conversation-Aktion fehlgeschlagen.");
      setMessage("Conversation Intelligence aktualisiert.");
      await load();
    }catch(err){
      setError(err instanceof Error?err.message:"Conversation-Aktion fehlgeschlagen.");
    }finally{setBusy(false)}
  }

  async function changeMode(mode:"off"|"shadow"|"assist"){
    if(!control?.stored)return;
    setBusy(true);setError("");setMessage("");
    try{
      const response=await fetch("/api/outbound/v3/control",{
        method:"PUT",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({
          expectedVersion:control.stored.version,
          conversationMode:mode,
          reason:`Set conversation intelligence to ${mode}`,
        }),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(Array.isArray(data?.blockers)?data.blockers.join(" "):data?.error||"Conversation-Modus konnte nicht geändert werden.");
      setMessage("Conversation-Modus aktualisiert.");
      await load();
    }catch(err){
      setError(err instanceof Error?err.message:"Conversation-Modus konnte nicht geändert werden.");
    }finally{setBusy(false)}
  }

  const current=useMemo(
    ()=>dashboard?.escalations.find(item=>item.id===selected)||dashboard?.escalations[0]||null,
    [dashboard,selected],
  );
  const envPinned=Boolean(control?.environmentOverrides.conversationMode);

  async function resolve(item:Escalation){
    const resolution=window.prompt("Was wurde erledigt?","Antwort geprüft / nächster Schritt festgelegt");
    if(!resolution)return;
    await post({action:"resolve",escalationId:item.id,resolution});
  }

  async function reclassify(item:Escalation){
    const next=window.prompt(
      "Neue Klasse:\n"+classes.map(value=>value+" = "+labels[value]).join("\n"),
      item.reply_class||"unknown",
    ) as ReplyClass|null;
    if(!next||!classes.includes(next))return;
    const reason=window.prompt("Warum ist diese Klasse korrekt?","Manuell geprüft");
    if(!reason)return;
    await post({action:"reclassify",messageId:item.message_id,replyClass:next,reason});
  }

  return (
    <section style={{maxWidth:1540,margin:"0 auto 18px",padding:"0 28px"}}>
      <div style={{border:"1px solid rgba(84,196,255,.18)",background:"linear-gradient(145deg,rgba(8,17,24,.94),rgba(7,10,14,.95))",borderRadius:24,padding:20}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:10,fontWeight:900,letterSpacing:".13em",color:"#7ed7ff"}}>M5 · CONVERSATION INTELLIGENCE</div>
            <h2 style={{fontSize:25,letterSpacing:"-.035em",margin:"7px 0 6px"}}>Reply Inbox & Human Assist</h2>
            <p style={{margin:0,color:"#8c98a1",fontSize:12,lineHeight:1.55,maxWidth:850}}>
              Antworten werden persistent erfasst, klassifiziert, priorisiert und mit einem Entwurf vorbereitet. L2 sendet niemals automatisch.
            </p>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <Badge label="Mode" value={(dashboard?.mode||"…").toUpperCase()} active={dashboard?.mode==="assist"} />
            <Badge label="AI" value={dashboard?.aiConfigured?"API":"Fallback"} active={Boolean(dashboard?.aiConfigured)} />
            <Badge label="Level" value={dashboard?("L"+dashboard.autonomyLevel):"…"} active />
          </div>
        </div>

        {error&&<Notice kind="error">{error}</Notice>}
        {message&&<Notice kind="ok">{message}</Notice>}
        {envPinned&&<Notice kind="warn">Conversation-Modus ist per Environment gepinnt.</Notice>}
        {control?.environmentOverrides.emergencyKillSwitch&&<Notice kind="error">Emergency Kill-Switch aktiv.</Notice>}

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10,marginTop:18}}>
          <Stat title="Zu klassifizieren" value={dashboard?.counts.pending??0}/>
          <Stat title="Human Inbox" value={dashboard?.counts.openEscalations??0}/>
          <Stat title="24h klassifiziert" value={dashboard?.counts.classified24h??0}/>
          <Stat title="High Intent 24h" value={dashboard?.counts.highIntent24h??0}/>
          <Stat title="Fehler" value={dashboard?.counts.failed??0}/>
        </div>

        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14,alignItems:"center"}}>
          <button disabled={busy} onClick={()=>void post({action:"process_now"})} style={buttonStyle(true)}>↻ Jetzt verarbeiten</button>
          <button disabled={busy||envPinned||dashboard?.mode==="shadow"} onClick={()=>void changeMode("shadow")} style={buttonStyle(false)}>Shadow</button>
          <button disabled={busy||envPinned||!control?.capabilities.conversationIntelligence||(dashboard?.autonomyLevel??0)<2||dashboard?.mode==="assist"} onClick={()=>void changeMode("assist")} style={buttonStyle(true)}>Assist aktivieren</button>
          <button disabled={busy||envPinned||dashboard?.mode==="off"} onClick={()=>void changeMode("off")} style={buttonStyle(false)}>Off</button>
          <span style={{fontSize:9,color:"#697781"}}>
            {dashboard?.model||"—"} · {dashboard?.policyVersion||"—"}
          </span>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"minmax(330px,.8fr) minmax(0,1.2fr)",gap:12,marginTop:14}}>
          <Panel title={"Human Inbox · "+(dashboard?.escalations.length??0)}>
            <div style={{maxHeight:520,overflow:"auto"}}>
              {(dashboard?.escalations||[]).length===0
                ? <Empty text="Keine offenen Conversation-Eskalationen."/>
                : dashboard?.escalations.map(item=>
                  <button key={item.id} onClick={()=>setSelected(item.id)} style={{
                    width:"100%",textAlign:"left",display:"block",border:"0",borderBottom:"1px solid rgba(255,255,255,.05)",
                    background:selected===item.id?"rgba(84,196,255,.08)":"transparent",padding:"11px 8px",cursor:"pointer",color:"inherit",
                  }}>
                    <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                      <strong style={{fontSize:10,color:"#e7eef2"}}>{item.contact_name||item.email||"Unbekannt"}</strong>
                      <span style={{fontSize:8,fontWeight:900,color:priorityColor(item.priority)}}>{item.priority.toUpperCase()}</span>
                    </div>
                    <div style={{fontSize:9,color:"#73818a",marginTop:3}}>{item.company_name||"—"} · {item.reply_class?labels[item.reply_class]:"Unklassifiziert"} · {formatConfidence(item.confidence)}</div>
                    <div style={{fontSize:9,color:"#8d9aa2",marginTop:5,lineHeight:1.4}}>{item.body_text||item.subject}</div>
                  </button>
                )}
            </div>
          </Panel>

          <Panel title="Conversation Detail">
            {!current?<Empty text="Wähle links eine Antwort aus."/>:
              <>
                <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
                  <div>
                    <strong style={{fontSize:13,color:"#edf4f7"}}>{current.contact_name||current.email||"Unbekannt"}</strong>
                    <div style={subStyle}>{current.company_name||"—"} · {current.email||"—"}</div>
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <ClassPill value={current.reply_class||"unknown"}/>
                    <span style={{fontSize:9,color:"#8ba0ac",alignSelf:"center"}}>{formatConfidence(current.confidence)}</span>
                  </div>
                </div>

                <div style={{marginTop:12,padding:12,borderRadius:12,background:"rgba(255,255,255,.025)",border:"1px solid rgba(255,255,255,.06)"}}>
                  <div style={{fontSize:9,fontWeight:850,color:"#71818b"}}>INBOUND</div>
                  <div style={{fontSize:10,color:"#aebbc2",marginTop:6,lineHeight:1.55,whiteSpace:"pre-wrap"}}>{current.body_text||current.subject}</div>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:10}}>
                  <Info title="Empfehlung" value={current.recommended_action||"human_review"}/>
                  <Info title="Warum" value={current.reason||"—"}/>
                </div>

                <div style={{marginTop:10,padding:12,borderRadius:12,border:"1px solid rgba(126,215,255,.12)",background:"rgba(84,196,255,.035)"}}>
                  <div style={{fontSize:9,fontWeight:850,color:"#7ed7ff"}}>KI-ENTWURF · NICHT AUTOMATISCH GESENDET</div>
                  <div style={{fontSize:10,color:"#bdc9cf",marginTop:7,lineHeight:1.55,whiteSpace:"pre-wrap"}}>
                    {current.draft_reply||"Für diese Klasse wurde bewusst kein Antwortentwurf erstellt."}
                  </div>
                </div>

                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
                  <button disabled={busy} onClick={()=>void reclassify(current)} style={buttonStyle(false)}>Klasse korrigieren</button>
                  <button disabled={busy} onClick={()=>void resolve(current)} style={buttonStyle(true)}>Als erledigt markieren</button>
                </div>
              </>
            }
          </Panel>
        </div>

        <Panel title="Letzte Conversations" top>
          {(dashboard?.recent||[]).length===0?<Empty text="Noch keine Conversation-Historie."/>:
            <div style={{overflowX:"auto"}}>
              {(dashboard?.recent||[]).slice(0,25).map(item=>
                <div key={item.thread_id} style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 120px 90px 2fr",gap:10,padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,.045)",fontSize:9,alignItems:"center"}}>
                  <span style={{color:"#d7e1e6"}}>{item.contact_name||item.email||item.lead_id}</span>
                  <span style={{color:"#7c8b93"}}>{item.company_name||"—"}</span>
                  <span style={{color:"#9bacb5"}}>{item.last_reply_class?labels[item.last_reply_class]:"—"}</span>
                  <span style={{color:item.requires_human?"#f2d98c":"#79dca5"}}>{item.requires_human?"HUMAN":"OK"}</span>
                  <span style={{color:"#73818a"}}>{item.body_text||item.subject||"—"}</span>
                </div>
              )}
            </div>
          }
        </Panel>
      </div>
    </section>
  );
}

function Panel({title,children,top=false}:{title:string;children:React.ReactNode;top?:boolean}){
  return <div style={{border:"1px solid rgba(255,255,255,.07)",borderRadius:16,padding:14,background:"rgba(255,255,255,.018)",marginTop:top?12:0}}>
    <div style={{fontSize:10,fontWeight:850,letterSpacing:".1em",color:"#7c8991",marginBottom:10}}>{title.toUpperCase()}</div>
    {children}
  </div>;
}
function Stat({title,value}:{title:string;value:number}){
  return <div style={{padding:13,borderRadius:14,border:"1px solid rgba(255,255,255,.07)",background:"rgba(255,255,255,.025)"}}>
    <div style={{fontSize:9,fontWeight:850,letterSpacing:".1em",color:"#697781"}}>{title.toUpperCase()}</div>
    <div style={{fontSize:20,fontWeight:900,marginTop:5,color:"#e7eef2"}}>{value}</div>
  </div>;
}
function Info({title,value}:{title:string;value:string}){
  return <div style={{padding:10,borderRadius:10,background:"rgba(255,255,255,.025)",border:"1px solid rgba(255,255,255,.05)"}}>
    <div style={{fontSize:8,fontWeight:850,color:"#6c7b84"}}>{title.toUpperCase()}</div>
    <div style={{fontSize:9,color:"#aebbc2",marginTop:4,lineHeight:1.45}}>{value}</div>
  </div>;
}
function Badge({label,value,active=false}:{label:string;value:string;active?:boolean}){
  return <span style={{padding:"7px 9px",borderRadius:999,border:"1px solid rgba(255,255,255,.08)",background:active?"rgba(84,196,255,.1)":"rgba(255,255,255,.035)",fontSize:9,color:active?"#8edfff":"#89979f",fontWeight:850}}>{label}: {value}</span>;
}
function ClassPill({value}:{value:ReplyClass}){
  return <span style={{padding:"6px 8px",borderRadius:999,background:"rgba(84,196,255,.08)",border:"1px solid rgba(84,196,255,.14)",fontSize:9,color:"#9fe4ff",fontWeight:850}}>{labels[value]}</span>;
}
function Notice({kind,children}:{kind:"error"|"warn"|"ok";children:React.ReactNode}){
  const cfg=kind==="error"?["rgba(255,80,80,.08)","#ffb3b3"]:kind==="warn"?["rgba(242,217,140,.07)","#f2d98c"]:["rgba(52,199,89,.07)","#8be9b2"];
  return <div style={{marginTop:12,padding:"9px 11px",borderRadius:10,background:cfg[0],color:cfg[1],fontSize:10}}>{children}</div>;
}
function Empty({text}:{text:string}){return <div style={{fontSize:10,color:"#697781",padding:"6px 0"}}>{text}</div>}
function formatConfidence(value:number|null){return value===null?"—":Math.round(Number(value)*100)+"%"}
function priorityColor(value:string){return value==="urgent"?"#ff8e8e":value==="high"?"#f2d98c":value==="normal"?"#8edfff":"#839199"}
const subStyle:React.CSSProperties={fontSize:9,color:"#73818a",marginTop:3};
function buttonStyle(primary:boolean):React.CSSProperties{
  return {border:primary?"1px solid rgba(84,196,255,.28)":"1px solid rgba(255,255,255,.1)",background:primary?"rgba(84,196,255,.1)":"rgba(255,255,255,.04)",color:primary?"#9fe4ff":"#aab5bb",padding:"9px 11px",borderRadius:10,fontSize:10,fontWeight:850,cursor:"pointer"};
}
