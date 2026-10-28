import { handleUpload } from "@vercel/blob/client";
import { head } from "@vercel/blob";
import { NextRequest } from "next/server";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureTable() {
  await query(`create table if not exists loom_video_assets (
    segment text primary key check (segment in ('pv','pflege')),
    video_url text not null,
    updated_at timestamptz not null default now()
  )`);
}

export async function GET(request: NextRequest) {
  if (sessionRole(request.cookies.get(adminCookieName())?.value) !== "admin")
    return Response.json({error:"Forbidden"}, {status:403});
  await ensureTable();
  const rows = await query<{segment:string;video_url:string}>("select segment, video_url from loom_video_assets order by segment");
  return Response.json({videos:rows});
}

export async function POST(request: NextRequest) {
  // The SDK's completion webhook is signed internally by Vercel Blob.
  // Verify the actual operator session before issuing *any* upload token.
  try {
    const body = await request.json();
    if (body?.action === "diagnose") {
      const signedIn = sessionRole(request.cookies.get(adminCookieName())?.value) === "admin";
      const storeReady = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
      console.info("[loom-video-upload] preflight", { signedIn, storeReady });
      if (!signedIn) return Response.json({error:"Bitte erneut als Admin anmelden. Die Sitzung ist abgelaufen.",stage:"auth"},{status:401});
      if (!storeReady) return Response.json({error:"BLOB_READ_WRITE_TOKEN fehlt in der Vercel-Produktion.",stage:"storage"},{status:503});
      return Response.json({ok:true,stage:"ready",maxFileBytes:500000000});
    }
    // Authenticated browser confirmation prevents a delayed completion webhook
    // from leaving a successfully uploaded video stuck in "not active".
    if (body?.action === "activate") {
      if (sessionRole(request.cookies.get(adminCookieName())?.value) !== "admin")
        return Response.json({error:"Forbidden"},{status:403});
      const segment = String(body.segment||"");
      const url = String(body.url||"");
      if (!["pv","pflege"].includes(segment) || !/^https:\/\/[^/]+\.public\.blob\.vercel-storage\.com\/loom-videos\/(pv|pflege)(?:[^/]*)\.mp4$/.test(url))
        return Response.json({error:"Ungültige Datei-Adresse"},{status:400});
      if (!url.includes("/loom-videos/"+segment)) return Response.json({error:"Segment stimmt nicht"},{status:400});
      const blob = await head(url);
      if (!blob || blob.size > 500_000_000 || blob.contentType !== "video/mp4")
        return Response.json({error:"MP4 konnte im Videospeicher nicht bestätigt werden"},{status:400});
      await ensureTable();
      await query(
        `insert into loom_video_assets(segment,video_url,updated_at) values($1,$2,now())
         on conflict(segment) do update set video_url=excluded.video_url,updated_at=now()`,
        [segment, url]
      );
      return Response.json({ok:true,segment,url});
    }
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        console.info("[loom-video-upload] token request", {pathname});
        if (sessionRole(request.cookies.get(adminCookieName())?.value) !== "admin")
          throw new Error("Admin-Anmeldung erforderlich.");
        const match = /^loom-videos\/(pv|pflege)\.mp4$/.exec(pathname);
        if (!match) throw new Error("Nur PV und Pflege MP4 sind zugelassen.");
        if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Blob-Speicher ist nicht verbunden.");
        return {
          allowedContentTypes: ["video/mp4"],
          maximumSizeInBytes: 500_000_000,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({segment:match[1]}),
        };
      },
      onUploadCompleted: async ({blob,tokenPayload}) => {
        const data = JSON.parse(tokenPayload || "{}") as {segment?:string};
        if (!["pv","pflege"].includes(data.segment || "")) throw new Error("Ungültiges Segment");
        if (blob.contentType !== "video/mp4" || !blob.url.startsWith("https://")) throw new Error("Ungültige Videodatei");
        await ensureTable();
        await query(
          `insert into loom_video_assets(segment,video_url,updated_at) values($1,$2,now())
           on conflict(segment) do update set video_url=excluded.video_url, updated_at=now()`,
          [data.segment,blob.url]
        );
      },
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({error: error instanceof Error ? error.message : "Upload fehlgeschlagen"}, {status:400});
  }
}
