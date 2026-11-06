import { query } from "@/lib/db";
import { sendAlertOnce } from "@/lib/alerts";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const origins = new Set(["https://digitalegewinner.de", "https://www.digitalegewinner.de"]);
const eventNames = [
  "page_view","section_view","cta_click","booking_click","whatsapp_click",
  "video_play","video_pause","video_milestone","video_complete",
  "funnel_step","funnel_interaction","funnel_progress","lead_intent"
] as const;
const input = z.object({
  event: z.enum(eventNames),
  session: z.string().min(8).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  path: z.enum(["/pflege","/pflege/","/pflege.html"]),
  watch_seconds: z.number().finite().min(0).max(7200).optional().default(0),
  campaign: z.record(z.string(),z.string().max(100)).optional().default({}),
  details: z.record(z.string(),z.union([z.string().max(150),z.number(),z.boolean()])).optional().default({}),
});
const clean = (x:unknown,n=100)=>String(x??"").replace(/[<>\r\n\t]/g," ").slice(0,n);
function cors(origin:string|null){
  const permitted=!!origin&&origins.has(origin);
  return {permitted,headers:{
    "Access-Control-Allow-Origin":permitted?origin!:"",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type",
    "Vary":"Origin",
    "Cache-Control":"no-store"
  }};
}
export function OPTIONS(req:Request){
  const c=cors(req.headers.get("origin"));
  return new Response(null,{status:c.permitted?204:403,headers:c.headers});
}
export async function POST(req:Request){
  const c=cors(req.headers.get("origin"));
  if(!c.permitted) return Response.json({ok:false,error:"origin"},{status:403,headers:c.headers});
  if(Number(req.headers.get("content-length")||0)>4200) return Response.json({ok:false},{status:413,headers:c.headers});
  try{
    const raw=await req.text();
    if(raw.length>4200)return Response.json({ok:false},{status:413,headers:c.headers});
    const data=input.parse(JSON.parse(raw));
    const meta={
      session:data.session,path:data.path,watch_seconds:Math.round(data.watch_seconds),
      campaign:Object.fromEntries(Object.entries(data.campaign).filter(([k])=>["utm_source","utm_medium","utm_campaign","utm_content","gclid","fbclid","d"].includes(k))),
      details:data.details
    };
    // Kein Name, keine Kontaktdaten und keine IP-Adresse im Analyse-Datensatz.
    const recent=await query<{n:number}>(
      "select count(*)::int as n from er_events where workspace='site-pflege' and lead_id=$1 and created_at>now()-interval '1 minute'",
      [data.session]
    );
    if((recent[0]?.n||0)>=45)return Response.json({ok:true,rate_limited:true},{headers:c.headers});
    await query(
      "insert into er_events(workspace,lead_id,type,meta) values('site-pflege',$1,$2,$3::jsonb)",
      [data.session,data.event,JSON.stringify(meta)]
    );
    const p=Number(data.details.percent)||0;
    const isHot=["booking_click","whatsapp_click","video_complete","lead_intent"].includes(data.event)
      ||(data.event==="video_milestone"&&[50,90,100].includes(p))
      ||(data.event==="funnel_progress"&&/^(?:6|7|8|100%)/.test(clean(data.details.step)));
    let notified=false;
    if(isHot){
      const source=clean(data.campaign.utm_source||"Direkt");
      const campaign=clean(data.campaign.utm_campaign||"-");
      const label=clean(data.details.label||data.details.step||data.details.goal||"-");
      const message=[
        "🔥 DG Website · Pflege",
        "Aktion: "+data.event+(p?" ("+p+" %)":""),
        "Video-Watchtime: "+Math.round(data.watch_seconds)+" Sekunden",
        "Inhalt: "+label,
        "Kampagne: "+source+" / "+campaign,
        "Sitzung: "+clean(data.session,50),
        "Seite: digitalegewinner.de/pflege"
      ].join("\n");
      notified=await sendAlertOnce("pflege:"+data.session+":"+data.event+":"+(p||label),message,24);
    }
    return Response.json({ok:true,stored:true,notified},{headers:c.headers});
  }catch(e){
    console.error("[site-track]",e instanceof Error?e.message:"Invalid request");
    return Response.json({ok:false},{status:400,headers:c.headers});
  }
}
