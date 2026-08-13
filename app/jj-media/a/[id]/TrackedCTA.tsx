"use client";

export default function TrackedCTA({leadId,href,label="15 Minuten gemeinsam durchgehen"}:{leadId:string;href:string;label?:string}){
  function track(){void fetch("/api/jj-media/track",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({leadId,type:"cta_click"}),keepalive:true}).catch(()=>undefined)}
  return <a href={href} target="_blank" rel="noreferrer" onClick={track} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",padding:"15px 20px",borderRadius:999,background:"#f4f1e8",color:"#11120f",fontWeight:900,textDecoration:"none",boxShadow:"0 18px 55px rgba(0,0,0,.22)"}}>{label}</a>
}
