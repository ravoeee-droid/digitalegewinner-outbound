"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { TravelIntelligenceResult, TravelManualSignals } from "@/lib/travel-intelligence";

type Stage="Neu"|"Kontaktiert"|"Engaged"|"Termin"|"Angebot"|"Gewonnen"|"Verloren";
type LeadAssets={website?:string;instagram?:string;youtube?:string;loomVideo?:string};
type Lead={id:string;company:string;contact:string;email:string;phone:string;website:string;city:string;industry:string;stage:Stage;dealValue:number;intentScore:number;travelScore:number;travelIntelligence?:TravelIntelligenceResult;emailStatus?:string;assets?:LeadAssets;captureStatus?:string;notes:string};
type Step={waitDays:number;subject:string;body:string;variants?:Array<{label:string;subject:string;body:string}>};
type Campaign={id:string;name:string;audience:string;status:"Entwurf"|"Aktiv"|"Pausiert";dailyLimit:number;steps:Step[];sent:number;replies:number;positive:number;appointments:number;filters?:{industry?:string;city?:string;minTravelScore?:number;minIntentScore?:number}};
type Mailbox={id:string;name:string;email:string;provider:"Google"|"Microsoft"|"SMTP";dailyLimit:number;sentToday:number;warmupDay:number;health:number;enabled:boolean;spf:boolean;dkim:boolean;dmarc:boolean};
type Settings={companyName:string;senderName:string;calendarUrl:string;timezone:string};
type Store={leads:Lead[];campaigns:Campaign[];mailboxes:Mailbox[];settings:Settings};
type Section="cockpit"|"leads"|"loom"|"campaigns"|"pipeline"|"setup";

const stages:Stage[]=["Neu","Kontaktiert","Engaged","Termin","Angebot","Gewonnen","Verloren"];
const nav:Array<{id:Section;label:string;icon:string}>=[
  {id:"cockpit",label:"Travel Cockpit",icon:"◉"},
  {id:"leads",label:"Travel Radar",icon:"⌁"},
  {id:"loom",label:"Loom Queue",icon:"▶"},
  {id:"campaigns",label:"Kampagnen",icon:"✦"},
  {id:"pipeline",label:"Pipeline",icon:"▦"},
  {id:"setup",label:"Setup",icon:"⚙"},
];
const starterCampaign:Campaign={
  id:"jj-travel-starter",
  name:"Travel Content Opportunity",
  audience:"Reiseveranstalter, Reisebüros und Erlebnisreise-Anbieter mit sichtbarem Content-Potenzial",
  status:"Entwurf",
  dailyLimit:120,
  sent:0,replies:0,positive:0,appointments:0,
  filters:{minTravelScore:65},
  steps:[
    {waitDays:0,subject:"Kurze Idee zu {{company}}",body:"Hallo {{first_name}},\n\nich habe mir {{company}} und Ihren öffentlichen Social-/Web-Auftritt kurz angesehen. Dabei sind mir ein paar konkrete Content-Chancen aufgefallen – ich habe sie hier kompakt vorbereitet:\n\n{{analysis_link}}\n\nWenn davon nichts relevant ist, können Sie die Seite einfach schließen.\n\nViele Grüße\n{{sender_name}}"},
    {waitDays:3,subject:"Re: Kurze Idee zu {{company}}",body:"Hallo {{first_name}},\n\nkurze Nachfrage zu meiner Analyse: Soll ich Ihnen die zwei stärksten Content-Ideen für {{company}} einfach direkt per Mail schicken?\n\nViele Grüße\n{{sender_name}}"},
    {waitDays:7,subject:"Re: {{company}}",body:"Hallo {{first_name}},\n\nfalls Social Media gerade keine Priorität hat, reicht ein kurzes „später“. Dann hake ich nicht weiter nach.\n\nViele Grüße\n{{sender_name}}"},
  ],
};
const fallback:Store={settings:{companyName:"JJ-Media",senderName:"JJ-Media",calendarUrl:"",timezone:"Europe/Berlin"},leads:[],mailboxes:[],campaigns:[starterCampaign]};

function uid(prefix:string){return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`}
function money(value:number){return new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(value)}
function scoreClass(value:number){return value>=80?"score score-hot":value>=60?"score score-warm":"score"}
function compact(value:number){return new Intl.NumberFormat("de-DE",{notation:"compact",maximumFractionDigits:1}).format(value)}
function platformCount(lead:Lead){return Object.values(lead.travelIntelligence?.social||{}).filter(Boolean).length}
function migrate(raw:Store):Store{return{...fallback,...raw,settings:{...fallback.settings,...(raw.settings||{})},leads:raw.leads||[],mailboxes:raw.mailboxes||[],campaigns:raw.campaigns?.length?raw.campaigns:[starterCampaign]}}

export default function JJMediaTravelOS(){
  const [section,setSection]=useState<Section>("cockpit");
  const [store,setStore]=useState<Store>(fallback);
  const [loaded,setLoaded]=useState(false);
  const [saving,setSaving]=useState(false);
  const [busyLead,setBusyLead]=useState("");
  const [toast,setToast]=useState("");
  const notify=(message:string)=>{setToast(message);window.setTimeout(()=>setToast(""),2800)};

  useEffect(()=>{void(async()=>{try{const response=await fetch("/api/jj-media/state");if(response.ok){const json=await response.json() as {state?:Store};if(json.state)setStore(migrate(json.state))}}catch{}finally{setLoaded(true)}})()},[]);
  useEffect(()=>{if(!loaded)return;const timer=window.setTimeout(()=>{void(async()=>{setSaving(true);try{await fetch("/api/jj-media/state",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(store)})}finally{setSaving(false)}})()},650);return()=>window.clearTimeout(timer)},[store,loaded]);

  const activeMailboxes=useMemo(()=>store.mailboxes.filter((mailbox)=>mailbox.enabled),[store.mailboxes]);
  const stats=useMemo(()=>{
    let scoreTotal=0,scored=0;
    for(const lead of store.leads){if(lead.travelScore>0){scoreTotal+=lead.travelScore;scored+=1}}
    return{
      leads:store.leads.length,
      hot:store.leads.filter((lead)=>lead.travelScore>=75||lead.intentScore>=75).length,
      avg:scored?Math.round(scoreTotal/scored):0,
      pipeline:store.leads.filter((lead)=>!["Gewonnen","Verloren"].includes(lead.stage)).reduce((sum,lead)=>sum+(lead.dealValue||0),0),
      appointments:store.leads.filter((lead)=>lead.stage==="Termin").length,
      capacity:activeMailboxes.reduce((sum,mailbox)=>sum+(mailbox.dailyLimit||0),0),
    };
  },[store.leads,activeMailboxes]);
  const ranked=useMemo(()=>store.leads.toSorted((a,b)=>(b.travelScore+b.intentScore)-(a.travelScore+a.intentScore)),[store.leads]);

  function patchLead(id:string,patch:Partial<Lead>){setStore((current)=>({...current,leads:current.leads.map((lead)=>lead.id===id?{...lead,...patch}:lead)}))}
  function stageLead(id:string,stage:Stage){patchLead(id,{stage})}

  async function addLead(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const form=event.currentTarget;
    const data=new FormData(form);
    const company=String(data.get("company")||"").trim();
    const website=String(data.get("website")||"").trim();
    if(!company||!website)return notify("Unternehmen und Website fehlen.");
    const manual:TravelManualSignals={
      instagramUrl:String(data.get("instagramUrl")||"").trim()||undefined,
      instagramFollowers:Number(data.get("instagramFollowers")||0)||undefined,
      instagramPosts90:Number(data.get("instagramPosts90")||0)||undefined,
      instagramReels90:Number(data.get("instagramReels90")||0)||undefined,
      reviewCount:Number(data.get("reviewCount")||0)||undefined,
      rating:Number(data.get("rating")||0)||undefined,
      lastPostDays:Number(data.get("lastPostDays")||0)||undefined,
    };
    setBusyLead("new");
    try{
      const [analysisResponse,enrichmentResponse]=await Promise.all([
        fetch("/api/jj-media/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({company,website,city:String(data.get("city")||""),manual})}),
        fetch("/api/leads/enrich",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({website})}),
      ]);
      const analysisJson=await analysisResponse.json() as {intelligence?:TravelIntelligenceResult;error?:string};
      if(!analysisResponse.ok||!analysisJson.intelligence)throw new Error(analysisJson.error||"Travel Audit fehlgeschlagen.");
      const enrichmentJson=enrichmentResponse.ok?await enrichmentResponse.json() as {contact?:{email?:string;phone?:string}}:{};
      let email=String(data.get("email")||"").trim()||("contact" in enrichmentJson?String(enrichmentJson.contact?.email||""):"");
      const phone=String(data.get("phone")||"").trim()||("contact" in enrichmentJson?String(enrichmentJson.contact?.phone||""):"");
      let emailStatus="";
      if(email){const verify=await fetch("/api/email/verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email})});if(verify.ok){const json=await verify.json() as {status?:string};emailStatus=json.status||""}}
      const intelligence=analysisJson.intelligence;
      const lead:Lead={
        id:uid("travel"),company,contact:String(data.get("contact")||""),email,phone,website,city:String(data.get("city")||""),industry:String(data.get("industry")||intelligence.niche),stage:"Neu",dealValue:Number(data.get("dealValue")||0),intentScore:0,travelScore:intelligence.scores.opportunity,travelIntelligence:intelligence,emailStatus,assets:{},notes:intelligence.opportunities[0]?.angle||"",
      };
      setStore((current)=>({...current,leads:[lead,...current.leads]}));
      form.reset();
      notify(`${company}: Travel Opportunity ${lead.travelScore}/100`);
    }catch(error){notify(error instanceof Error?error.message:"Lead konnte nicht analysiert werden.")}
    finally{setBusyLead("")}
  }

  async function refreshLead(lead:Lead){
    setBusyLead(lead.id);
    try{
      const response=await fetch("/api/jj-media/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({company:lead.company,website:lead.website,city:lead.city,manual:lead.travelIntelligence?.manual||{}})});
      const json=await response.json() as {intelligence?:TravelIntelligenceResult;error?:string};
      if(!response.ok||!json.intelligence)throw new Error(json.error||"Audit fehlgeschlagen.");
      patchLead(lead.id,{travelIntelligence:json.intelligence,travelScore:json.intelligence.scores.opportunity,notes:json.intelligence.opportunities[0]?.angle||lead.notes});
      notify("Travel Intelligence aktualisiert.");
    }catch(error){notify(error instanceof Error?error.message:"Aktualisierung fehlgeschlagen.")}
    finally{setBusyLead("")}
  }

  async function captureLead(lead:Lead){
    setBusyLead(lead.id);
    patchLead(lead.id,{captureStatus:"queued"});
    try{
      const response=await fetch("/api/jj-media/capture",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({leadId:lead.id,company:lead.company,website:lead.travelIntelligence?.finalUrl||lead.website,social:lead.travelIntelligence?.social||{},scenes:lead.travelIntelligence?.loom.scenes||[]})});
      const json=await response.json() as {assets?:LeadAssets;status?:string;error?:string};
      if(!response.ok)throw new Error(json.error||"Browser Capture fehlgeschlagen.");
      patchLead(lead.id,{assets:{...(lead.assets||{}),...(json.assets||{})},captureStatus:json.status||"ready"});
      notify(json.status==="accepted"?"Capture Worker hat den Auftrag angenommen.":"Social-/Website-Captures erstellt.");
    }catch(error){patchLead(lead.id,{captureStatus:"error"});notify(error instanceof Error?error.message:"Capture fehlgeschlagen.")}
    finally{setBusyLead("")}
  }

  function addMailbox(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=event.currentTarget;const data=new FormData(form);const email=String(data.get("email")||"").trim();if(!email.includes("@"))return notify("Gültige Mailbox-E-Mail fehlt.");
    const mailbox:Mailbox={id:String(data.get("id")||uid("mb")),name:String(data.get("name")||"Mailbox"),email,provider:String(data.get("provider")||"Google") as Mailbox["provider"],dailyLimit:5,sentToday:0,warmupDay:1,health:60,enabled:true,spf:false,dkim:false,dmarc:false};
    setStore((current)=>({...current,mailboxes:[...current.mailboxes,mailbox]}));form.reset();notify("Mailbox angelegt · Startlimit 5/Tag");
  }
  async function domainCheck(mailbox:Mailbox){const domain=mailbox.email.split("@")[1];const response=await fetch("/api/domain/health",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({domain})});const json=await response.json() as {spf?:boolean;dmarc?:boolean;score?:number;error?:string};if(!response.ok)return notify(json.error||"Domain Check fehlgeschlagen.");setStore((current)=>({...current,mailboxes:current.mailboxes.map((item)=>item.id===mailbox.id?{...item,spf:Boolean(json.spf),dmarc:Boolean(json.dmarc),health:Math.max(item.health,json.score||0)}:item)}));notify(`${domain}: SPF ${json.spf?"OK":"fehlt"} · DMARC ${json.dmarc?"OK":"fehlt"}`)}
  function ramp(id:string){setStore((current)=>({...current,mailboxes:current.mailboxes.map((mailbox)=>{if(mailbox.id!==id)return mailbox;const day=mailbox.warmupDay+1;const dailyLimit=day<4?5:day<7?10:day<11?15:day<15?20:day<19?25:30;return{...mailbox,warmupDay:day,dailyLimit}})}))}

  async function launch(campaign:Campaign){
    const leads=store.leads.filter((lead)=>lead.email&&!["Gewonnen","Verloren"].includes(lead.stage));
    if(!leads.length)return notify("Keine versandfähigen Travel-Leads.");
    if(!activeMailboxes.length)return notify("Keine aktive Mailbox.");
    const response=await fetch("/api/jj-media/campaigns/launch",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({campaign,leads,mailboxes:store.mailboxes,senderName:store.settings.senderName})});
    const json=await response.json() as {queued?:number;skipped?:number;error?:string};
    if(!response.ok)return notify(json.error||"Kampagnenstart fehlgeschlagen.");
    setStore((current)=>({...current,campaigns:current.campaigns.map((item)=>item.id===campaign.id?{...item,status:"Aktiv"}:item)}));
    notify(`${json.queued||0} Sequenzschritte geplant · ${json.skipped||0} übersprungen`);
  }
  function saveSettings(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);setStore((current)=>({...current,settings:{companyName:String(data.get("companyName")||"JJ-Media"),senderName:String(data.get("senderName")||"JJ-Media"),calendarUrl:String(data.get("calendarUrl")||""),timezone:String(data.get("timezone")||"Europe/Berlin")}}));notify("JJ-Media Setup gespeichert.")}

  const metric=(label:string,value:string|number,sub:string)=><div className="metric"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">JJ</span><div><strong>JJ-Media</strong><small>Travel Growth OS</small></div></div>
      <nav>{nav.map((item)=><button key={item.id} className={`nav-item ${section===item.id?"active":""}`} onClick={()=>setSection(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>
      <div className="sidebar-foot"><i className="health-dot"/><span>{saving?"Speichert…":"Travel OS online"}</span><small>Workspace · jj-media</small></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><div><small>JJ-MEDIA · TRAVEL SOCIAL REVENUE ENGINE</small><h1>{nav.find((item)=>item.id===section)?.label}</h1></div><div className="top-actions"><span className="live-pill">● LIVE</span><div className="avatar">JJ</div></div></header>
      <div className="content">
        {section==="cockpit"&&<>
          <div className="hero-grid"><div className="hero-card"><div><span className="eyebrow">TRAVEL OPPORTUNITY</span><h2>{stats.hot} Leads mit starkem Social-Media-Hebel.</h2><p>Website, Social Presence, Short-Form-Gap, Kundenproof und Content-Rohmaterial werden zu einer priorisierten Sales-Story verdichtet.</p></div><div className="hero-number">{stats.hot}<small>PRIORITY LEADS</small></div></div><div className="capacity-card"><span>Outbound Kapazität</span><strong>{stats.capacity}/Tag</strong><div className="progress"><i style={{width:`${Math.min(100,stats.capacity)}%`}}/></div><small>kontrolliertes Mailbox Ramp-up · Stop-on-Reply</small></div></div>
          <div className="metric-grid">{metric("Travel Leads",stats.leads,"analysiert")}{metric("Ø Opportunity",stats.avg?`${stats.avg}/100`:"—","Travel Score")}{metric("Pipeline",money(stats.pipeline),"offen")}{metric("Termine",stats.appointments,"gebucht")}</div>
          <div className="panel"><div className="panel-head"><div><h3>Priority Queue</h3><p>Travel Opportunity + Intent zuerst</p></div></div><div className="lead-list">{ranked.length?ranked.slice(0,8).map((lead)=><div className="lead-row" key={lead.id}><div><strong>{lead.company}</strong><small>{lead.travelIntelligence?.niche||lead.industry} · {platformCount(lead)} Social-Kanäle</small></div><span className={scoreClass(lead.travelScore)}>T {lead.travelScore}</span><span className={scoreClass(lead.intentScore)}>I {lead.intentScore}</span><select value={lead.stage} onChange={(event)=>stageLead(lead.id,event.target.value as Stage)}>{stages.map((stage)=><option key={stage}>{stage}</option>)}</select></div>):<div className="callout">Noch keine Travel-Leads. Im Travel Radar Website + Social-Signale analysieren.</div>}</div></div>
        </>}

        {section==="leads"&&<div className="two-col wide-left">
          <div className="panel"><div className="panel-head"><div><h3>Travel Intelligence</h3><p>Content Assets · Social Proof · Short-Form Gap · Distribution</p></div></div><div className="lead-list">{ranked.map((lead)=>{const intelligence=lead.travelIntelligence;return <article key={lead.id} className="panel" style={{marginBottom:14}}><div className="panel-head"><div><h3>{lead.company}</h3><p>{intelligence?.niche||lead.industry} · {lead.city||"Ort offen"}</p></div><div style={{display:"flex",gap:8,alignItems:"center"}}><span className={scoreClass(lead.travelScore)}>{lead.travelScore}/100</span><button className="ghost" disabled={busyLead===lead.id} onClick={()=>void refreshLead(lead)}>{busyLead===lead.id?"Analysiert…":"Neu analysieren"}</button></div></div>{intelligence?<><div className="metric-grid" style={{gridTemplateColumns:"repeat(4,minmax(0,1fr))"}}>{metric("Visual Assets",intelligence.scores.visualAssets,"Material")}{metric("Short-Form Gap",intelligence.scores.shortFormGap,"Chance")}{metric("Social Proof",intelligence.scores.socialProof,"Vertrauen")}{metric("Channel Gap",intelligence.scores.channelGap,"Distribution")}</div><div className="split" style={{alignItems:"start"}}><div><span className="eyebrow">TOP OPPORTUNITIES</span>{intelligence.opportunities.slice(0,3).map((item)=><div className="callout" key={item.id}><strong>{item.title}</strong><br/><small>{item.angle}</small></div>)}</div><div><span className="eyebrow">SOCIAL MAP</span><div style={{display:"flex",flexWrap:"wrap",gap:7,marginTop:10}}>{Object.entries(intelligence.social).map(([platform,url])=><span key={platform} className={url?"live-pill":"score"}>{url?"✓":"–"} {platform}</span>)}</div><span className="eyebrow" style={{display:"block",marginTop:18}}>DESTINATIONEN</span><p style={{color:"var(--muted)"}}>{intelligence.signals.destinations.slice(0,6).join(" · ")||"werden aus Angeboten abgeleitet"}</p></div></div></>:null}</article>})}</div>
          <form className="panel form-panel" onSubmit={addLead}><div className="panel-head"><div><h3>Neuer Travel Lead</h3><p>Website reicht · Social-Daten sind optional</p></div></div><label>Unternehmen<input name="company" required/></label><label>Website<input name="website" placeholder="https://…" required/></label><div className="split"><label>Kontakt<input name="contact"/></label><label>Stadt<input name="city"/></label></div><label>E-Mail<input name="email" type="email"/></label><label>Telefon<input name="phone"/></label><label>Branche<input name="industry" placeholder="z. B. Motorradreisen"/></label><label>Instagram URL<input name="instagramUrl" placeholder="optional"/></label><div className="split"><label>Follower<input name="instagramFollowers" type="number" min="0"/></label><label>Posts 90 Tage<input name="instagramPosts90" type="number" min="0"/></label></div><div className="split"><label>Reels 90 Tage<input name="instagramReels90" type="number" min="0"/></label><label>Letzter Post vor Tagen<input name="lastPostDays" type="number" min="0"/></label></div><div className="split"><label>Google Reviews<input name="reviewCount" type="number" min="0"/></label><label>Rating<input name="rating" type="number" min="0" max="5" step="0.1"/></label></div><label>Pot. Dealwert €<input name="dealValue" type="number" min="0"/></label><button className="primary" disabled={busyLead==="new"}>{busyLead==="new"?"Travel Intelligence läuft…":"Analysieren & speichern"}</button></form>
        </div>}

        {section==="loom"&&<div className="panel"><div className="panel-head"><div><h3>Personalized Loom Queue</h3><p>echte Website-/Social-Szenen statt generischer Fake-Personalisierung</p></div></div><div className="lead-list">{ranked.map((lead)=>{const scenes=lead.travelIntelligence?.loom.scenes||[];return <article key={lead.id} className="panel" style={{marginBottom:14}}><div className="panel-head"><div><h3>{lead.company}</h3><p>{lead.travelIntelligence?.loom.opener||"Noch keine Loom-Story"}</p></div><button className="primary" disabled={busyLead===lead.id} onClick={()=>void captureLead(lead)}>{busyLead===lead.id?"Capture läuft…":"Social + Website capturen"}</button></div><div style={{display:"grid",gap:8}}>{scenes.map((scene)=><div className="lead-row" key={`${scene.start}-${scene.source}`}><span className="score">{scene.start}–{scene.end}s</span><div><strong>{scene.source.toUpperCase()} · {scene.visual}</strong><small>{scene.voiceover}</small></div></div>)}</div><div style={{marginTop:12,color:"var(--muted)",fontSize:12}}>Capture: {lead.captureStatus||"noch nicht gestartet"}{lead.assets?.loomVideo?" · Loom-Video bereit":""}</div></article>})}</div></div>}

        {section==="campaigns"&&<div className="panel"><div className="panel-head"><div><h3>Travel Campaign Engine</h3><p>Opportunity Score Filter · A/B-ready · Stop-on-Reply</p></div></div>{store.campaigns.map((campaign)=><article className="panel" key={campaign.id} style={{marginBottom:14}}><div className="panel-head"><div><h3>{campaign.name}</h3><p>{campaign.audience}</p></div><span className={campaign.status==="Aktiv"?"live-pill":"score"}>{campaign.status}</span></div><div className="metric-grid">{metric("Minimum Score",campaign.filters?.minTravelScore||0,"Travel Opportunity")}{metric("Tageslimit",campaign.dailyLimit,"Kampagne")}{metric("Replies",campaign.replies,"Antworten")}{metric("Termine",campaign.appointments,"gebucht")}</div><div style={{display:"grid",gap:8}}>{campaign.steps.map((step,index)=><div className="lead-row" key={`${campaign.id}-${index}`}><span className="score">Tag {step.waitDays}</span><div><strong>{step.subject}</strong><small>{step.body.slice(0,130)}{step.body.length>130?"…":""}</small></div></div>)}</div><button className="primary" style={{marginTop:14}} onClick={()=>void launch(campaign)}>Kampagne starten</button></article>)}</div>}

        {section==="pipeline"&&<div className="panel"><div className="panel-head"><div><h3>Travel Sales Pipeline</h3><p>Intent aus Microsite, Video, CTA und Replies fließt zurück</p></div></div><div style={{display:"grid",gridTemplateColumns:"repeat(7,minmax(180px,1fr))",gap:10,overflowX:"auto"}}>{stages.map((stage)=><div key={stage}><div className="eyebrow" style={{marginBottom:10}}>{stage}</div>{store.leads.filter((lead)=>lead.stage===stage).map((lead)=><div className="callout" key={lead.id}><strong>{lead.company}</strong><br/><small>Travel {lead.travelScore} · Intent {lead.intentScore}<br/>{money(lead.dealValue||0)}</small></div>)}</div>)}</div></div>}

        {section==="setup"&&<div className="two-col wide-left"><div className="panel"><div className="panel-head"><div><h3>Mailbox Fleet</h3><p>Credential-ID muss zum verschlüsselten Mailbox-Zugang passen</p></div></div>{store.mailboxes.map((mailbox)=><div className="lead-row" key={mailbox.id}><div><strong>{mailbox.name}</strong><small>{mailbox.email} · Tag {mailbox.warmupDay} · {mailbox.dailyLimit}/Tag</small></div><span className={scoreClass(mailbox.health)}>{mailbox.health}%</span><button className="ghost" onClick={()=>void domainCheck(mailbox)}>DNS</button><button className="ghost" onClick={()=>ramp(mailbox.id)}>Ramp +1</button></div>)}<form className="form-panel" onSubmit={addMailbox} style={{marginTop:18}}><div className="split"><label>Credential-ID<input name="id" required placeholder="mb-jj-01"/></label><label>Name<input name="name" required placeholder="JJ Sales 01"/></label></div><label>E-Mail<input name="email" type="email" required/></label><label>Provider<select name="provider"><option>Google</option><option>Microsoft</option><option>SMTP</option></select></label><button className="primary">Mailbox hinzufügen</button></form></div><form className="panel form-panel" onSubmit={saveSettings}><div className="panel-head"><div><h3>JJ-Media Workspace</h3><p>Branding + Termin-CTA</p></div></div><label>Unternehmen<input name="companyName" defaultValue={store.settings.companyName}/></label><label>Absender<input name="senderName" defaultValue={store.settings.senderName}/></label><label>Kalender URL<input name="calendarUrl" defaultValue={store.settings.calendarUrl}/></label><label>Timezone<input name="timezone" defaultValue={store.settings.timezone}/></label><button className="primary">Setup speichern</button></form></div>}
      </div>
      {toast?<div className="toast">{toast}</div>:null}
    </section>
  </main>;
}
