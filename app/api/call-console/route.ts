import { z } from "zod";
import { buildDailyOutboundPlan, getOutboundEngineSnapshot } from "@/lib/outbound-engine";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const outcomeSchema = z.object({
  id: z.string().min(3),
  outcome: z.enum(["not_reached", "callback", "pain", "appointment", "no_fit", "dnc"]),
  note: z.string().max(4000).optional().default(""),
  opener: z.enum(["A", "B", "C", "D"]).optional().default("D"),
});

export async function GET() {
  try {
    const snapshot = await buildDailyOutboundPlan();
    return Response.json({
      date: snapshot.date,
      channels: snapshot.channels,
      tasks: snapshot.tasks.filter((task) => task.channel === "call"),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Call Console konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = outcomeSchema.parse(await request.json());
    await buildDailyOutboundPlan();
    await query(
      `update sales_outbound_tasks
       set status='done',
           payload=payload || jsonb_build_object(
             'callOutcome',$2,
             'callNote',$3,
             'openerTest',$4,
             'callOutcomeAt',now()::text
           ),
           updated_at=now()
       where id=$1 and channel='call'`,
      [input.id, input.outcome, input.note, input.opener],
    );
    const snapshot = await getOutboundEngineSnapshot();
    return Response.json({
      ok: true,
      tasks: snapshot.tasks.filter((task) => task.channel === "call"),
      channels: snapshot.channels,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Call-Ergebnis konnte nicht gespeichert werden." }, { status: 400 });
  }
}
