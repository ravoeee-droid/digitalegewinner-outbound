import { query } from "@/lib/db";
import { classifyLeadSegment } from "@/lib/lead-segment";
import { ensureRevenueOpportunitySchema } from "@/lib/revenue-opportunities";

// Ein Reply ist nur dann ein Verkaufsinteressent, wenn er explizit Interesse,
// einen Termin/Rückruf oder weitere Informationen signalisiert.
const INTEREST_CLASSES = new Set(["positive", "meeting_intent", "needs_information"]);
const EARLY_STAGES = ["Neu", "Geprüft", "Call bereit", "Kontaktiert", "Info angefragt", "Info versendet", "Nachfassen"];

export async function reflectInterestedReply(input: {
  leadId: string;
  replyClass: string;
  messageId: string;
}): Promise<boolean> {
  if (!INTEREST_CLASSES.has(input.replyClass)) return false;
  await ensureRevenueOpportunitySchema();

  const [lead] = await query<{ id: string; company_id: string; do_not_contact: boolean; status: string }>(
    "select id,company_id,coalesce(do_not_contact,false) do_not_contact,status from sales_leads where workspace='default' and id=$1 limit 1",
    [input.leadId],
  );
  if (!lead || lead.do_not_contact || lead.status !== "active") return false;

  const stage = input.replyClass === "needs_information" ? "Info angefragt" : "Interesse";
  const action = input.replyClass === "needs_information" ? "Gewünschte Informationen persönlich senden" :
    input.replyClass === "meeting_intent" ? "Rückruf / Termin jetzt vereinbaren" : "Interessent sofort persönlich kontaktieren";
  const probability = input.replyClass === "needs_information" ? 25 : 40;

  const opportunities = await query<{ id: string; stage: string; product_key: string }>(
    `select id,stage,product_key from sales_opportunities
     where workspace='default' and lead_id=$1 and status='open'
     order by case when stage = 'Interesse' then 0
                   when stage = 'Info angefragt' then 1
                   when stage = 'Call bereit' then 2 else 3 end,updated_at desc`,
    [input.leadId],
  );
  const editable = opportunities.find(o => EARLY_STAGES.includes(o.stage));
  if (editable) {
    // Eine Info-Anfrage darf einen bereits bestätigten Interessenten nicht herabstufen.
    const nextStage = editable.stage === "Interesse" ? "Interesse" : stage;
    await query(
      `update sales_opportunities
       set stage=$2,probability=greatest(probability,$3),score=greatest(score,75),
           next_action=$4,next_action_at=now(),updated_at=now()
       where id=$1 and workspace='default' and status='open'`,
      [editable.id,nextStage,probability,action],
    );
  } else if (opportunities.length === 0) {
    // Keine willkürliche Website-/Recruiting-Leistung oder Angebotssumme annehmen.
    const [company] = await query<{name:string;industry:string;source:string;metadata:Record<string,unknown>}>(
      "select name,coalesce(industry,'') industry,coalesce(source,'') source,metadata from sales_companies where workspace='default' and id=$1 limit 1",
      [lead.company_id],
    );
    if (!company) return false;
    const segment = classifyLeadSegment({ company:company.name,industry:company.industry,source:company.source,metadata:company.metadata });
    await query(
      `insert into sales_opportunities(
        id,workspace,lead_id,company_id,product_key,stage,status,source,
        setup_value,monthly_value,probability,score,next_action,next_action_at
       ) values($1,'default',$2,$3,'inbound_interest',$4,'open',$5,0,0,$6,75,$7,now())
       on conflict(workspace,lead_id,product_key) do update
       set stage=case when sales_opportunities.status='open'
                    and sales_opportunities.stage in ('Neu','Geprüft','Call bereit','Kontaktiert','Info angefragt','Info versendet','Nachfassen')
                    then excluded.stage else sales_opportunities.stage end,
           probability=greatest(sales_opportunities.probability,excluded.probability),
           next_action=case when sales_opportunities.status='open' then excluded.next_action else sales_opportunities.next_action end,
           next_action_at=case when sales_opportunities.status='open' then now() else sales_opportunities.next_action_at end,
           updated_at=now()`,
      [crypto.randomUUID(),input.leadId,lead.company_id,stage,"inbound:"+segment,probability,action],
    );
  }

  // Idempotente Vertriebsaktivität für die Nachvollziehbarkeit in der Lead-Akte.
  await query(
    `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
     select 'default',$1,$2,'revenue.reply',$3,$4::jsonb
     where not exists (
       select 1 from sales_activities
       where workspace='default' and lead_id=$1 and type='revenue.reply' and meta->>'messageId'=$5
     )`,
    [input.leadId,lead.company_id,`Interessenten-Antwort · ${stage}`,
      JSON.stringify({messageId:input.messageId,replyClass:input.replyClass,stage}),input.messageId],
  );
  return true;
}
