import sharp from "sharp";
import { verifyVideoToken } from "@/lib/email-tracking";
import { loadScreenshot } from "@/lib/lead-screenshot";
import { VIDEO_IDS } from "@/lib/outreach-copy";
import { leadSegmentSql } from "@/lib/lead-segment";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Signierter Lead-Token statt einer erratbaren Unternehmens-ID. Das Ergebnis
// ist ein echtes JPG für Gmail/Outlook; kein GIF, kein externes Trackingpixel.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const leadId = verifyVideoToken(decodeURIComponent(token));
  if (!leadId) return new Response("Not found", { status: 404 });
  const [lead] = await query<{segment:string}>(
    "select "+leadSegmentSql("c")+" as segment from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace where l.workspace='default' and l.id::text=$1 limit 1",
    [leadId],
  ).catch(()=>[]);
  if (!lead || (lead.segment!=="pflege" && lead.segment!=="pv")) return new Response("Not found", { status: 404 });

  const screenshot = await loadScreenshot(leadId);
  if (!screenshot) return new Response("Not found", { status: 404 });

  const W=640,H=360, faceSize=146,faceLeft=468,faceTop=15;
  const background=await sharp(screenshot).resize(W,H,{fit:"cover",position:"north"}).jpeg({quality:76}).toBuffer();
  const layers: Array<{ input: Buffer; left: number; top: number }> = [];
  const videoId=VIDEO_IDS[lead.segment as "pflege"|"pv"];
  if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    try {
      const response=await fetch("https://i.ytimg.com/vi/"+videoId+"/mqdefault.jpg", {
        signal:AbortSignal.timeout(4500),cache:"force-cache",
      });
      if(response.ok && Number(response.headers.get("content-length")||0)<2_000_000){
        const raw=Buffer.from(await response.arrayBuffer());
        if(raw.length<2_000_000){
          const circle=Buffer.from('<svg width="146" height="146"><circle cx="73" cy="73" r="70" fill="white"/></svg>');
          const portrait=await sharp(raw).resize(faceSize,faceSize,{fit:"cover",position:"centre"}).composite([{input:circle,blend:"dest-in"}]).png().toBuffer();
          const outline=Buffer.from('<svg width="150" height="150"><circle cx="75" cy="75" r="73" fill="none" stroke="white" stroke-width="4"/></svg>');
          layers.push({input:portrait,left:faceLeft,top:faceTop},{input:outline,left:faceLeft-2,top:faceTop-2});
        }
      }
    } catch { /* A website preview alone is preferable to a broken image. */ }
  }

  const decoration=Buffer.from(
    '<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg">'+
    '<rect width="640" height="360" fill="none" stroke="#ffffff" stroke-width="5"/>'+
    '<rect x="0" y="298" width="640" height="62" fill="#101216" opacity=".89"/>'+
    '<circle cx="320" cy="171" r="39" fill="#ec6500" stroke="#ffffff" stroke-width="4"/>'+
    '<polygon points="309,148 309,194 344,171" fill="#ffffff"/>'+
    '</svg>'
  );
  layers.push({input:decoration,left:0,top:0});
  const jpg=await sharp(background).composite(layers).jpeg({quality:80,mozjpeg:true}).toBuffer();
  return new Response(new Uint8Array(jpg), {
    headers:{
      "content-type":"image/jpeg",
      "cache-control":"public, max-age=604800, s-maxage=604800",
      "x-content-type-options":"nosniff",
    },
  });
}
