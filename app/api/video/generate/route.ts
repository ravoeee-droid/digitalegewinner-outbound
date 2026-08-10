import { z } from "zod";
import { readState } from "@/lib/db";
import { getSecret } from "@/lib/secrets";

const schema=z.object({leadId:z.string().min(1).max(200)});
type State={leads?:Array<Record<string,unknown>>;settings?:Record<string,unknown>};
export async function POST(request:Request){
 try{
  const {leadId}=schema.parse(await request.json());const row=await readState();const state=row?.payload as State|undefined;const lead=state?.leads?.find(l=>String(l.id)===leadId);if(!lead)return Response.json({error:"Lead nicht gefunden."},{status:404});
  const renderer=process.env.VIDEO_RENDERER_URL||await getSecret("video_renderer_url");const secret=process.env.VIDEO_RENDERER_SECRET||await getSecret("video_renderer_secret");if(!renderer)return Response.json({error:"Video Renderer ist noch nicht verbunden."},{status:503});
  const base=process.env.NEXT_PUBLIC_APP_URL||new URL(request.url).origin;const callbackUrl=`${base}/api/video/callback`;
  const r=await fetch(renderer,{method:"POST",headers:{"content-type":"application/json",...(secret?{"authorization":`Bearer ${secret}`}:{})},body:JSON.stringify({jobId:crypto.randomUUID(),leadId,company:lead.company,contact:lead.contact,website:lead.website,city:lead.city,industry:lead.industry,energyScore:lead.energyScore,analysisUrl:`${base}/a/${encodeURIComponent(leadId)}`,callbackUrl})});
  if(!r.ok)return Response.json({error:`Video Renderer Fehler (${r.status}).`},{status:502});const result=await r.json().catch(()=>({})) as {jobId?:string;videoUrl?:string};
  return Response.json({ok:true,status:result.videoUrl?"ready":"queued",jobId:result.jobId||null,videoUrl:result.videoUrl||null});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Video konnte nicht gestartet werden."},{status:400})}
}
