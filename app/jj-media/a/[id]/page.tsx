import { readState } from "@/lib/db";
import type { TravelIntelligenceResult } from "@/lib/travel-intelligence";
import TrackView from "./TrackView";
import TrackedCTA from "./TrackedCTA";
import TrackedVideo from "./TrackedVideo";

export const dynamic="force-dynamic";

type LeadAssets={website?:string;instagram?:string;youtube?:string;loomVideo?:string};
type Lead={id:string;company:string;contact:string;city:string;industry:string;travelScore:number;intentScore:number;travelIntelligence?:TravelIntelligenceResult;assets?:LeadAssets};
type Store={leads:Lead[];settings?:{companyName?:string;senderName?:string;calendarUrl?:string}};

function scoreTone(value:number){return value>=80?"#d8ff9f":value>=60?"#ffe19f":"#ffb1b1"}
function label(platform:string){return platform.charAt(0).toUpperCase()+platform.slice(1)}

export default async function JJMediaAnalysisPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  let lead:Lead|undefined;
  let settings:Store["settings"]={};
  try{
    const row=await readState("jj-media");
    const state=row?.payload as Store|undefined;
    lead=state?.leads?.find((item)=>item.id===id);
    settings=state?.settings||{};
  }catch{}
  if(!lead)return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#0b0b09",color:"#f4f1e8",fontFamily:"system-ui"}}><div>Analyse nicht gefunden.</div></main>;

  const intelligence=lead.travelIntelligence;
  const score=Math.round(Number(lead.travelScore||intelligence?.scores.opportunity||0));
  const opportunities=intelligence?.opportunities.slice(0,3)||[];
  const ideas=intelligence?.contentIdeas.slice(0,3)||[];
  const social=Object.entries(intelligence?.social||{}).filter(([,url])=>Boolean(url));
  const destinations=intelligence?.signals.destinations.slice(0,6)||[];
  const company=settings?.companyName||"JJ-Media";
  const sender=settings?.senderName||"JJ-Media";
  const heroAsset=lead.assets?.instagram||lead.assets?.website||"";

  return <main style={{minHeight:"100vh",background:"radial-gradient(circle at 80% 0%,rgba(183,255,112,.10),transparent 32%),radial-gradient(circle at 10% 18%,rgba(255,224,153,.08),transparent 24%),#0b0b09",color:"#f4f1e8",fontFamily:"Inter,ui-sans-serif,system-ui",padding:"28px 20px 56px"}}>
    <TrackView leadId={lead.id}/>
    <div style={{maxWidth:1120,margin:"0 auto"}}>
      <header style={{display:"flex",justifyContent:"space-between",gap:18,alignItems:"center",padding:"8px 0 44px"}}>
        <div style={{fontSize:12,letterSpacing:".18em",fontWeight:900}}>{company.toUpperCase()}</div>
        <div style={{fontSize:11,color:"#8f9087"}}>Travel Growth Snapshot · für {lead.company}</div>
      </header>

      <section style={{display:"grid",gridTemplateColumns:"minmax(0,1.18fr) minmax(260px,.82fr)",gap:26,alignItems:"stretch"}}>
        <div style={{border:"1px solid #292a24",borderRadius:34,padding:"clamp(28px,6vw,64px)",background:"linear-gradient(145deg,#141510,#0e0f0c)",position:"relative",overflow:"hidden"}}>
          <div style={{fontSize:10,fontWeight:900,letterSpacing:".16em",color:"#c7f893"}}>JJ-MEDIA · TRAVEL SOCIAL GROWTH</div>
          <h1 style={{fontSize:"clamp(42px,7.7vw,88px)",lineHeight:.94,letterSpacing:"-.065em",margin:"18px 0 22px",maxWidth:860}}>3 Content-Chancen für {lead.company}</h1>
          <p style={{fontSize:"clamp(16px,2vw,20px)",lineHeight:1.65,color:"#b0b1a7",maxWidth:760,margin:0}}>Wir haben öffentlich sichtbare Website- und Social-Signale priorisiert, um zu zeigen, wo bereits vorhandenes Reisematerial stärker in Aufmerksamkeit, Vertrauen und qualifizierte Reiseinteressenten übersetzt werden könnte.</p>
          <div style={{display:"flex",gap:9,flexWrap:"wrap",marginTop:28}}>{destinations.map((item)=><span key={item} style={{border:"1px solid #36382f",borderRadius:999,padding:"8px 12px",fontSize:11,color:"#d8d9cf"}}>{item}</span>)}</div>
        </div>
        <aside style={{border:"1px solid #30322a",borderRadius:34,padding:28,background:"#11120e",display:"flex",flexDirection:"column",justifyContent:"space-between",gap:24}}>
          <div><div style={{fontSize:10,color:"#85877c",letterSpacing:".14em",fontWeight:900}}>TRAVEL OPPORTUNITY</div><div style={{fontSize:"clamp(64px,9vw,112px)",fontWeight:900,lineHeight:.88,letterSpacing:"-.08em",color:scoreTone(score),marginTop:14}}>{score||"—"}</div><div style={{fontSize:12,color:"#77796f",marginTop:12}}>{score?"von 100 · Priorisierungssignal":"wird im Gespräch qualifiziert"}</div></div>
          <div style={{display:"grid",gap:9}}>{intelligence?[['Visual Assets',intelligence.scores.visualAssets],['Short-Form Gap',intelligence.scores.shortFormGap],['Social Proof',intelligence.scores.socialProof],['Channel Gap',intelligence.scores.channelGap]].map(([name,value])=><div key={String(name)} style={{display:"flex",justifyContent:"space-between",gap:12,paddingTop:10,borderTop:"1px solid #24251f",fontSize:12}}><span style={{color:"#92948a"}}>{name}</span><strong>{value}/100</strong></div>):null}</div>
        </aside>
      </section>

      {lead.assets?.loomVideo?<section style={{margin:"30px 0",border:"1px solid #2b2c26",borderRadius:30,padding:10,background:"#080906"}}><div style={{padding:"12px 14px 16px",fontSize:11,color:"#8d8f84",fontWeight:800}}>Persönliches Kurzvideo für {lead.company}</div><TrackedVideo leadId={lead.id} src={lead.assets.loomVideo}/></section>:heroAsset?<section style={{margin:"30px 0",border:"1px solid #2b2c26",borderRadius:30,padding:10,background:"#080906"}}><img src={heroAsset} alt={`Öffentlicher Auftritt von ${lead.company}`} style={{width:"100%",display:"block",borderRadius:22,maxHeight:640,objectFit:"cover"}}/></section>:null}

      <section style={{padding:"60px 0 20px"}}>
        <div style={{fontSize:10,fontWeight:900,letterSpacing:".16em",color:"#c7f893"}}>DIE STÄRKSTEN HEBEL</div>
        <h2 style={{fontSize:"clamp(32px,5vw,58px)",letterSpacing:"-.05em",margin:"10px 0 24px",maxWidth:780}}>Nicht mehr posten. Besser verwerten.</h2>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14}}>{opportunities.length?opportunities.map((item,index)=><article key={item.id} style={{border:"1px solid #292b24",borderRadius:26,padding:26,background:"#11120f"}}><span style={{display:"grid",placeItems:"center",width:34,height:34,borderRadius:999,background:"#d8ff9f",color:"#15170f",fontWeight:900,fontSize:12}}>0{index+1}</span><h3 style={{fontSize:23,letterSpacing:"-.025em",margin:"22px 0 10px"}}>{item.title}</h3><p style={{color:"#9b9d92",lineHeight:1.65,fontSize:13}}>{item.evidence}</p><div style={{marginTop:18,paddingTop:18,borderTop:"1px solid #25271f",fontSize:13,lineHeight:1.65,color:"#e0e2d7"}}>{item.angle}</div></article>):null}</div>
      </section>

      {ideas.length?<section style={{padding:"54px 0 14px"}}><div style={{fontSize:10,fontWeight:900,letterSpacing:".16em",color:"#ffe19f"}}>SO KÖNNTE DAS KONKRET AUSSEHEN</div><h2 style={{fontSize:"clamp(31px,4.6vw,52px)",letterSpacing:"-.045em",margin:"10px 0 24px"}}>3 sofort nutzbare Content-Ideen</h2><div style={{display:"grid",gap:12}}>{ideas.map((idea,index)=><div key={idea.hook} style={{display:"grid",gridTemplateColumns:"74px minmax(0,1fr) auto",gap:18,alignItems:"center",border:"1px solid #292b24",borderRadius:22,padding:20,background:"#10110e"}}><div style={{fontSize:28,fontWeight:900,color:"#686a60"}}>0{index+1}</div><div><strong style={{fontSize:18}}>{idea.hook}</strong><div style={{fontSize:12,color:"#85877c",marginTop:6}}>{idea.source}</div></div><span style={{fontSize:10,border:"1px solid #383a31",borderRadius:999,padding:"8px 10px",whiteSpace:"nowrap"}}>{idea.format}</span></div>)}</div></section>:null}

      <section style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(260px,.72fr)",gap:18,padding:"56px 0 0"}}>
        <div style={{border:"1px solid #292b24",borderRadius:28,padding:28,background:"#11120f"}}><div style={{fontSize:10,fontWeight:900,letterSpacing:".14em",color:"#c7f893"}}>PUBLIC SIGNALS</div><h3 style={{fontSize:26,margin:"10px 0 18px"}}>Was bereits da ist</h3><div style={{display:"flex",flexWrap:"wrap",gap:8}}>{social.length?social.map(([platform,url])=><a key={platform} href={String(url)} target="_blank" rel="noreferrer" style={{textDecoration:"none",color:"#e8eadf",border:"1px solid #34362d",borderRadius:999,padding:"9px 12px",fontSize:11}}>✓ {label(platform)}</a>):<span style={{color:"#85877c",fontSize:13}}>Social-Links werden im Audit ergänzt.</span>}</div><div style={{marginTop:22,display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10}}><div style={{padding:16,borderRadius:18,background:"#171813"}}><small style={{color:"#7f8176"}}>Reiseangebote</small><strong style={{display:"block",fontSize:24,marginTop:5}}>{intelligence?.signals.offerLinkCount||"—"}</strong></div><div style={{padding:16,borderRadius:18,background:"#171813"}}><small style={{color:"#7f8176"}}>Social-Kanäle</small><strong style={{display:"block",fontSize:24,marginTop:5}}>{social.length}</strong></div></div></div>
        <div style={{border:"1px solid #3b3e31",borderRadius:28,padding:28,background:"linear-gradient(145deg,#171a10,#11130e)"}}><div style={{fontSize:10,fontWeight:900,letterSpacing:".14em",color:"#d8ff9f"}}>NÄCHSTER SCHRITT</div><h3 style={{fontSize:31,lineHeight:1.08,letterSpacing:"-.04em",margin:"12px 0"}}>15 Minuten für die echte Einordnung.</h3><p style={{fontSize:13,lineHeight:1.65,color:"#a8aa9f",margin:"0 0 22px"}}>{sender} zeigt kurz, welche der Ideen für Ihre Zielgruppe tatsächlich Sinn ergeben. Wenn nichts davon relevant ist, wissen wir das danach ebenfalls.</p>{settings?.calendarUrl?<TrackedCTA leadId={lead.id} href={settings.calendarUrl}/>:<span style={{display:"inline-flex",padding:"12px 14px",border:"1px solid #3b3e31",borderRadius:999,color:"#cfd1c6",fontSize:12}}>Terminlink wird verbunden</span>}</div>
      </section>

      <footer style={{padding:"32px 0 0",fontSize:10.5,lineHeight:1.6,color:"#65675e"}}>Diese Voranalyse basiert auf öffentlich verfügbaren Informationen und optional manuell ergänzten Kennzahlen. Sie ist keine Garantie für Reichweite, Leads oder Umsatz; konkrete Potenziale werden erst nach Prüfung der tatsächlichen Ausgangslage bewertet.</footer>
    </div>
  </main>;
}
