import { NextRequest } from "next/server";
import { verifyVideoToken } from "@/lib/email-tracking";
import { query } from "@/lib/db";
import { leadSegmentSql } from "@/lib/lead-segment";
import { getLoomVideoUrl } from "@/lib/loom-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Range-aware streaming proxy: videos are stored in Vercel PRIVATE Blob,
// but recipients need no login. Only exact campaign assets are served.
// No video bytes are ever loaded into Neon or the JS heap.
export async function GET(request:NextRequest,{params}:{params:Promise<{token:string}>}) {
  const {token} = await params;
  let segment = "";
  if(token==="demo") {
    const requested=request.nextUrl.searchParams.get("segment");
    if(requested==="pv"||requested==="pflege")segment=requested;
  } else {
    const leadId=verifyVideoToken(decodeURIComponent(token));
    if(!leadId)return new Response("Not found",{status:404});
    const [lead]=await query<{segment:string}>(
      `select ${leadSegmentSql("c")} segment from sales_leads l
       join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
       where l.workspace='default' and l.id::text=$1 limit 1`,[leadId]
    ).catch(()=>[]);
    if(lead)segment=lead.segment;
  }
  if(segment!=="pv"&&segment!=="pflege")return new Response("Not found",{status:404});
  const url=await getLoomVideoUrl(segment);
  if(!url || !/^https:\/\/[a-z0-9-]+\.private\.blob\.vercel-storage\.com\//i.test(url))
    return new Response("Video not available",{status:404});
  const secret=process.env.BLOB_READ_WRITE_TOKEN;
  if(!secret)return new Response("Video storage unavailable",{status:503});
  const range=request.headers.get("range");
  if(range && !/^bytes=\d*-\d*$/.test(range))return new Response("Invalid range",{status:416});
  const upstream=await fetch(url,{
    headers:{
      authorization:`Bearer ${secret}`,
      ...(range?{range}:{}),
    },
    cache:"no-store",
    signal:request.signal
  }).catch(()=>null);
  if(!upstream || !upstream.ok || !upstream.body){
    console.error("[loom-media] private Blob fetch failed",{segment,status:upstream?.status,hasRange:Boolean(range)});
    return new Response("Video temporarily unavailable",{status:502});
  }
  const headers=new Headers({
    "content-type":"video/mp4",
    "cache-control":"public, max-age=1800",
    "x-content-type-options":"nosniff",
    "accept-ranges":"bytes",
  });
  for(const key of ["content-length","content-range","etag","last-modified"]){
    const value=upstream.headers.get(key);
    if(value)headers.set(key,value);
  }
  return new Response(upstream.body,{status:upstream.status===206?206:200,headers});
}
