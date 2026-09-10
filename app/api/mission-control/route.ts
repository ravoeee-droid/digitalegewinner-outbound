import { buildDailyOutboundPlan } from "@/lib/outbound-engine";
import { getCallSummary } from "@/lib/telephony";
import { query } from "@/lib/db";
import { listWebsiteProjects } from "@/lib/website-projects";
import { ensureRevenueOpportunitySchema } from "@/lib/revenue-opportunities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function workspaceOf(request: Request) {
  return new URL(request.url).searchParams.get("workspace") || "default";
}

export async function GET(request: Request) {
  try {
    const workspace = workspaceOf(request);
    await ensureRevenueOpportunitySchema();

    const [engine, callSummary, projects, pipelineRows, dueRows, dueCountRows] = await Promise.all([
      buildDailyOutboundPlan(workspace),
      getCallSummary(workspace),
      listWebsiteProjects(workspace),
      query<{ weighted: number; open_count: number }>(`
        select
          coalesce(sum((setup_value + monthly_value * 12) * probability / 100.0),0)::float8 weighted,
          count(*)::int open_count
        from sales_opportunities
        where workspace=$1 and status='open' and stage not in ('Gewonnen','Verloren')
      `, [workspace]),
      query<{ id: string; lead_id: string; company: string; phone: string; next_action: string; next_action_at: string; product_key: string; call_score: number }>(`
        select o.id,o.lead_id,c.name company,coalesce(ct.phone,c.phone,'') phone,o.next_action,o.next_action_at,o.product_key,
          (o.score*2 + l.priority_score*2 + l.opportunity_score + 420)::int call_score
        from sales_opportunities o
        join sales_leads l on l.id=o.lead_id and l.workspace=o.workspace
        join sales_companies c on c.id=o.company_id and c.workspace=o.workspace
        left join sales_contacts ct on ct.id=l.contact_id
        where o.workspace=$1 and o.status='open' and o.next_action_at is not null and o.next_action_at<=now()
          and coalesce(ct.phone,c.phone,'')<>''
        order by o.next_action_at asc,call_score desc
        limit 8
      `, [workspace]),
      query<{ count: number }>(`
        select count(*)::int count
        from sales_opportunities
        where workspace=$1 and status='open' and next_action_at is not null and next_action_at<=now()
      `, [workspace]),
    ]);

    const activeProjects = projects.filter((item) => item.status === "active" && item.progress < 100);
    const finishable = activeProjects
      .filter((item) => item.progress >= 65 && !item.blocker)
      .sort((a, b) => b.progress - a.progress)[0];
    const due = dueRows[0];
    const nextCall = engine.tasks.find((task) => task.channel === "call" && ["ready", "drafted", "queued"].includes(task.status));
    const fallbackProject = activeProjects.sort((a, b) => b.progress - a.progress)[0];

    let mission = {
      type: "pipeline",
      kicker: "SYSTEM READY",
      title: "Pipeline öffnen und den nächsten Umsatzhebel ziehen",
      detail: `${engine.channels.call.ready} Calls stehen bereit.`,
      actionLabel: "OUTBOUND ÖFFNEN",
      href: "/outbound",
      progress: 0,
    };

    if (finishable) {
      mission = {
        type: "build",
        kicker: "CLOSE THE LOOP",
        title: `${finishable.company} fertigziehen`,
        detail: `${finishable.progress}% · ${finishable.next_action || "Nächsten Website-Gate schließen"}`,
        actionLabel: "BUILD ÖFFNEN",
        href: `/websites#project-${finishable.id}`,
        progress: finishable.progress,
      };
    } else if (due) {
      mission = {
        type: "call",
        kicker: "JETZT FÄLLIG",
        title: `${due.company} anrufen`,
        detail: due.next_action || "Wiedervorlage ist fällig",
        actionLabel: "CALL MODE",
        href: "/call",
        progress: 0,
      };
    } else if (nextCall) {
      const payload = nextCall.payload || {};
      mission = {
        type: "call",
        kicker: "NEXT BEST ACTION",
        title: `${String(payload.company || "Nächsten Lead")} anrufen`,
        detail: `${engine.channels.call.ready} Calls bereit · Score ${nextCall.score}`,
        actionLabel: "CALL MODE",
        href: "/call",
        progress: 0,
      };
    } else if (fallbackProject) {
      mission = {
        type: "build",
        kicker: "BUILD QUEUE",
        title: `${fallbackProject.company} weiterbauen`,
        detail: `${fallbackProject.progress}% · ${fallbackProject.next_action}`,
        actionLabel: "BUILD ÖFFNEN",
        href: `/websites#project-${fallbackProject.id}`,
        progress: fallbackProject.progress,
      };
    }

    const callDone = Math.max(Number(engine.channels.call.done || 0), Number(callSummary.today || 0));
    const callTarget = Number(engine.channels.call.target || 120);
    const connected = Number(callSummary.connected || 0);
    const activeBuilds = activeProjects.length;
    const buildAverage = activeBuilds
      ? Math.round(activeProjects.reduce((sum, item) => sum + Number(item.progress || 0), 0) / activeBuilds)
      : 0;

    return Response.json({
      mission,
      metrics: {
        callsDone: callDone,
        callsTarget: callTarget,
        callsReady: Number(engine.channels.call.ready || 0),
        connected,
        connectRate: callDone > 0 ? Math.round(connected / callDone * 100) : 0,
        activeBuilds,
        buildAverage,
        dueFollowups: Number(dueCountRows[0]?.count || 0),
        weightedPipeline: Number(pipelineRows[0]?.weighted || 0),
        openOpportunities: Number(pipelineRows[0]?.open_count || 0),
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Mission Control konnte nicht geladen werden." }, { status: 503 });
  }
}
