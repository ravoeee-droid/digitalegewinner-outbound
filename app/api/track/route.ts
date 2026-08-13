import { createHash } from "node:crypto";
import { query, readState, writeState } from "@/lib/db";
import { processSalesEvent } from "@/lib/sales-trigger-engine";
import { z } from "zod";

const schema = z.object({
  leadId: z.string().min(1).max(200),
  type: z.enum(["microsite_view", "video_view", "cta_click"]),
  value: z.number().int().min(0).max(100).optional(),
});

export async function POST(request: Request) {
  try {
    const x = schema.parse(await request.json());
    const fingerprint = createHash("sha256")
      .update(`${request.headers.get("x-forwarded-for") || ""}|${request.headers.get("user-agent") || ""}`)
      .digest("hex")
      .slice(0, 24);
    const recent = await query<{ id: number }>(
      "select id from er_events where workspace='default' and lead_id=$1 and type=$2 and meta->>'fingerprint'=$3 and created_at>now()-interval '30 minutes' limit 1",
      [x.leadId, x.type, fingerprint],
    );
    if (recent.length) return Response.json({ ok: true, deduplicated: true });

    const [event] = await query<{ id: number }>(
      "insert into er_events(workspace,lead_id,type,meta) values('default',$1,$2,$3::jsonb) returning id",
      [x.leadId, x.type, JSON.stringify({ value: x.value || 0, fingerprint })],
    );

    const row = await readState();
    const state = row?.payload as { leads?: Array<Record<string, unknown>> } | undefined;
    if (state?.leads) {
      const leads = state.leads.map((lead) => {
        if (String(lead.id) !== x.leadId) return lead;
        const current = Number(lead.intentScore || 0);
        const boost = x.type === "cta_click" ? 25 : x.type === "video_view" ? Math.max(12, Math.round((x.value || 0) * 0.25)) : 10;
        return {
          ...lead,
          intentScore: Math.min(100, current + boost),
          stage: x.type === "cta_click" && ["Neu", "Kontaktiert"].includes(String(lead.stage || "")) ? "Engaged" : lead.stage,
        };
      });
      await writeState({ ...state, leads });
    }

    const trigger = await processSalesEvent(
      { eventId: event?.id, leadId: x.leadId, type: x.type, meta: { value: x.value || 0, fingerprint } },
      "default",
    ).catch(() => null);

    return Response.json({ ok: true, deduplicated: false, trigger });
  } catch {
    return Response.json({ error: "Tracking verworfen." }, { status: 400 });
  }
}
