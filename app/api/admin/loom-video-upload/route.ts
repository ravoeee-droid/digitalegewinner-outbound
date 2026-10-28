import { handleUpload } from "@vercel/blob/client";
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
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
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
