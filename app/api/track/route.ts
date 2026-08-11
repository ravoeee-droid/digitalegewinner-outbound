import { createHash } from "node:crypto";
import { query, readState, writeState } from "@/lib/db";
import { z } from "zod";

const schema=z.object({leadId:z.string().min(1).max(200),type:z.enum(["microsite_view","video_view","cta_click"]),value:z.number().int().min(0).max(100).optional()});
export async function POST(request:Request){
 try{
  const x=schema.parse(await request.json());
  const fingerprint=createHash("sha256").update(`${request.headers.get("x-forwarded-for")||""}|${request.headers.get("user-agent")||""}`).digest("hex").slice(0,24);
  const recent=await query<{id:number}>("select id from er_events where workspace='default' and lead_id=$1 and type=$2 and meta->>'fingerprint'=$3 and created_at>now()-interval '30 minutes' limit 1",[x.leadId,x.type,fingerprint]);
  if(recent.length)return Response.json({ok:true,deduplicated:true});
  await query("insert into er_events(workspace,lead_id,type,meta) values('default',$1,$2,$3::jsonb)",[x.leadId,x.type,JSON.stringify({value:x.value||0,fingerprint})]);
  const row=await readState();const state=row?.payload as {leads?:Array<Record<string,unknown>>}|undefined;
  if(state?.leads){
   const leads=state.leads.map((l)=>{if(String(l.id)!==x.leadId)return l;const current=Number(l.intentScore||0);const boost=x.type==="cta_click"?25:x.type==="video_view"?Math.max(12,Math.round((x.value||0)*.25)):10;return{...l,intentScore:Math.min(100,current+boost),stage:x.type==="cta_click"&&["Neu","Kontaktiert"].includes(String(l.stage||""))?"Engaged":l.stage}});
   await writeState({...state,leads});
  }
  return Response.json({ok:true,deduplicated:false});
 }catch{return Response.json({error:"Tracking verworfen."},{status:400})}
}
