import { z } from "zod";
import { buildDailyOutboundPlan, getOutboundEngineSnapshot } from "@/lib/outbound-engine";
import { query } from "@/lib/db";
import { addProductOpportunity, updateRevenueOpportunity } from "@/lib/revenue-opportunities";
import { createWebsiteProjectFromLead } from "@/lib/website-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const outcomeSchema = z.object({
  id: z.string().min(3),
  outcome: z.enum(["not_reached", "callback", "pain", "appointment", "no_fit", "dnc", "website_requested"]),
  note: z.string().max(4000).optional().default(""),
  opener: z.enum(["A", "B", "C", "D"]).optional().default("D"),
});

export async function GET() {
  try {
    const snapshot = await buildDailyOutboundPlan();
    return Response.json({ date: snapshot.date, channels: snapshot.channels, tasks: snapshot.tasks.filter((task) => task.channel === "call") });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Call Console konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = outcomeSchema.parse(await request.json());
    await buildDailyOutboundPlan();
    const taskRows = await query<{ lead_id: string; company_id: string }>(`select lead_id,company_id from sales_outbound_tasks where id=$1::text and channel='call' limit 1`, [input.id]);
    const task = taskRows[0];
    if (!task) return Response.json({ error: "Call-Task nicht gefunden." }, { status: 404 });

    await query(
      `update sales_outbound_tasks
       set status='done', payload=payload || jsonb_build_object('callOutcome',$2::text,'callNote',$3::text,'openerTest',$4::text,'callOutcomeAt',now()::text), updated_at=now()
       where id=$1::text and channel='call'`,
      [input.id, input.outcome, input.note, input.opener],
    );

    let websiteProject = null;
    let integrationWarning = "";
    if (input.outcome === "website_requested") {
      try {
        await addProductOpportunity(task.lead_id, "website");
        const opportunityRows = await query<{ id: string }>(`select id from sales_opportunities where workspace='default' and lead_id=$1 and product_key='website' order by case when status='open' then 0 else 1 end,updated_at desc limit 1`, [task.lead_id]);
        const opportunity = opportunityRows[0];
        if (opportunity) {
          await updateRevenueOpportunity(opportunity.id, { outcome: "Interesse", nextAction: "Website-Entwurf erstellen und Preview vorbereiten", notes: input.note || undefined });
        }
        websiteProject = await createWebsiteProjectFromLead(task.lead_id, "default", "rapid-call");
      } catch (integrationError) {
        integrationWarning = integrationError instanceof Error ? integrationError.message : "Website-Projekt konnte nicht automatisch verknüpft werden.";
      }
    }

    const snapshot = await getOutboundEngineSnapshot();
    return Response.json({ ok: true, tasks: snapshot.tasks.filter((item) => item.channel === "call"), channels: snapshot.channels, websiteProject, integrationWarning });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Call-Ergebnis konnte nicht gespeichert werden." }, { status: 400 });
  }
}
