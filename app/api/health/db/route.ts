import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
// Runs in the project's configured data region.
// fra1 rebuild marker

export async function GET() {
  const started = Date.now();
  try {
    const rows = await query<{ ok: number; sales_leads: string | null }>(
      "select 1 as ok, to_regclass('public.sales_leads')::text as sales_leads",
    );
    return NextResponse.json({
      ok: rows[0]?.ok === 1,
      latencyMs: Date.now() - started,
      salesSchema: Boolean(rows[0]?.sales_leads),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database connection failed";
    return NextResponse.json(
      { ok: false, latencyMs: Date.now() - started, error: message.slice(0, 180) },
      { status: 503 },
    );
  }
}
