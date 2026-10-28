import { NextRequest } from "next/server";
import { verifyVideoToken } from "@/lib/email-tracking";
import { query } from "@/lib/db";
import { leadSegmentSql } from "@/lib/lead-segment";
import { getLoomVideoUrl } from "@/lib/loom-assets";
import { prepareFaststart, virtualParts, parseRange, streamVirtualParts } from "@/lib/mp4-faststart";

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

  if(request.nextUrl.searchParams.get("diagnose")==="codec") {
    const inspect=async(range:string)=>{
      const response=await fetch(url,{headers:{authorization:`Bearer ${secret}`,range},cache:"no-store",signal:AbortSignal.timeout(15000)});
      const bytes=Buffer.from(await response.arrayBuffer());
      const snippet=bytes.toString("latin1");
      return {
        status:response.status, bytes:bytes.length,
        moov:snippet.indexOf("moov"),mdat:snippet.indexOf("mdat"),
        avc1:snippet.includes("avc1"),hvc1:snippet.includes("hvc1"),
        hev1:snippet.includes("hev1"),av01:snippet.includes("av01"),
        mp4a:snippet.includes("mp4a"),vp09:snippet.includes("vp09")
      };
    };
    const [first,last]=await Promise.all([inspect("bytes=0-65535"),inspect("bytes=-4194304")]);
    return Response.json({segment,first,last});
  }
  if(request.nextUrl.searchParams.get("diagnose")==="1") {
    const test=await fetch(url,{
      headers:{authorization:`Bearer ${secret}`,range:"bytes=0-1023"},
      cache:"no-store",
      signal:AbortSignal.timeout(10000)
    }).catch(()=>null);
    if(!test)return Response.json({ok:false,error:"Blob-Verbindung fehlgeschlagen"},{status:502});
    const sample=await test.arrayBuffer().catch(()=>new ArrayBuffer(0));
    return Response.json({ok:test.status===206,status:test.status,bytes:sample.byteLength,
      contentRange:test.headers.get("content-range"),mime:test.headers.get("content-type")});
  }
  const mediaHead=await fetch(url,{
    method:"HEAD",headers:{authorization:`Bearer ${secret}`},
    cache:"no-store",signal:AbortSignal.timeout(12000)
  }).catch(()=>null);
  const size=Number(mediaHead?.headers.get("content-length")||0);
  if(!request.nextUrl.searchParams.has("original") && mediaHead?.ok && size>0 && size<600_000_000) {
    const meta=await prepareFaststart(url,secret,size);
    if(meta) {
      const parsed=parseRange(request.headers.get("range"),size);
      if(!parsed)return new Response("Range not satisfiable",{status:416,headers:{"content-range":`bytes */${size}`}});
      const parts=virtualParts(meta,parsed.start,parsed.end);
      const bytes=parts.reduce((n,p)=>n+(p.data?.length ?? ((p.end??0)-(p.start??0)+1)),0);
      if(bytes!==parsed.end-parsed.start+1){
        console.error("[loom-faststart] incorrect response segment",{segment,bytes,range:parsed});
        return new Response("MP4 byte mapping failed",{status:502});
      }
      console.info("[loom-faststart] stream",{segment,start:parsed.start,end:parsed.end,parts:parts.length});
      return new Response(streamVirtualParts(url,secret,parts,request.signal),{
        status:206,
        headers:{
          "content-type":"video/mp4",
          "content-length":String(bytes),
          "content-range":`bytes ${parsed.start}-${parsed.end}/${size}`,
          "accept-ranges":"bytes",
          "cache-control":"private, max-age=900",
          "x-content-type-options":"nosniff"
        }
      });
    }
  }
  const range=request.headers.get("range");
  if(range && !/^bytes=\d*-\d*$/.test(range))return new Response("Invalid range",{status:416});
  // Always request a partial-content stream, including initial browser loads.
  // A 200 full-blob stream (300 MB) stalls until enough metadata arrives.
  const requestedRange = range || "bytes=0-";
  const upstream=await fetch(url,{
    headers:{authorization:`Bearer ${secret}`,range:requestedRange},
    cache:"no-store",
    signal:request.signal
  }).catch((error)=>{
    console.error("[loom-media] upstream network error",segment,error instanceof Error?error.message:"unknown");
    return null;
  });
  console.info("[loom-media] response",{
    segment, range:requestedRange, status:upstream?.status, length:upstream?.headers.get("content-length"),
    contentRange:upstream?.headers.get("content-range")
  });
  if(!upstream || !upstream.ok || !upstream.body)return new Response("Video temporarily unavailable",{status:502});
  const headers=new Headers({
    "content-type":"video/mp4",
    "cache-control":"private, max-age=1800",
    "x-content-type-options":"nosniff",
    "accept-ranges":"bytes",
  });
  for(const key of ["content-length","content-range","etag","last-modified"]){
    const value=upstream.headers.get(key);
    if(value)headers.set(key,value);
  }
  return new Response(upstream.body,{status:upstream.status===206?206:200,headers});
}
