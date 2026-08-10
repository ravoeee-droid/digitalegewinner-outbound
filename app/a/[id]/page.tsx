import { readState } from "@/lib/db";

export const dynamic = "force-dynamic";

type Lead={id:string;company:string;contact:string;city:string;industry:string;roofArea:number;energyScore:number;notes:string};
type Store={leads:Lead[];settings?:{companyName?:string;senderName?:string;calendarUrl?:string}};

export default async function AnalysisPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  let lead:Lead|undefined;let settings:Store["settings"]={};
  try{const row=await readState();const state=row?.payload as Store|undefined;lead=state?.leads?.find((x)=>x.id===id);settings=state?.settings||{};}catch{}
  if(!lead)return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#070b12",color:"#fff",fontFamily:"system-ui"}}><div>Analyse nicht gefunden.</div></main>;
  const company=settings?.companyName||"Walkenhorst Energie";
  const sender=settings?.senderName||"Ihr Energieberater";
  return <main style={{minHeight:"100vh",background:"radial-gradient(circle at 80% 0%,rgba(61,239,160,.12),transparent 30%),#070b12",color:"#eef4ff",fontFamily:"Inter,system-ui",padding:"48px 20px"}}>
    <div style={{maxWidth:980,margin:"0 auto"}}>
      <div style={{fontSize:12,letterSpacing:".18em",color:"#63eaaa",fontWeight:800}}>{company.toUpperCase()} · VORANALYSE</div>
      <h1 style={{fontSize:"clamp(36px,7vw,72px)",lineHeight:.98,letterSpacing:"-.05em",maxWidth:850,margin:"22px 0"}}>Energie-Potenzial für {lead.company}</h1>
      <p style={{maxWidth:720,color:"#95a2b7",fontSize:18,lineHeight:1.65}}>Wir haben öffentlich verfügbare Unternehmens- und Gebäudedaten für eine erste Vertriebs-Vorabschätzung zusammengeführt. Diese Analyse ersetzt keine technische Planung.</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:14,margin:"36px 0"}}>
        {[['Energy Score',`${lead.energyScore}/100`],['Standort',lead.city||'—'],['Branche',lead.industry||'—'],['Dachfläche',lead.roofArea?`ca. ${lead.roofArea.toLocaleString('de-DE')} m²`:'noch offen']].map(([k,v])=><div key={k} style={{border:"1px solid #1f2b3b",borderRadius:18,padding:22,background:"#0d141f"}}><small style={{color:"#738097",textTransform:"uppercase",letterSpacing:'.1em'}}>{k}</small><strong style={{display:"block",fontSize:26,marginTop:8}}>{v}</strong></div>)}
      </div>
      <section style={{border:"1px solid #1f2b3b",borderRadius:22,padding:28,background:"#0b121c"}}><div style={{color:"#62e9a8",fontSize:12,fontWeight:800}}>WARUM INTERESSANT</div><h2 style={{fontSize:30,margin:"10px 0"}}>Welche Hebel sich typischerweise prüfen lassen</h2><p style={{color:"#95a2b7",lineHeight:1.7}}>Gewerbe-PV, Eigenverbrauch, Speicher, Energiemanagement, Ladeinfrastruktur und gegebenenfalls Fördermöglichkeiten. Welche Maßnahmen wirtschaftlich und technisch sinnvoll sind, hängt von Lastprofil, Dachstatik, Netzanschluss und realen Verbrauchsdaten ab.</p>{lead.notes&&<p style={{color:"#c8d1df",lineHeight:1.7}}>{lead.notes}</p>}</section>
      <div style={{marginTop:22,border:"1px solid #28543f",borderRadius:22,padding:28,background:"#0d1b15"}}><h2 style={{fontSize:28,margin:"0 0 8px"}}>15 Minuten für die reale Einordnung</h2><p style={{color:"#9cb8aa"}}>{sender} kann die Vorabschätzung mit Ihren echten Verbrauchs- und Gebäudedaten abgleichen.</p>{settings?.calendarUrl?<a href={settings.calendarUrl} style={{display:"inline-block",marginTop:10,padding:"14px 18px",borderRadius:12,background:"#5eeaa7",color:"#062116",fontWeight:900,textDecoration:"none"}}>Termin auswählen</a>:<span style={{display:"inline-block",marginTop:10,color:"#68e9aa"}}>Terminlink wird noch verbunden.</span>}</div>
      <p style={{color:"#566375",fontSize:11,lineHeight:1.6,marginTop:24}}>Hinweis: Alle automatischen Potenzialwerte sind unverbindliche Vorabschätzungen und keine technische, wirtschaftliche oder förderrechtliche Zusage.</p>
    </div>
  </main>
}
