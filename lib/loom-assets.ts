import { list } from "@vercel/blob";
import { query } from "@/lib/db";

export type LoomSegment = "pv" | "pflege";

// The existing Vercel store is PRIVATE. Dashboard uploads are stored there,
// so discover the actual file names once and persist only the URL in Neon.
export async function getLoomVideoUrl(segment: LoomSegment): Promise<string> {
  const existing = await query<{video_url:string}>(
    "select video_url from loom_video_assets where segment=$1 limit 1", [segment]
  ).catch(()=>[]);
  if (existing[0]?.video_url) return existing[0].video_url;
  try {
    const candidates: Array<{url:string;pathname:string;uploadedAt:Date;size:number}> = [];
    let cursor: string|undefined;
    for (let page=0;page<5;page++) {
      const result = await list({limit:1000, cursor});
      for(const blob of result.blobs) {
        const name=decodeURIComponent(blob.pathname.split("/").pop()||"").toLowerCase();
        if(
          name === (segment==="pv"?"pv 2.0.mp4":"pflege 2.0.mp4") ||
          name === (segment==="pv"?"pv%202.0.mp4":"pflege%202.0.mp4") ||
          name === segment+".mp4"
        ) candidates.push({url:blob.url,pathname:blob.pathname,uploadedAt:blob.uploadedAt,size:blob.size});
      }
      cursor=result.cursor;
      if(!result.hasMore||!cursor) break;
    }
    candidates.sort((a,b)=>b.uploadedAt.getTime()-a.uploadedAt.getTime());
    const asset = candidates.find(item=>item.size>10_000_000 && item.size<500_000_000);
    if(!asset) return "";
    await query(`insert into loom_video_assets(segment,video_url,updated_at) values($1,$2,now())
      on conflict(segment) do update set video_url=excluded.video_url,updated_at=now()`,[segment,asset.url]);
    console.info("[loom-video] activated private Blob",{segment,bytes:asset.size});
    return asset.url;
  } catch(error) {
    console.error("[loom-video] Blob discovery failed",error instanceof Error?error.message:"unknown");
    return "";
  }
}
