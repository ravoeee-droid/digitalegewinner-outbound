import { readState, writeState } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const row = await readState();
    return Response.json({ state: row?.payload ?? null, version: row?.version ?? 0, updatedAt: row?.updated_at ?? null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Datenbank nicht erreichbar." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== "object") return Response.json({ error: "Ungültiger State." }, { status: 400 });
    const row = await writeState(payload);
    return Response.json({ ok: true, version: row.version, updatedAt: row.updated_at });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "State konnte nicht gespeichert werden." }, { status: 503 });
  }
}
