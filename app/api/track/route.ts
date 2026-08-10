import { query, readState, writeState } from "@/lib/db";
import { z } from "zod";

const schema=z.object({leadId:z.string().min(1).max(200),type:z.enum(["microsite_view","video_view"]),value:z.number().int().min(0).max(100).optional()});
export async function POST(request:Request){
 try{
  const x=schema.parse(await request.json());
  await query("insert into er_events(workspace,lead_id,type,meta) values('default',$1,$2,$3::jsonb)",[x.leadId,x.type,JSON.stringify({value:x.value||0,ua:(request.headers.get("user-agent")||"").slice(0,180)})]);
  const row=await readState();const state=row?.payload as {leads?:Array<Record<string,unknown>>}|undefined;
  if(state?.leads){
   const leads=state.leads.map((l)=>{if(String(l.id)!==x.leadId)return l;const current=Number(l.intentScore||0);const boost=x.type==="video_view"?Math.max(12,Math.round((x.value||0)*.25)):10;return{...l,intentScore:Math.min(100,current+boost)}});
   await writeState({...state,leads});
  }
  return Response.json({ok:true});
 }catch{return Response.json({error:"Tracking verworfen."},{status:400})}
}
