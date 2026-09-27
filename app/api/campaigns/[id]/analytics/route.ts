import { query } from "@/lib/db";
import { evaluateVariants, type VariantMetrics } from "@/lib/campaign-experiments";

export const runtime="nodejs";

type Row={
  variant:string;
  assigned:string;
  sent:string;
  replies:string;
  positive_replies:string;
  appointments:string;
  bounces:string;
};

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const rows=await query<Row>(
    `
    with assignments as (
      select
        coalesce(meta->>'variant','A') as variant,
        count(distinct lead_id)::text as assigned
      from er_events
      where workspace='default'
        and type='experiment_assignment'
        and meta->>'campaignId'=$1
      group by 1
    ),
    sent as (
      select
        coalesce(variant,'A') as variant,
        count(distinct lead_id)::text as sent
      from er_outbox
      where workspace='default'
        and campaign_id=$1
        and status='sent'
      group by 1
    ),
    replies as (
      select
        coalesce(meta->>'variant','A') as variant,
        count(distinct lead_id) filter (where type='reply')::text as replies,
        count(distinct lead_id) filter (where type='positive_reply')::text as positive_replies,
        count(distinct lead_id) filter (where type in ('appointment','appointment_attended'))::text as appointments,
        count(distinct lead_id) filter (where type='bounce')::text as bounces
      from er_events
      where workspace='default'
        and meta->>'campaignId'=$1
        and type in ('reply','positive_reply','appointment','appointment_attended','bounce')
      group by 1
    ),
    variants as (
      select variant from assignments
      union select variant from sent
      union select variant from replies
    )
    select
      v.variant,
      coalesce(a.assigned,'0') as assigned,
      coalesce(s.sent,'0') as sent,
      coalesce(r.replies,'0') as replies,
      coalesce(r.positive_replies,'0') as positive_replies,
      coalesce(r.appointments,'0') as appointments,
      coalesce(r.bounces,'0') as bounces
    from variants v
    left join assignments a using(variant)
    left join sent s using(variant)
    left join replies r using(variant)
    order by v.variant
    `,
    [id],
  );
  const metrics:VariantMetrics[]=rows.map((r)=>({
    variant:r.variant,
    assigned:Number(r.assigned),
    sent:Number(r.sent),
    replies:Number(r.replies),
    positiveReplies:Number(r.positive_replies),
    appointments:Number(r.appointments),
    bounces:Number(r.bounces),
  }));
  const variants=evaluateVariants(metrics);
  const total=metrics.reduce((acc,row)=>({
    assigned:acc.assigned+row.assigned,
    sent:acc.sent+row.sent,
    replies:acc.replies+row.replies,
    positiveReplies:acc.positiveReplies+row.positiveReplies,
    appointments:acc.appointments+row.appointments,
    bounces:acc.bounces+row.bounces,
  }),{assigned:0,sent:0,replies:0,positiveReplies:0,appointments:0,bounces:0});
  return Response.json({ok:true,campaignId:id,total,variants,generatedAt:new Date().toISOString()});
}
