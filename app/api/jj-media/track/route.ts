import { createHash } from "node:crypto";
import { query, readState, writeState } from "@/lib/db";
import { z } from "zod";

const WORKSPACE="jj-media";
const schema=z.object({leadId:z.string().min(1).max(200),type:z.enum(["microsite_view","video_view","cta_click"]),value:z.number().int().min(0).max(100).optional()});

export async function POST(request:Request){
  try{
    const input=schema.parse(await request.json());
    const fingerprint=createHash("sha256").update(`${request.headers.get("x-forwarded-for")||""}|${request.headers.get("user-agent")||""}`).digest("hex").slice(0,24);
    const recent=await query<{id:number}>("select id from er_events where workspace=$1 and lead_id=$2 and type=$3 and meta->>'fingerprint'=$4 and created_at>now()-interval '30 minutes' limit 1",[WORKSPACE,input.leadId,input.type,fingerprint]);
    if(recent.length)return Response.json({ok:true,deduplicated:true});
    await query("insert into er_events(workspace,lead_id,type,meta) values($1,$2,$3,$4::jsonb)",[WORKSPACE,input.leadId,input.type,JSON.stringify({value:input.value||0,fingerprint})]);
    const row=await readState(WORKSPACE);
    const state=row?.payload as {leads?:Array<Record<string,unknown>>}|undefined;
    if(state?.leads){
      const leads=state.leads.map((lead)=>{
        if(String(lead.id)!==input.leadId)return lead;
        const current=Number(lead.intentScore||0);
        const boost=input.type==="cta_click"?25:input.type==="video_view"?Math.max(12,Math.round((input.value||0)*.25)):10;
        const stage=input.type==="cta_click"&&["Neu","Kontaktiert"].includes(String(lead.stage||""))?"Engaged":lead.stage;
        return{...lead,intentScore:Math.min(100,current+boost),stage};
      });
      await writeState({...state,leads},WORKSPACE);
    }
    return Response.json({ok:true,deduplicated:false});
  }catch{return Response.json({error:"Tracking verworfen."},{status:400})}
}
