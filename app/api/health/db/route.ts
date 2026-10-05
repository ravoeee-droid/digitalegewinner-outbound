import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    const rows = await query<{ ok: number }>("select 1 as ok");
    return NextResponse.json({ ok: rows[0]?.ok === 1, latencyMs: Date.now() - started });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database connection failed";
    return NextResponse.json(
      { ok: false, latencyMs: Date.now() - started, error: message.slice(0, 180) },
      { status: 503 },
    );
  }
}
