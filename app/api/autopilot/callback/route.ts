import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const ALLOWED_STAGES = new Set(["workflow_started", "execution_plan_ready", "workflow_completed", "workflow_failed"]);

export async function POST(request: Request) {
  const expected = process.env.DG_AUTOPILOT_CALLBACK_SECRET?.trim();
  if (expected && request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const stage = String(body.stage || "");
  if (!ALLOWED_STAGES.has(stage)) return NextResponse.json({ error: "invalid_stage" }, { status: 400 });

  const leadId = typeof body.leadId === "string" && body.leadId.trim() ? body.leadId.trim() : null;
  const meta = { ...body };
  delete meta.stage;

  await query(
    `insert into er_events(workspace, lead_id, type, meta) values($1,$2,$3,$4::jsonb)`,
    ["default", leadId, `autopilot_${stage}`, JSON.stringify(meta)],
  );

  return NextResponse.json({ ok: true });
}
