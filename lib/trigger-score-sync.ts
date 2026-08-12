import { query } from "./db";
import { ensureTriggerSchema } from "./sales-triggers";

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

type ScoreRow = {
  id: string;
  company_id: string;
  intent_score: number;
  fit_score: number;
  opportunity_score: number;
  email: string;
  phone: string;
  linkedin: string;
  instagram: string;
  trigger_intent: number;
};

function contactability(row: ScoreRow) {
  return clamp((row.email ? 45 : 0) + (row.phone ? 30 : 0) + (row.linkedin ? 15 : 0) + (row.instagram ? 10 : 0));
}

export async function restoreTriggerScores(workspace = "default") {
  await ensureTriggerSchema();
  const rows = await query<ScoreRow>(
    `select l.id,l.company_id,l.intent_score,l.fit_score,l.opportunity_score,
            coalesce(ct.email,'') as email,coalesce(ct.phone,c.phone,'') as phone,
            coalesce(ct.linkedin,'') as linkedin,coalesce(ct.instagram,'') as instagram,
            coalesce((select sum(t.weight)::int from sales_triggers t where t.workspace=l.workspace and t.company_id=l.company_id and t.status='active' and t.detected_at>=now()-interval '30 days'),0)::int as trigger_intent
     from sales_leads l
     join sales_companies c on c.id=l.company_id
     left join sales_contacts ct on ct.id=l.contact_id
     where l.workspace=$1 and l.status='active'`,
    [workspace],
  );

  let changed = 0;
  for (const row of rows) {
    const intentScore = clamp(Math.max(Number(row.intent_score || 0), Number(row.trigger_intent || 0)));
    const contactScore = contactability(row);
    const priorityScore = clamp(Number(row.opportunity_score || 0) * 0.42 + Number(row.fit_score || 0) * 0.28 + contactScore * 0.2 + intentScore * 0.25);
    await query(
      "update sales_leads set intent_score=$3,priority_score=$4,updated_at=case when intent_score<>$3 or priority_score<>$4 then now() else updated_at end where workspace=$1 and id=$2",
      [workspace, row.id, intentScore, priorityScore],
    );
    await query("update sales_companies set latest_score=$3 where workspace=$1 and id=$2 and latest_score<>$3", [workspace, row.company_id, priorityScore]);
    if (intentScore !== Number(row.intent_score || 0)) changed += 1;
  }
  return { checked: rows.length, changed };
}
