import { z } from "zod";
import { readState, writeState } from "@/lib/db";
import { getSecret } from "@/lib/secrets";

const schema=z.object({leadId:z.string().min(1).max(200),videoUrl:z.string().url(),jobId:z.string().optional()});
export async function POST(request:Request){
 try{
  const expected=process.env.VIDEO_RENDERER_SECRET||await getSecret("video_renderer_secret");if(!expected)return Response.json({error:"Video callback secret fehlt."},{status:503});
  if((request.headers.get("authorization")||"")!==`Bearer ${expected}`)return Response.json({error:"Unauthorized"},{status:401});
  const input=schema.parse(await request.json());const row=await readState();const state=row?.payload as {leads?:Array<Record<string,unknown>>}|undefined;if(!state?.leads)return Response.json({error:"State nicht gefunden."},{status:404});
  let found=false;const leads=state.leads.map(l=>{if(String(l.id)!==input.leadId)return l;found=true;return{...l,videoUrl:input.videoUrl,videoStatus:"ready",videoJobId:input.jobId||l.videoJobId}});if(!found)return Response.json({error:"Lead nicht gefunden."},{status:404});
  await writeState({...state,leads});return Response.json({ok:true});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Video Callback fehlgeschlagen."},{status:400})}
}
