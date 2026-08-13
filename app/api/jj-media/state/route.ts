import { readState, writeState } from "@/lib/db";

export const runtime = "nodejs";
const WORKSPACE = "jj-media";

export async function GET() {
  try {
    const row = await readState(WORKSPACE);
    return Response.json({ state:row?.payload ?? null, version:row?.version ?? 0, updatedAt:row?.updated_at ?? null });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : "JJ-Media Workspace nicht erreichbar." }, { status:503 });
  }
}

export async function PUT(request: Request) {
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== "object") return Response.json({ error:"Ungültiger JJ-Media State." }, { status:400 });
    const row = await writeState(payload, WORKSPACE);
    return Response.json({ ok:true, version:row.version, updatedAt:row.updated_at });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : "JJ-Media State konnte nicht gespeichert werden." }, { status:503 });
  }
}
