import { list } from "@vercel/blob";
import { query } from "@/lib/db";

export type LoomSegment = "pv" | "pflege";

// Private Blob assets are served only through the authenticated media proxy.
// A Preview deployment may not have the production Neon asset table. Resolve
// its exact optimized campaign asset from the same Blob store without writing
// anything to the preview database.
export async function getLoomVideoUrl(segment: LoomSegment): Promise<string> {
  const preview = process.env.VERCEL_ENV === "preview";
  if (!preview) {
    const existing = await query<{video_url:string}>(
      "select video_url from loom_video_assets where segment=$1 limit 1", [segment]
    ).catch(()=>[]);
    if (existing[0]?.video_url) return existing[0].video_url;
  }

  try {
    const candidates: Array<{url:string;uploadedAt:Date;size:number;optimized:boolean}> = [];
    let cursor: string|undefined;
    for (let page=0;page<5;page++) {
      const result = await list({limit:1000, cursor});
      for(const blob of result.blobs) {
        const name=decodeURIComponent(blob.pathname.split("/").pop()||"").toLowerCase();
        const optimized=name.startsWith(segment+"-optimized-") && name.endsWith(".mp4");
        const legacy=name === segment+" 2.0.mp4" || name === segment+".mp4";
        if(optimized||legacy) {
          candidates.push({url:blob.url,uploadedAt:blob.uploadedAt,size:blob.size,optimized});
        }
      }
      cursor=result.cursor;
      if(!result.hasMore||!cursor) break;
    }
    // Prefer the faststart/H.264 optimized clip. Older clips may be larger
    // and are only a fallback; never substitute an asset from another segment.
    const asset = candidates
      .filter(item=>item.size>500_000 && item.size<500_000_000)
      .sort((a,b)=>Number(b.optimized)-Number(a.optimized)||b.uploadedAt.getTime()-a.uploadedAt.getTime())[0];
    if(!asset) {
      console.warn("[loom-video] no matching private Blob",{segment,preview,candidates:candidates.length});
      return "";
    }
    if(!preview) {
      // Best effort only: a temporary DB issue must not turn an existing
      // private Blob into a broken YouTube-only player.
      try {
        await query(
          `insert into loom_video_assets(segment,video_url,updated_at) values($1,$2,now())
           on conflict(segment) do update set video_url=excluded.video_url,updated_at=now()`,
          [segment,asset.url]
        );
      } catch(error) {
        console.warn("[loom-video] asset cache write unavailable",error instanceof Error?error.message:"unknown");
      }
    }
    console.info("[loom-video] resolved private Blob",{segment,preview,bytes:asset.size,optimized:asset.optimized});
    return asset.url;
  } catch(error) {
    console.error("[loom-video] Blob discovery failed",error instanceof Error?error.message:"unknown");
    return "";
  }
}
