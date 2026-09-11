"use client";

import Image from "next/image";
import Link from "next/link";
import { CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import RevenueOutboundOS from "@/app/ui/RevenueOutboundOS";
import WebsitePipelineShortcuts from "@/app/ui/WebsitePipelineShortcuts";
import styles from "./outbound-command-center.module.css";

type MissionControl = { mission?: { title?: string; detail?: string; href?: string }; metrics?: { callsDone?: number; callsTarget?: number; callsReady?: number; connectRate?: number; activeBuilds?: number; dueFollowups?: number; weightedPipeline?: number; openOpportunities?: number } };
type Task = { id: string; channel: "call"|"email"|"video"|"linkedin"; rank: number; status: string; score: number; payload?: Record<string, unknown> };
type Engine = { channels?: Record<string,{target:number;ready:number;done:number;total:number}>; tasks?: Task[] };
type AgentState = "idle"|"listening"|"thinking"|"acting"|"speaking"|"error";
type AgentMode = "auto"|"fast"|"smart";
type Message = { role:"user"|"assistant"|"system"; content:string };
type Approval = { id:string; tool:string; args:Record<string,unknown>; risk:string; expiresAt?:string };
type Reply = { threadId:string; reply:string; provider:string; model:string; fallbackUsed?:boolean; pendingApprovals?:Approval[]; error?:string };
type ProviderStatus = { experiential?:boolean; groq?:boolean; models?:Record<string,string>; error?:string };
type Recognition = { lang:string; interimResults:boolean; continuous:boolean; start:()=>void; stop:()=>void; onresult:((event:{results:ArrayLike<{0:{transcript:string}}>})=>void)|null; onerror:(()=>void)|null; onend:(()=>void)|null };
type RecognitionCtor = new()=>Recognition;

const PARTICLES=[[18,20,0],[72,13,1.2],[28,44,2.4],[82,38,.4],[12,66,3.1],[68,72,1.8],[41,18,4.2],[58,55,2.8],[33,79,1.1],[89,67,3.8],[8,34,2.2],[76,87,.8]];
const QUICK=["Zeig mir die heißesten Pflege-Leads","Prüfe den Systemstatus und sag mir, was fehlt","Baue meinen Tagesplan für heute","Finde 5 neue Pflege-Leads und qualifiziere sie"];

function money(v=0){return new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(v)}
function label(c:Task["channel"]){return c==="call"?"Call":c==="email"?"E-Mail":c==="video"?"Video":"LinkedIn"}
function greeting(){const h=new Date().getHours();return h<11?"Guten Morgen Raphael":h<18?"Guten Tag Raphael":"Guten Abend Raphael"}
function providerLabel(provider="",model="",fallback=false){if(!provider)return "DG Core";return `${provider==="experiential"?"Experiential":provider==="groq"?"Groq":provider} · ${model||"Auto"}${fallback?" · Fallback":""}`}

export default function OutboundCommandCenter(){
 const [mission,setMission]=useState<MissionControl|null>(null),[engine,setEngine]=useState<Engine|null>(null),[loading,setLoading]=useState(true),[detailOpen,setDetailOpen]=useState(false);
 const [command,setCommand]=useState(""),[state,setState]=useState<AgentState>("idle"),[note,setNote]=useState("Operator online. Sag mir, was ich erledigen soll."),[threadId,setThreadId]=useState<string>();
 const [messages,setMessages]=useState<Message[]>([]),[pending,setPending]=useState<Approval[]>([]),[provider,setProvider]=useState(""),[model,setModel]=useState(""),[fallback,setFallback]=useState(false),[providerStatus,setProviderStatus]=useState<ProviderStatus|null>(null),[mode,setMode]=useState<AgentMode>("auto"),[voice,setVoice]=useState(false),[expanded,setExpanded]=useState(false);
 const recognition=useRef<Recognition|null>(null);

 async function refresh(){try{const [m,e]=await Promise.all([fetch("/api/mission-control",{cache:"no-store"}).then(r=>r.json() as Promise<MissionControl>),fetch("/api/outbound-engine",{cache:"no-store"}).then(r=>r.json() as Promise<Engine>)]);setMission(m);setEngine(e)}catch{setNote("Live-Daten konnten gerade nicht geladen werden. DG Core bleibt im Safe Mode.")}}
 useEffect(()=>{let live=true;(async()=>{setLoading(true);await refresh();try{const s=await fetch("/api/agent/status",{cache:"no-store"}).then(r=>r.json() as Promise<ProviderStatus>);if(live)setProviderStatus(s)}catch{}if(live)setLoading(false)})();const t=window.setInterval(()=>void refresh(),60000);return()=>{live=false;window.clearInterval(t);recognition.current?.stop()}},[]);

 const metrics=mission?.metrics||{},channels=engine?.channels||{},tasks=useMemo(()=>(engine?.tasks||[]).slice(0,5),[engine?.tasks]);
 const done=Object.values(channels).reduce((s,r)=>s+Number(r.done||0),0),ready=Object.values(channels).reduce((s,r)=>s+Number(r.ready||0),0),callProgress=Math.min(100,Math.round(Number(metrics.callsDone||0)/Math.max(1,Number(metrics.callsTarget||120))*100));
 const online=Boolean(providerStatus?.experiential||providerStatus?.groq);

 function speak(text:string){if(!voice||!("speechSynthesis" in window))return;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text.slice(0,1200));u.lang="de-DE";u.rate=1.04;u.onstart=()=>setState("speaking");u.onend=()=>setState("idle");window.speechSynthesis.speak(u)}
 async function send(value:string){const text=value.trim();if(!text||state==="thinking"||state==="acting")return;setMessages(v=>[...v,{role:"user",content:text}]);setExpanded(true);setState("thinking");setNote("Ich denke, prüfe Live-Daten und führe sichere Schritte aus …");try{const r=await fetch("/api/agent",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:text,threadId,mode})});const j=await r.json() as Reply;if(!r.ok)throw new Error(j.error||"DG Core konnte den Befehl nicht ausführen.");setThreadId(j.threadId);setProvider(j.provider||"");setModel(j.model||"");setFallback(Boolean(j.fallbackUsed));setPending(j.pendingApprovals||[]);setMessages(v=>[...v,{role:"assistant",content:j.reply}]);setNote(j.pendingApprovals?.length?`${j.pendingApprovals.length} Aktion(en) warten auf deine Freigabe.`:j.reply);setState("idle");speak(j.reply);await refresh()}catch(e){const m=e instanceof Error?e.message:"DG Core ist gerade nicht erreichbar.";setMessages(v=>[...v,{role:"system",content:m}]);setNote(m);setState("error")}}
 function submit(e:FormEvent){e.preventDefault();const v=command;setCommand("");void send(v)}
 function listen(){const w=window as typeof window&{SpeechRecognition?:RecognitionCtor;webkitSpeechRecognition?:RecognitionCtor};const C=w.SpeechRecognition||w.webkitSpeechRecognition;if(!C){setNote("Spracherkennung wird von diesem Browser nicht unterstützt.");return}recognition.current?.stop();const r=new C();r.lang="de-DE";r.interimResults=false;r.continuous=false;r.onresult=e=>{const t=e.results[0]?.[0]?.transcript?.trim()||"";setCommand(t);if(t)void send(t)};r.onerror=()=>{setState("error");setNote("Ich konnte dich gerade nicht verstehen.")};r.onend=()=>setState(s=>s==="listening"?"idle":s);recognition.current=r;setState("listening");setNote("Ich höre zu …");r.start()}
 async function approve(a:Approval,decision:"approve"|"reject"){setState("acting");setNote(decision==="approve"?"Freigegebene Aktion wird ausgeführt …":"Aktion wird verworfen …");try{const r=await fetch("/api/agent/approve",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({actionId:a.id,decision})});const j=await r.json() as {error?:string};if(!r.ok)throw new Error(j.error||"Freigabe fehlgeschlagen.");setPending(v=>v.filter(x=>x.id!==a.id));const n=decision==="approve"?`${a.tool} wurde nach deiner Freigabe ausgeführt.`:`${a.tool} wurde verworfen.`;setMessages(v=>[...v,{role:"system",content:n}]);setNote(n);setState("idle");await refresh()}catch(e){setNote(e instanceof Error?e.message:"Aktion fehlgeschlagen.");setState("error")}}

 return <main className={styles.shell}>
  <div className={styles.ambient}/>
  <header className={styles.topbar}>
   <Link href="/" className={styles.brand}><span className={styles.brandMark}>DG</span><span><strong>DIGITALE GEWINNER</strong><small>Revenue Intelligence OS</small></span></Link>
   <nav className={styles.nav}><span className={styles.active}>Command</span><Link href="/call">Call Mode</Link><Link href="/websites">Websites</Link><button onClick={()=>setDetailOpen(true)}>CRM / Pipeline</button></nav>
   <div className={styles.system}><i className={online?styles.live:styles.warn}/>{online?"DG CORE LIVE":"API SETUP"}</div>
  </header>

  <div className={styles.welcome}><div><span>AI REVENUE OPERATOR</span><h1>{greeting()}</h1></div><div className={styles.providers}><span className={providerStatus?.experiential?styles.on:""}>Experiential</span><span className={providerStatus?.groq?styles.on:""}>Groq fallback</span><span>{providerLabel(provider,model,fallback)}</span></div></div>

  <section className={styles.stage}>
   <aside className={`${styles.panel} ${styles.leftTop}`}><small className={styles.eyebrow}>HEUTE</small><h2>Outbound Flow</h2><div className={styles.flow}>{(["call","video","email","linkedin"] as const).map(k=>{const r=channels[k]||{target:0,ready:0,done:0,total:0};const p=Math.min(100,Math.round(Number(r.done||0)/Math.max(1,Number(r.target||1))*100));return <div className={styles.flowRow} key={k}><div><span>{label(k)}</span><b>{r.done}/{r.target}</b></div><div className={styles.bar}><i style={{width:`${p}%`}}/></div><small>{r.ready} bereit</small></div>})}</div></aside>
   <aside className={`${styles.panel} ${styles.leftBottom}`}><small className={styles.eyebrow}>PERFORMANCE</small><div className={styles.bigMetric}>{money(Number(metrics.weightedPipeline||0))}</div><p>gewichtete Pipeline</p><div className={styles.spark}>{[16,29,24,45,39,68,58,83].map((h,i)=><i key={i} style={{height:`${h}%`}}/>)}</div><div className={styles.triplet}><div><b>{metrics.openOpportunities||0}</b><span>Chancen</span></div><div><b>{metrics.connectRate||0}%</b><span>Connect</span></div><div><b>{metrics.dueFollowups||0}</b><span>Fällig</span></div></div></aside>

   <section className={styles.core} data-state={loading?"thinking":state}><div className={styles.halo}/><div className={styles.scan}/><div className={styles.particles}>{PARTICLES.map(([x,y,d],i)=><i key={i} style={{"--x":`${x}%`,"--y":`${y}%`,"--delay":`${d}s`} as CSSProperties}/>)}</div><div className={styles.operatorWrap}><Image src="/dg-ai-operator.webp" alt="DG Core holografischer KI Operator" width={560} height={1009} priority className={styles.operator}/><div className={styles.fade}/></div><div className={styles.projector}><i/><i/><i/></div><div className={styles.coreLabel}><b><i/> DG CORE</b><span>{loading?"synchronisiert":state==="listening"?"hört zu":state==="thinking"?"denkt & prüft":state==="acting"?"führt aus":state==="speaking"?"spricht":state==="error"?"Safe Mode":"Operator online"}</span></div><div className={styles.thought}>{note}</div></section>

   <aside className={`${styles.panel} ${styles.rightTop}`}><small className={styles.eyebrow}>NEXT BEST ACTION</small><h2>{mission?.mission?.title||"Pipeline wird analysiert"}</h2><p>{mission?.mission?.detail||"DG Core priorisiert gerade die nächsten Schritte."}</p>{mission?.mission?.href&&<Link href={mission.mission.href} className={styles.action}>Mission öffnen <span>↗</span></Link>}<div className={styles.mini}><div><b>{metrics.callsReady||0}</b><span>Calls bereit</span></div><div><b>{metrics.activeBuilds||0}</b><span>Builds aktiv</span></div></div></aside>
   <aside className={`${styles.panel} ${styles.rightBottom}`}><small className={styles.eyebrow}>LIVE QUEUE</small><div className={styles.activity}>{tasks.length?tasks.map(t=><div className={styles.activityRow} key={t.id}><i/><div><b>{String(t.payload?.company||"Lead")}</b><small>{label(t.channel)} · Score {t.score}</small></div><em>{t.status}</em></div>):<p>Keine offenen Tasks geladen.</p>}</div></aside>
  </section>

  <section className={`${styles.console} ${expanded?styles.consoleOpen:""}`}><button className={styles.consoleToggle} onClick={()=>setExpanded(v=>!v)}><span>DG CORE // SESSION</span><b>{pending.length?`${pending.length} FREIGABE${pending.length>1?"N":""}`:messages.length?`${messages.length} MESSAGES`:"BEREIT"}</b></button>{expanded&&<div className={styles.consoleBody}><div className={styles.chat}>{!messages.length&&<div className={styles.emptyChat}><b>Ich kann das Sales OS bedienen.</b><span>Leads finden, prüfen, priorisieren, Website-Audits starten, Tagespläne bauen, CRM pflegen und sichere Schritte selbst ausführen.</span></div>}{messages.slice(-8).map((m,i)=><div key={`${m.role}-${i}`} className={`${styles.bubble} ${styles[`chat_${m.role}`]}`}><small>{m.role==="user"?"RAPHAEL":m.role==="assistant"?"DG CORE":"SYSTEM"}</small><p>{m.content}</p></div>)}</div>{pending.length>0&&<div className={styles.approvals}><strong>DEINE FREIGABE IST NÖTIG</strong>{pending.map(a=><div className={styles.approval} key={a.id}><div><b>{a.tool.replaceAll("_"," ")}</b><span>Externe Aktion · ohne Freigabe keine Ausführung</span></div><div><button onClick={()=>void approve(a,"reject")}>Ablehnen</button><button onClick={()=>void approve(a,"approve")}>Freigeben</button></div></div>)}</div>}</div>}</section>

  <section className={styles.dock}><div className={styles.agentMeta}><button className={`${styles.voice} ${state==="listening"?styles.voiceActive:""}`} onClick={listen} aria-label="Mit DG Core sprechen"><i/><i/><i/><i/></button><div><b>DG Core</b><small>{providerLabel(provider,model,fallback)}</small></div></div><form onSubmit={submit} className={styles.command}><input value={command} onChange={e=>setCommand(e.target.value)} placeholder="Raphael, was soll ich erledigen?" disabled={state==="thinking"||state==="acting"}/><button disabled={!command.trim()||state==="thinking"||state==="acting"}>↗</button></form><div className={styles.tools}><select value={mode} onChange={e=>setMode(e.target.value as AgentMode)}><option value="auto">Auto</option><option value="fast">Fast</option><option value="smart">Smart</option></select><button className={voice?styles.toolOn:""} onClick={()=>setVoice(v=>!v)} title="Antworten vorlesen">◉</button></div><div className={styles.quick}>{QUICK.map(q=><button key={q} onClick={()=>void send(q)}>{q}</button>)}</div><div className={styles.stats}><span>{done} erledigt</span><span>{ready} bereit</span><span>{callProgress}% Call-Ziel</span></div></section>

  {detailOpen&&<div className={styles.backdrop} onMouseDown={()=>setDetailOpen(false)}><section className={styles.drawer} onMouseDown={e=>e.stopPropagation()}><header><div><span>OPERATIONS</span><h2>CRM & Pipeline</h2></div><button onClick={()=>setDetailOpen(false)}>×</button></header><div className={styles.drawerContent}><RevenueOutboundOS/><WebsitePipelineShortcuts/></div></section></div>}
 </main>
}
