import { NextRequest } from "next/server";
import { put } from "@vercel/blob";
import { query } from "@/lib/db";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;

// Single-use, short-lived media import authorized by a random DB token.
// Input hostname is pinned to our temporary Vercel Sandbox; no arbitrary URLs.
export async function GET(request:NextRequest){
 const id=request.nextUrl.searchParams.get("token")||"";
 if(!/^[0-9a-f-]{36}$/i.test(id))return Response.json({error:"Not found"},{status:404});
 const [job]=await query<{id:string;segment:"pv"|"pflege";source_url:string}>(
   `update loom_video_import_jobs set status='importing'
    where id::text=$1 and status='pending' and expires_at>now()
    returning id,segment,source_url`,[id]
 ).catch(()=>[]);
 if(!job)return Response.json({error:"Expired or already used"},{status:404});
 try {
   const uri=new URL(job.source_url);
   if(uri.protocol!=="https:"||uri.hostname!=="sb-1ttc4onpzskm.vercel.run"||
     uri.pathname!=="/"+job.segment+"-optimized.mp4")
     throw new Error("Untrusted media source");
   const response=await fetch(uri,{cache:"no-store",signal:AbortSignal.timeout(150000)});
   const len=Number(response.headers.get("content-length")||0);
   if(!response.ok||!response.body||len>90_000_000||len<100000)
     throw new Error("Optimized MP4 not available or invalid");
   const asset=await put("loom-videos/"+job.segment+"-optimized.mp4",response.body,{
     access:"private",multipart:true,addRandomSuffix:true,contentType:"video/mp4"
   });
   await query(`insert into loom_video_assets(segment,video_url,updated_at) values($1,$2,now())
     on conflict(segment) do update set video_url=excluded.video_url,updated_at=now()`,
     [job.segment,asset.url]);
   await query("update loom_video_import_jobs set status='complete' where id=$1::uuid",[job.id]);
   console.info("[loom-import] optimized MP4 activated",{segment:job.segment,size:len});
   return Response.json({ok:true,segment:job.segment,size:len});
 }catch(error){
   const message=error instanceof Error?error.message:"unknown";
   console.error("[loom-import] failed",{segment:job.segment,message});
   await query("update loom_video_import_jobs set status='failed',error=$2 where id=$1::uuid",[job.id,message]).catch(()=>null);
   return Response.json({error:"Media import failed",detail:message},{status:502});
 }
}
