import { z } from "zod";
import { getSecret } from "@/lib/secrets";

export const runtime="nodejs";
export const maxDuration=60;

const socialSchema=z.object({
  instagram:z.string().url().or(z.literal("")),facebook:z.string().url().or(z.literal("")),tiktok:z.string().url().or(z.literal("")),youtube:z.string().url().or(z.literal("")),pinterest:z.string().url().or(z.literal("")),linkedin:z.string().url().or(z.literal("")),
}).partial().default({});
const sceneSchema=z.object({start:z.number().min(0).max(300),end:z.number().min(0).max(300),source:z.string().max(30),url:z.string().url().optional(),visual:z.string().max(1000),voiceover:z.string().max(2000)});
const schema=z.object({leadId:z.string().min(1).max(200),company:z.string().min(2).max(200),website:z.string().url(),social:socialSchema,scenes:z.array(sceneSchema).max(12).default([])});

export async function POST(request:Request){
  try{
    const input=schema.parse(await request.json());
    const workerUrl=(process.env.BROWSER_WORKER_URL||await getSecret("browser_worker_url")).replace(/\/$/,"");
    const workerSecret=process.env.BROWSER_WORKER_SECRET||await getSecret("browser_worker_secret");
    if(!workerUrl||!workerSecret)return Response.json({error:"Browser Worker ist noch nicht verbunden. BROWSER_WORKER_URL und BROWSER_WORKER_SECRET fehlen."},{status:503});
    const targets=[
      {kind:"website",url:input.website},
      ...(input.social.instagram?[{kind:"instagram",url:input.social.instagram}]:[]),
      ...(input.social.youtube?[{kind:"youtube",url:input.social.youtube}]:[]),
    ].slice(0,3);
    const response=await fetch(`${workerUrl}/v1/capture`,{
      method:"POST",
      headers:{"content-type":"application/json",authorization:`Bearer ${workerSecret}`},
      body:JSON.stringify({leadId:input.leadId,company:input.company,targets,scenes:input.scenes,recordVideo:true}),
      signal:AbortSignal.timeout(52_000),
      cache:"no-store",
    });
    const json=await response.json().catch(()=>({})) as {assets?:Record<string,string>;status?:string;errors?:string[];error?:string};
    if(!response.ok)return Response.json({error:json.error||`Browser Worker HTTP ${response.status}`,errors:json.errors||[]},{status:502});
    return Response.json({assets:json.assets||{},status:json.status||"ready",errors:json.errors||[]});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Browser Capture fehlgeschlagen."},{status:400})}
}
