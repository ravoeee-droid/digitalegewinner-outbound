"use client";

export default function TrackedCTA({leadId,href,label="Termin auswählen"}:{leadId:string;href:string;label?:string}){
 function track(){void fetch("/api/track",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({leadId,type:"cta_click"}),keepalive:true}).catch(()=>undefined)}
 return <a href={href} target="_blank" rel="noreferrer" onClick={track} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",marginTop:12,padding:"15px 20px",borderRadius:12,background:"#5eeaa7",color:"#062116",fontWeight:900,textDecoration:"none",boxShadow:"0 12px 35px rgba(94,234,167,.18)"}}>{label}</a>
}
