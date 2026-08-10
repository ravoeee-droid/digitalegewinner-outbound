"use client";
import { FormEvent, useEffect, useState } from "react";

type Item={key:string;configured:boolean;updatedAt?:string};
const fields=[
 ["openai_api_key","OpenAI API Key","password"],
 ["google_maps_api_key","Google Maps + Solar API Key","password"],
 ["email_verifier_api_key","E-Mail Verifier API Key (optional)","password"],
 ["google_client_id","Google OAuth Client ID","text"],
 ["google_client_secret","Google OAuth Client Secret","password"],
 ["microsoft_client_id","Microsoft OAuth Client ID","text"],
 ["microsoft_client_secret","Microsoft OAuth Client Secret","password"],
 ["video_renderer_url","Loom / Video Renderer API URL","text"],
 ["video_renderer_secret","Loom / Video Renderer Secret","password"],
 ["mailbox_credentials_json","Mailbox Credentials JSON (optional fallback)","password"],
] as const;

export default function IntegrationVaultWidget(){
 const [open,setOpen]=useState(false);const [items,setItems]=useState<Item[]>([]);const [message,setMessage]=useState("");
 async function load(){try{const r=await fetch("/api/integrations");if(r.ok){const j=await r.json() as {items?:Item[]};setItems(j.items||[])}}catch{}}
 useEffect(()=>{if(open)void load()},[open]);
 async function save(e:FormEvent<HTMLFormElement>,key:string){e.preventDefault();const f=new FormData(e.currentTarget);const value=String(f.get("value")||"");const r=await fetch("/api/integrations",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({key,value})});const j=await r.json() as {error?:string};setMessage(r.ok?"Verschlüsselt gespeichert.":(j.error||"Fehler"));if(r.ok){e.currentTarget.reset();await load()}}
 function connect(provider:"google"|"microsoft"){const mailboxId=window.prompt("Credential-ID für dieses Postfach (z. B. mb-andreas):");if(!mailboxId)return;const name=window.prompt("Absendername (optional):")||"";location.href=`/api/oauth/${provider}/start?mailboxId=${encodeURIComponent(mailboxId)}&name=${encodeURIComponent(name)}`}
 const configured=new Set(items.map(i=>i.key));
 const googleReady=configured.has("google_client_id")&&configured.has("google_client_secret");const microsoftReady=configured.has("microsoft_client_id")&&configured.has("microsoft_client_secret");
 return <><button onClick={()=>setOpen(true)} style={{position:"fixed",right:24,bottom:24,zIndex:80,border:"1px solid #315e49",background:"#10241b",color:"#74edb4",padding:"12px 15px",borderRadius:13,fontWeight:850,cursor:"pointer",boxShadow:"0 18px 45px rgba(0,0,0,.35)"}}>⚙ API-Tresor</button>{open&&<div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:100,background:"rgba(3,6,10,.78)",backdropFilter:"blur(8px)",display:"grid",placeItems:"center",padding:20}}><div onClick={e=>e.stopPropagation()} style={{width:"min(780px,100%)",maxHeight:"88vh",overflow:"auto",background:"#0b121b",border:"1px solid #263547",borderRadius:22,padding:24,color:"#eef4ff",fontFamily:"Inter,system-ui"}}><div style={{display:"flex",justifyContent:"space-between",gap:20,alignItems:"start"}}><div><div style={{fontSize:10,color:"#61e9a8",fontWeight:850,letterSpacing:".15em"}}>ENCRYPTED INTEGRATION VAULT</div><h2 style={{margin:"7px 0",fontSize:28}}>APIs direkt im EnergyRadar verbinden</h2><p style={{margin:0,color:"#8290a5",fontSize:13,lineHeight:1.55}}>Secrets werden serverseitig verschlüsselt gespeichert und nie wieder im Klartext ausgegeben.</p></div><button onClick={()=>setOpen(false)} style={{border:0,background:"#182230",color:"#fff",width:36,height:36,borderRadius:10,cursor:"pointer"}}>×</button></div>{message&&<div style={{marginTop:16,padding:10,borderRadius:10,background:"#10251c",color:"#69e8ad",fontSize:12}}>{message}</div>}<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:18}}><button disabled={!googleReady} onClick={()=>connect("google")} style={{border:"1px solid #304258",borderRadius:12,padding:13,background:"#121c28",color:googleReady?"#fff":"#596779",fontWeight:850,cursor:googleReady?"pointer":"not-allowed"}}>Google-Mailbox verbinden</button><button disabled={!microsoftReady} onClick={()=>connect("microsoft")} style={{border:"1px solid #304258",borderRadius:12,padding:13,background:"#121c28",color:microsoftReady?"#fff":"#596779",fontWeight:850,cursor:microsoftReady?"pointer":"not-allowed"}}>Microsoft-Mailbox verbinden</button></div><div style={{display:"grid",gap:12,marginTop:18}}>{fields.map(([key,label,type])=><form key={key} onSubmit={e=>void save(e,key)} style={{border:"1px solid #1e2b3a",borderRadius:14,padding:14,display:"grid",gridTemplateColumns:"minmax(170px,.8fr) minmax(200px,1.5fr) auto",gap:10,alignItems:"center"}}><div><strong style={{fontSize:12}}>{label}</strong><small style={{display:"block",marginTop:4,color:configured.has(key)?"#61e9a8":"#6e7b8e",fontSize:10}}>{configured.has(key)?"✓ gespeichert":"nicht hinterlegt"}</small></div><input name="value" type={type} placeholder={configured.has(key)?"Neuen Wert zum Ersetzen eingeben":"Wert eintragen"} style={{minWidth:0,border:"1px solid #29394b",background:"#080e15",color:"#fff",borderRadius:10,padding:"11px 12px"}}/><button style={{border:0,borderRadius:10,padding:"11px 14px",background:"#5de9a7",color:"#062117",fontWeight:900,cursor:"pointer"}}>Speichern</button></form>)}</div></div></div>}</>
}
