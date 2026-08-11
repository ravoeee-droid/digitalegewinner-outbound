"use client";

import { useEffect, useState } from "react";

type Lead = { id:string; company:string; contact?:string; email?:string; stage?:string; notes?:string };
type Store = { leads?:Lead[]; campaigns?:unknown[]; mailboxes?:unknown[]; settings?:Record<string,unknown> };

export default function NoShowRescueWidget() {
  const [open,setOpen]=useState(false);
  const [leads,setLeads]=useState<Lead[]>([]);
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");

  async function load() {
    try {
      const response=await fetch("/api/state");
      const json=await response.json() as {state?:Store;error?:string};
      if(!response.ok) throw new Error(json.error||"Leads konnten nicht geladen werden.");
      setLeads((json.state?.leads||[]).filter((lead)=>lead.stage==="Termin"));
      setMessage("");
    } catch(error) {
      setMessage(error instanceof Error?error.message:"Fehler beim Laden.");
    }
  }

  useEffect(()=>{if(open)void load()},[open]);

  async function rescue(lead:Lead) {
    setBusy(lead.id);
    setMessage(`No-Show Rescue für ${lead.company} wird eingeplant …`);
    try {
      const response=await fetch("/api/appointments/no-show",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({leadId:lead.id,firstDelayMinutes:5,secondDelayHours:24}),
      });
      const json=await response.json() as {queued?:number;firstAt?:string;secondAt?:string;error?:string};
      if(!response.ok) throw new Error(json.error||"No-Show Rescue fehlgeschlagen.");

      const stateResponse=await fetch("/api/state");
      const stateJson=await stateResponse.json() as {state?:Store};
      const state=stateJson.state||{};
      const stamp=new Date().toLocaleString("de-DE");
      const nextLeads=(state.leads||[]).map((item)=>item.id===lead.id?{
        ...item,
        stage:"Engaged",
        notes:[String(item.notes||""),`No-Show Rescue gestartet ${stamp} · 2 Follow-ups eingeplant`].filter(Boolean).join(" · "),
      }:item);
      await fetch("/api/state",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({...state,leads:nextLeads})});
      setLeads((current)=>current.filter((item)=>item.id!==lead.id));
      setMessage(`${json.queued||2} Follow-ups eingeplant: in 5 Minuten und nach 24 Stunden.`);
    } catch(error) {
      setMessage(error instanceof Error?error.message:"No-Show Rescue fehlgeschlagen.");
    } finally {
      setBusy("");
    }
  }

  return <>
    <button onClick={()=>setOpen(true)} style={{position:"fixed",right:680,bottom:24,zIndex:80,border:"1px solid #603845",background:"#251118",color:"#ff9eaf",padding:"12px 15px",borderRadius:13,fontWeight:900,cursor:"pointer",boxShadow:"0 18px 45px rgba(0,0,0,.35)"}}>↻ No-Show Rescue</button>
    {open&&<div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:125,background:"rgba(3,6,10,.82)",backdropFilter:"blur(9px)",display:"grid",placeItems:"center",padding:18}}>
      <div onClick={(event)=>event.stopPropagation()} style={{width:"min(820px,100%)",maxHeight:"88vh",overflow:"auto",background:"#0a1119",border:"1px solid #2d3545",borderRadius:22,padding:24,color:"#eef4ff",fontFamily:"Inter,system-ui"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"start"}}>
          <div><div style={{fontSize:10,color:"#ff94aa",fontWeight:900,letterSpacing:".15em"}}>APPOINTMENT RECOVERY</div><h2 style={{margin:"7px 0",fontSize:28}}>No-Shows automatisch zurückholen</h2><p style={{margin:0,color:"#8290a5",fontSize:13,lineHeight:1.55}}>Markiere einen verpassten Termin. Das System plant automatisch eine kurze Nachricht nach 5 Minuten und ein letztes Follow-up nach 24 Stunden ein. Antworten stoppen die Sequenz.</p></div>
          <button onClick={()=>setOpen(false)} style={{border:0,background:"#182230",color:"#fff",width:36,height:36,borderRadius:10,cursor:"pointer",fontSize:20}}>×</button>
        </div>
        <button onClick={()=>void load()} style={{margin:"18px 0 12px",border:"1px solid #304258",borderRadius:10,padding:"9px 12px",background:"#121c28",color:"#fff",fontWeight:800,cursor:"pointer"}}>Termine aktualisieren</button>
        {message&&<div style={{marginBottom:12,padding:"10px 12px",border:"1px solid #2d3b4e",borderRadius:10,background:"#0d1824",color:"#a9b8cb",fontSize:12}}>{message}</div>}
        <div style={{display:"grid",gap:9}}>
          {leads.length?leads.map((lead)=><div key={lead.id} style={{border:"1px solid #263242",borderRadius:13,padding:14,display:"grid",gridTemplateColumns:"1fr auto",gap:12,alignItems:"center",background:"#0b131c"}}><div><strong style={{display:"block",fontSize:13}}>{lead.company}</strong><small style={{display:"block",marginTop:5,color:"#78879a"}}>{lead.contact||"Kein Kontaktname"} · {lead.email||"Keine E-Mail"}</small></div><button disabled={Boolean(busy)||!lead.email} onClick={()=>void rescue(lead)} style={{border:"1px solid #643443",background:"#28131a",color:lead.email?"#ff9eb0":"#68545a",borderRadius:10,padding:"10px 12px",fontWeight:900,cursor:lead.email&&!busy?"pointer":"not-allowed"}}>{busy===lead.id?"Plant ein…":"Als No-Show markieren"}</button></div>):<div style={{padding:20,border:"1px solid #263242",borderRadius:13,color:"#748297"}}>Aktuell keine Leads im Status „Termin“.</div>}
        </div>
      </div>
    </div>}
  </>;
}
