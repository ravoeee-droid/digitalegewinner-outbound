import { readState } from "@/lib/db";
import TrackView from "./TrackView";
import TrackedCTA from "./TrackedCTA";

export const dynamic = "force-dynamic";

type Priority={rank:number;title:string;why:string;action:string;expectedImpact:string};
type WebsiteAudit={scores?:{overall?:number;conversion?:number;trust?:number;seo?:number;technical?:number;content?:number};priorities?:Priority[];sales?:{opportunitySummary?:string}};
type Lead={
  id:string;company:string;contact:string;city:string;industry:string;intentScore?:number;websiteScore?:number;websiteAudit?:WebsiteAudit;videoUrl?:string;
  recruitingOpportunityScore?:number;recruitingMaturityScore?:number;recruitingLevel?:string;recruitingGaps?:string[];recommendedOffer?:string;
};
type Store={leads:Lead[];settings?:{companyName?:string;senderName?:string;calendarUrl?:string}};

function scoreColor(value:number){return value>=80?"#62e9a8":value>=60?"#f1cc72":"#ff8f96"}

export default async function AnalysisPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  let lead:Lead|undefined;let settings:Store["settings"]={};
  try{const row=await readState();const state=row?.payload as Store|undefined;lead=state?.leads?.find((x)=>x.id===id);settings=state?.settings||{};}catch{}
  if(!lead)return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#070b12",color:"#fff",fontFamily:"system-ui"}}><div>Analyse nicht gefunden.</div></main>;

  const brand=settings?.companyName?.trim()||"Pflege Recruiting";
  const sender=settings?.senderName?.trim()||"Ihr Ansprechpartner";
  const audit=lead.websiteAudit;
  const websiteScore=Math.round(Number(lead.websiteScore||audit?.scores?.overall||0));
  const recruitingOpportunity=Math.round(Number(lead.recruitingOpportunityScore||0));
  const recruitingMaturity=Math.round(Number(lead.recruitingMaturityScore||0));
  const opportunity=recruitingOpportunity||Math.max(websiteScore,Number(lead.intentScore||0));
  const gaps=(lead.recruitingGaps||[]).slice(0,3);
  const genericPriorities=(audit?.priorities||[]).slice(0,3);
  const summary=recruitingOpportunity
    ? `Wir haben den öffentlich sichtbaren digitalen Bewerber-Einstieg von ${lead.company} analysiert. Der Recruiting-Opportunity-Score zeigt, wie viel Optimierungspotenzial aktuell in Karriere-Kommunikation, Bewerbungsweg und Vertrauen sichtbar ist.`
    : audit?.sales?.opportunitySummary||`Für ${lead.company} haben wir öffentlich verfügbare Informationen in einer kompakten Voranalyse zusammengeführt. Im Gespräch lässt sich schnell prüfen, welche Recruiting-Hebel tatsächlich relevant sind.`;
  const scores:Array<[string,number]>=[
    ["Recruiting Opportunity",opportunity],
    ["Recruiting-Reife",recruitingMaturity],
    ["Website",websiteScore],
    ["Intent",Math.round(Number(lead.intentScore||0))],
  ].filter(([,value])=>Number(value)>0) as Array<[string,number]>;

  const carePriorities=gaps.map((gap,index)=>({
    rank:index+1,
    title:index===0?"Bewerber-Einstieg":index===1?"Employer Branding":"Bewerbungs-Conversion",
    why:gap,
    action:index===0?"Den Einstieg für Pflegefachkräfte klarer und unmittelbarer gestalten.":index===1?"Arbeitgebervorteile und glaubwürdigen Mitarbeiter-Proof sichtbar machen.":"Den Weg von Interesse zur Bewerbung mobil und reibungsarm verkürzen.",
  }));
  const priorities=carePriorities.length?carePriorities:genericPriorities.map(item=>({rank:item.rank,title:item.title,why:item.why,action:item.action}));

  return <main style={{minHeight:"100vh",background:"radial-gradient(circle at 82% 0%,rgba(61,239,160,.12),transparent 30%),radial-gradient(circle at 10% 25%,rgba(88,130,255,.08),transparent 28%),#070b12",color:"#eef4ff",fontFamily:"Inter,system-ui",padding:"44px 20px"}}>
    <TrackView leadId={lead.id}/>
    <div style={{maxWidth:1040,margin:"0 auto"}}>
      <header style={{display:"flex",justifyContent:"space-between",gap:18,alignItems:"center",marginBottom:46}}><div style={{fontSize:12,letterSpacing:".18em",color:"#63eaaa",fontWeight:900}}>{brand.toUpperCase()} · PERSÖNLICHE RECRUITING-ANALYSE</div><div style={{fontSize:11,color:"#5f6d80"}}>für {lead.company}</div></header>

      <section style={{display:"grid",gridTemplateColumns:"minmax(0,1.25fr) minmax(260px,.75fr)",gap:30,alignItems:"end"}}><div><div style={{display:"inline-block",padding:"7px 10px",border:"1px solid #244234",borderRadius:999,color:"#77ebb5",fontSize:10,fontWeight:800,letterSpacing:".08em"}}>PFLEGE RECRUITING · KURZANALYSE</div><h1 style={{fontSize:"clamp(38px,7vw,76px)",lineHeight:.98,letterSpacing:"-.055em",maxWidth:860,margin:"18px 0"}}>Digitale Bewerber-Hebel für {lead.company}</h1><p style={{maxWidth:730,color:"#99a6b9",fontSize:18,lineHeight:1.65,margin:0}}>{summary}</p></div><div style={{border:"1px solid #243247",borderRadius:22,padding:22,background:"linear-gradient(145deg,#0d1622,#091019)"}}><small style={{color:"#718097",textTransform:"uppercase",letterSpacing:".12em"}}>Recruiting Opportunity</small><strong style={{display:"block",fontSize:54,lineHeight:1,marginTop:10,color:scoreColor(opportunity)}}>{opportunity||"—"}</strong><span style={{fontSize:12,color:"#647287"}}>{opportunity?"von 100":"wird im Gespräch qualifiziert"}</span></div></section>

      {lead.videoUrl&&<section style={{margin:"34px 0",border:"1px solid #223244",borderRadius:24,padding:10,background:"#05080d",overflow:"hidden",boxShadow:"0 30px 80px rgba(0,0,0,.28)"}}><div style={{padding:"10px 12px 14px",fontSize:11,color:"#738198",fontWeight:700}}>Persönliches Kurzvideo für {lead.company}</div><video controls preload="metadata" src={lead.videoUrl} style={{width:"100%",display:"block",borderRadius:16,aspectRatio:"16/9",background:"#000"}}/></section>}

      {scores.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(175px,1fr))",gap:12,margin:"34px 0"}}>{scores.map(([label,value])=><div key={label} style={{border:"1px solid #1f2b3b",borderRadius:17,padding:19,background:"#0c141e"}}><small style={{color:"#728096",textTransform:"uppercase",letterSpacing:".1em"}}>{label}</small><strong style={{display:"block",fontSize:28,marginTop:7,color:scoreColor(value)}}>{value}/100</strong></div>)}</div>}

      <section style={{marginTop:32}}><div style={{color:"#62e9a8",fontSize:11,fontWeight:900,letterSpacing:".13em"}}>DIE WICHTIGSTEN BEWERBER-HEBEL</div><h2 style={{fontSize:"clamp(28px,4vw,42px)",margin:"9px 0 20px",letterSpacing:"-.035em"}}>Was im digitalen Recruiting auffällt</h2><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(250px,1fr))",gap:14}}>{priorities.length?priorities.map((item,index)=><article key={`${item.rank}-${item.title}`} style={{border:"1px solid #202d3e",borderRadius:20,padding:22,background:"#0b131d"}}><span style={{display:"grid",placeItems:"center",width:30,height:30,borderRadius:9,background:"#10251c",color:"#64eaaa",fontWeight:900,fontSize:12}}>{index+1}</span><h3 style={{fontSize:19,margin:"16px 0 8px"}}>{item.title}</h3><p style={{color:"#8997aa",fontSize:13,lineHeight:1.6}}>{item.why}</p><div style={{marginTop:14,paddingTop:14,borderTop:"1px solid #1d2937",color:"#cbd5e2",fontSize:12,lineHeight:1.55}}>{item.action}</div></article>):[
        ["Karriere-Einstieg","Ist für Pflegefachkräfte sofort klar, wo sie Informationen zum Arbeitgeber und zu offenen Stellen finden?"],
        ["Schnellbewerbung","Kann eine interessierte Pflegekraft mobil und ohne unnötige Hürden den ersten Schritt machen?"],
        ["Arbeitgeber-Vertrauen","Sind Team, Benefits, Arbeitsalltag und echte Stimmen sichtbar genug, um einen Wechsel attraktiv zu machen?"],
      ].map(([title,text],index)=><article key={title} style={{border:"1px solid #202d3e",borderRadius:20,padding:22,background:"#0b131d"}}><span style={{display:"grid",placeItems:"center",width:30,height:30,borderRadius:9,background:"#10251c",color:"#64eaaa",fontWeight:900,fontSize:12}}>{index+1}</span><h3 style={{fontSize:19,margin:"16px 0 8px"}}>{title}</h3><p style={{color:"#8997aa",fontSize:13,lineHeight:1.6}}>{text}</p></article>)}</div></section>

      {lead.recommendedOffer&&<section style={{marginTop:20,border:"1px solid #26384a",borderRadius:18,padding:20,background:"#0b141e"}}><small style={{color:"#7e91aa",fontWeight:900,letterSpacing:".1em"}}>PASSENDER NÄCHSTER HEBEL</small><strong style={{display:"block",marginTop:8,fontSize:18}}>{lead.recommendedOffer}</strong></section>}

      <section style={{marginTop:30,border:"1px solid #28543f",borderRadius:24,padding:"clamp(24px,5vw,38px)",background:"linear-gradient(135deg,#0d1b15,#0b1615)"}}><div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",gap:24,alignItems:"center"}}><div><div style={{color:"#67e9aa",fontSize:10,fontWeight:900,letterSpacing:".12em"}}>NÄCHSTER SCHRITT</div><h2 style={{fontSize:"clamp(27px,4vw,40px)",margin:"8px 0"}}>15 Minuten für die echte Einordnung</h2><p style={{color:"#9cb8aa",lineHeight:1.65,margin:0,maxWidth:700}}>{sender} zeigt Ihnen die wichtigsten Punkte kurz am Bildschirm. Wenn aktuell kein sinnvoller Recruiting-Hebel da ist, wissen wir das danach ebenfalls.</p></div>{settings?.calendarUrl?<TrackedCTA leadId={lead.id} href={settings.calendarUrl}/>:<span style={{display:"inline-block",padding:"12px 14px",border:"1px solid #29523f",borderRadius:11,color:"#68e9aa"}}>Terminlink wird verbunden</span>}</div></section>
      <p style={{color:"#536074",fontSize:11,lineHeight:1.6,marginTop:24}}>Hinweis: Die Analyse basiert auf öffentlich verfügbaren Informationen und dient als unverbindliche Ersteinschätzung. Der Opportunity-Score beschreibt sichtbares Optimierungspotenzial, nicht garantierte Bewerberzahlen oder Ergebnisse.</p>
    </div>
  </main>
}
