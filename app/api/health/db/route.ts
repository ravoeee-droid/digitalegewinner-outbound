import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { ensureSalesOsSchema } from "@/lib/sales-os";
import { seedCallLeadsIfEmpty } from "@/lib/seed-call-leads";
import { buildDailyOutboundPlan } from "@/lib/outbound-engine";

export const dynamic = "force-dynamic";
// Runs in the project's configured data region.
// fra1 rebuild marker


export async function GET() {
  const started = Date.now();
  try {
    await ensureSalesOsSchema();
    await seedCallLeadsIfEmpty();
    await buildDailyOutboundPlan();
    const rows = await query<{ ok: number; sales_leads: string | null }>(
      "select 1 as ok, to_regclass('public.sales_leads')::text as sales_leads",
    );
    return NextResponse.json({
      ok: rows[0]?.ok === 1,
      latencyMs: Date.now() - started,
      salesSchema: Boolean(rows[0]?.sales_leads),
      leads: (await query<{ n: number }>("select count(*)::int as n from sales_leads where workspace='default' and status='active'"))[0]?.n || 0,
      owners: await query<{ owner: string; n: number }>("select owner,count(*)::int as n from sales_leads where workspace='default' and status='active' group by owner order by owner"),
      callTasks: await query<{ owner: string; n: number }>("select coalesce(payload->>'owner','') owner,count(*)::int as n from sales_outbound_tasks where workspace='default' and task_date=(now() at time zone 'Europe/Berlin')::date and channel='call' group by 1 order by 1"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database connection failed";
    return NextResponse.json(
      { ok: false, latencyMs: Date.now() - started, error: message.slice(0, 180) },
      { status: 503 },
    );
  }
}
