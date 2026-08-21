import { query } from "@/lib/db";

export const runtime = "nodejs";

const pflegeFilter = `(lower(coalesce(c.industry,'')) like '%pflege%' or lower(c.name) like '%pflege%' or c.source like 'pflege%' or coalesce(c.metadata->>'campaign','') like 'pflege%')`;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspace = url.searchParams.get("workspace") || "default";
    const requested = Number(url.searchParams.get("limit") || 20);
    const limit = Math.max(1, Math.min(50, Number.isFinite(requested) ? Math.round(requested) : 20));

    const rows = await query<{ id: string; priority_score: number }>(
      `select l.id,l.priority_score
         from sales_leads l
         join sales_companies c on c.id=l.company_id
        where l.workspace=$1
          and l.status='active'
          and l.stage not in ('Gewonnen','Verloren')
          and ${pflegeFilter}
          and coalesce(c.metadata->'enrichment'->>'enrichedAt','')=''
        order by
          case when l.next_action_at is not null and l.next_action_at<=now() then 0 else 1 end,
          l.priority_score desc,
          l.updated_at desc
        limit $2`,
      [workspace, limit],
    );

    return Response.json({ ids: rows.map((row) => row.id), total: rows.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Research-Queue konnte nicht geladen werden." }, { status: 500 });
  }
}
