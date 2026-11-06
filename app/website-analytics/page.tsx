import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

type Overview = {
  events:number;sessions:number;video_starts:number;video_50:number;video_90:number;
  video_complete:number;booking_clicks:number;whatsapp_clicks:number;lead_intents:number;
};
type Activity = {id:number;created_at:string;lead_id:string|null;type:string;meta:{
  watch_seconds?:number;campaign?:Record<string,string>;details?:Record<string,string|number|boolean>
}|null};

const pad:React.CSSProperties={padding:"18px 20px",border:"1px solid #dbe4e0",borderRadius:16,background:"#fff",boxShadow:"0 7px 24px rgba(0,0,0,.03)"};
const n=(x:unknown)=>Number(x||0).toLocaleString("de-DE");
const simple=(x:unknown)=>String(x??"—").slice(0,120);
const nice=(x:string)=>({
  page_view:"Seite aufgerufen",section_view:"Abschnitt angesehen",cta_click:"CTA geklickt",
  booking_click:"Kalender geklickt",whatsapp_click:"WhatsApp geklickt",
  video_play:"Video gestartet",video_pause:"Video pausiert",video_milestone:"Video-Meilenstein",
  video_complete:"Video beendet",funnel_step:"Formular-Schritt",funnel_progress:"Recruiting-Check",
  funnel_interaction:"Check-Interaktion",lead_intent:"Kontaktformular-Absicht"
} as Record<string,string>)[x]||x;

export default async function WebsiteAnalytics(){
  let overview:Overview={events:0,sessions:0,video_starts:0,video_50:0,video_90:0,video_complete:0,booking_clicks:0,whatsapp_clicks:0,lead_intents:0};
  let activities:Activity[]=[];
  let error=false;
  try{
    const result=await query<Overview>(`
      select count(*)::int as events,
      count(distinct lead_id)::int as sessions,
      count(*) filter(where type='video_play')::int as video_starts,
      count(*) filter(where type='video_milestone' and meta->'details'->>'percent'='50')::int as video_50,
      count(*) filter(where type='video_milestone' and meta->'details'->>'percent'='90')::int as video_90,
      count(*) filter(where type='video_complete')::int as video_complete,
      count(*) filter(where type='booking_click')::int as booking_clicks,
      count(*) filter(where type='whatsapp_click')::int as whatsapp_clicks,
      count(*) filter(where type='lead_intent')::int as lead_intents
      from er_events where workspace='site-pflege' and created_at>=now()-interval '7 days'
    `);
    overview=result[0]||overview;
    activities=await query<Activity>(`
      select id,created_at,lead_id,type,meta from er_events
      where workspace='site-pflege' and created_at>=now()-interval '7 days'
      order by created_at desc limit 80
    `);
  }catch(e){error=true;console.error("[website-analytics]",e instanceof Error?e.message:"DB unavailable")}
  const metrics=[
    ["Sitzungen",overview.sessions],["Erfasste Events",overview.events],
    ["Videostarts",overview.video_starts],["Video 50 %",overview.video_50],
    ["Video 90 %",overview.video_90],["Video beendet",overview.video_complete],
    ["Kalenderklicks",overview.booking_clicks],["WhatsApp-Klicks",overview.whatsapp_clicks],
    ["Kontaktinteresse",overview.lead_intents]
  ] as const;
  return <main style={{minHeight:"100vh",background:"#f5f8f7",color:"#172a25",padding:"36px 20px",fontFamily:"Inter,system-ui,sans-serif"}}>
    <div style={{maxWidth:1180,margin:"0 auto"}}>
      <a href="/" style={{color:"#126b5c",fontWeight:700}}>← DG Outbound</a>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:14,flexWrap:"wrap",margin:"20px 0"}}>
        <div><p style={{color:"#267f6b",fontWeight:800,margin:0}}>DIGITALE GEWINNER · PFLEGE</p>
          <h1 style={{fontSize:"clamp(28px,4vw,44px)",margin:"6px 0"}}>Website-Analytics</h1>
          <p style={{color:"#587169",margin:0}}>Letzte 7 Tage · Nur Ereignisse nach Einwilligung · Keine namentliche Besucheridentifikation</p>
        </div>
        <a href="/website-analytics" style={{...pad,color:"#126b5c",fontWeight:700,textDecoration:"none"}}>Aktualisieren ↻</a>
      </div>
      {error&&<p role="alert" style={{background:"#fff0eb",padding:16,borderRadius:12}}>Die Datenbank ist aktuell nicht erreichbar. Vorhandene Daten werden nicht gelöscht.</p>}
      <section aria-label="Kennzahlen" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(185px,1fr))",gap:12}}>
        {metrics.map(([label,value])=><div key={label} style={pad}>
          <p style={{margin:"0 0 9px",color:"#526b63",fontSize:13,fontWeight:650}}>{label}</p>
          <strong style={{fontSize:32,letterSpacing:"-.04em"}}>{n(value)}</strong>
        </div>)}
      </section>
      <section style={{...pad,marginTop:24,overflow:"auto"}}>
        <h2 style={{fontSize:22,margin:"0 0 10px"}}>Letzte Aktivitäten</h2>
        <p style={{color:"#667c74",margin:"0 0 18px",fontSize:13}}>Session-ID ist pseudonym; Watchtime ist tatsächliche aktive Wiedergabezeit, keine geschätzte Videoposition.</p>
        {activities.length===0?<p style={{padding:"20px 0"}}>Noch keine Ereignisse gespeichert. Tracking erfolgt erst nach Zustimmung des Besuchers.</p>:
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:14,minWidth:700}}>
          <thead><tr>{["Zeit (Berlin)","Aktion","Videozeit","Detail","Kampagne","Sitzung"].map(x=><th key={x} style={{textAlign:"left",padding:"12px 8px",borderBottom:"1px solid #dce6e2"}}>{x}</th>)}</tr></thead>
          <tbody>{activities.map(row=><tr key={row.id}>
            <td style={{padding:"10px 8px",borderBottom:"1px solid #edf1ef"}}>{new Date(row.created_at).toLocaleString("de-DE",{timeZone:"Europe/Berlin",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</td>
            <td style={{padding:"10px 8px",borderBottom:"1px solid #edf1ef",fontWeight:650}}>{nice(row.type)}</td>
            <td style={{padding:"10px 8px",borderBottom:"1px solid #edf1ef"}}>{n(row.meta?.watch_seconds||0)} s</td>
            <td style={{padding:"10px 8px",borderBottom:"1px solid #edf1ef"}}>{simple(row.meta?.details?.percent?String(row.meta.details.percent)+" %":row.meta?.details?.step||row.meta?.details?.label||"—")}</td>
            <td style={{padding:"10px 8px",borderBottom:"1px solid #edf1ef"}}>{simple(row.meta?.campaign?.utm_source||"Direkt")}</td>
            <td style={{padding:"10px 8px",borderBottom:"1px solid #edf1ef",fontFamily:"monospace",fontSize:11}}>{simple(row.lead_id).slice(0,12)}</td>
          </tr>)}</tbody>
        </table>}
      </section>
    </div>
  </main>;
}
