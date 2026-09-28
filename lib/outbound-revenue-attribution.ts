import { createHash } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { recordOutboundEventByMode } from "@/lib/outbound-event-ledger";

export const ATTRIBUTION_POLICY_VERSION="dg-attribution-2026-09-27-v1";
const ATTRIBUTION_WINDOW_DAYS=180;

type CampaignStep={waitDays:number;subject:string;body:string;variants?:Array<{label:string;subject:string;body:string}>};
type AttributionInput={
  factKey:string;
  factType:"meeting_booked"|"meeting_held"|"opportunity_created"|"won"|"lost"|"revenue";
  sourceKind:"outbound_event"|"sales_opportunity"|"manual"|"calendar"|"crm";
  sourceId:string;
  leadId:string|null;
  companyId:string|null;
  opportunityId:string|null;
  occurredAt:Date;
  amount:number|null;
  currency:string;
  revenueKind:string|null;
  metadata:Record<string,unknown>;
};
type ExposureRow={
  id:string;campaign_version_id:string|null;experiment_id:string;arm_key:string;lead_id:string;
  company_id:string|null;exposed_at:Date;
};
const manualSchema=z.object({
  factType:z.enum(["meeting_booked","meeting_held","won","lost","revenue"]),
  leadId:z.string().min(1),
  opportunityId:z.string().min(1).optional().nullable(),
  amount:z.number().nonnegative().optional().nullable(),
  currency:z.string().length(3).default("EUR"),
  occurredAt:z.coerce.date().optional(),
  note:z.string().max(2000).optional().default(""),
});

function sha(value:string){return createHash("sha256").update(value).digest("hex")}

export async function ensureLegacyCampaignVersionForAttribution(input:{
  campaignId:string;campaignName?:string;audience?:string;steps:CampaignStep[];workspace?:string;
}){
  const workspace=input.workspace??"default";
  const contentHash=sha(JSON.stringify({
    campaignId:input.campaignId,
    steps:input.steps.map(step=>({
      waitDays:step.waitDays,subject:step.subject,body:step.body,
      variants:(step.variants||[]).map(v=>({label:v.label,subject:v.subject,body:v.body})),
    })),
  }));
  const campaignKey=`legacy:${input.campaignId}`;
  let [row]=await query<{id:string;version:number}>(
    `select id,version from outbound_campaign_versions
     where workspace=$1 and campaign_key=$2 and content_hash=$3
     order by version desc limit 1`,
    [workspace,campaignKey,contentHash],
  );
  if(row)return row;
  const [latest]=await query<{version:number}>(
    `select version from outbound_campaign_versions
     where workspace=$1 and campaign_key=$2 order by version desc limit 1`,
    [workspace,campaignKey],
  );
  [row]=await query<{id:string;version:number}>(
    `insert into outbound_campaign_versions(
       workspace,campaign_key,version,status,name,audience_definition,offer_definition,steps,
       content_hash,created_by,approved_by,approved_at,published_at
     )
     values($1,$2,$3,'running',$4,$5::jsonb,'{}'::jsonb,$6::jsonb,$7,'legacy-attribution-bridge','system',now(),now())
     returning id,version`,
    [
      workspace,campaignKey,Number(latest?.version||0)+1,input.campaignName||input.campaignId,
      JSON.stringify({source:"legacy",description:input.audience||null}),JSON.stringify(input.steps),contentHash,
    ],
  );
  if(!row)throw new Error("Campaign version could not be created.");
  return row;
}

async function resolveLeadCompany(leadId:string|null,companyId:string|null){
  if(companyId)return {companyId,leadId};
  if(!leadId)return {companyId:null,leadId:null};
  const [lead]=await query<{company_id:string|null}>(
    `select company_id from sales_leads where workspace='default' and id=$1 limit 1`,
    [leadId],
  );
  return {companyId:lead?.company_id??null,leadId};
}

async function findAttributionExposure(input:{leadId:string|null;companyId:string|null;occurredAt:Date}){
  const refs=await resolveLeadCompany(input.leadId,input.companyId);
  if(refs.companyId){
    const [row]=await query<ExposureRow>(
      `select id,campaign_version_id,experiment_id,arm_key,lead_id,company_id,exposed_at
       from outbound_experiment_exposures
       where workspace='default' and company_id=$1
         and exposed_at<=$2 and exposed_at>=$2-($3::text||' days')::interval
       order by exposed_at desc limit 1`,
      [refs.companyId,input.occurredAt,ATTRIBUTION_WINDOW_DAYS],
    );
    if(row)return {exposure:row,confidence:0.95,model:"last_company_exposure_before_conversion"};
  }
  if(input.leadId){
    const [row]=await query<ExposureRow>(
      `select id,campaign_version_id,experiment_id,arm_key,lead_id,company_id,exposed_at
       from outbound_experiment_exposures
       where workspace='default' and lead_id=$1
         and exposed_at<=$2 and exposed_at>=$2-($3::text||' days')::interval
       order by exposed_at desc limit 1`,
      [input.leadId,input.occurredAt,ATTRIBUTION_WINDOW_DAYS],
    );
    if(row)return {exposure:row,confidence:0.85,model:"last_lead_exposure_before_conversion"};
  }

  // Non-experiment messages still carry campaign_version_id in er_outbox after M9 launch bridge.
  if(refs.companyId){
    const [row]=await query<{
      id:string;campaign_version_id:string|null;experiment_id:string|null;experiment_arm_key:string|null;lead_id:string;sent_at:Date
    }>(
      `select o.id,o.campaign_version_id,o.experiment_id,o.experiment_arm_key,o.lead_id,o.sent_at
       from er_outbox o
       join sales_leads l on l.id=o.lead_id and l.workspace=o.workspace
       where o.workspace='default' and l.company_id=$1 and o.status='sent' and o.campaign_version_id is not null
         and o.sent_at<=$2 and o.sent_at>=$2-($3::text||' days')::interval
       order by o.sent_at desc limit 1`,
      [refs.companyId,input.occurredAt,ATTRIBUTION_WINDOW_DAYS],
    );
    if(row)return {
      exposure:{
        id:"",
        campaign_version_id:row.campaign_version_id,
        experiment_id:row.experiment_id||"",
        arm_key:row.experiment_arm_key||"",
        lead_id:row.lead_id,
        company_id:refs.companyId,
        exposed_at:row.sent_at,
      },
      confidence:0.9,
      model:"last_company_message_before_conversion",
    };
  }
  return {exposure:null,confidence:0,model:"unattributed"};
}

async function upsertFact(input:AttributionInput){
  const refs=await resolveLeadCompany(input.leadId,input.companyId);
  const attribution=await findAttributionExposure({leadId:input.leadId,companyId:refs.companyId,occurredAt:input.occurredAt});
  const exposure=attribution.exposure;
  const [row]=await query<{id:string}>(
    `insert into outbound_attribution_facts(
       workspace,fact_key,fact_type,source_kind,source_id,lead_id,company_id,opportunity_id,
       occurred_at,amount,currency,revenue_kind,campaign_version_id,experiment_id,experiment_arm_key,
       exposure_id,attribution_model,attribution_confidence,metadata
     )
     values(
       'default',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb
     )
     on conflict(workspace,fact_key) do update
       set lead_id=excluded.lead_id,
           company_id=excluded.company_id,
           opportunity_id=excluded.opportunity_id,
           occurred_at=excluded.occurred_at,
           amount=excluded.amount,
           currency=excluded.currency,
           revenue_kind=excluded.revenue_kind,
           campaign_version_id=excluded.campaign_version_id,
           experiment_id=excluded.experiment_id,
           experiment_arm_key=excluded.experiment_arm_key,
           exposure_id=excluded.exposure_id,
           attribution_model=excluded.attribution_model,
           attribution_confidence=excluded.attribution_confidence,
           metadata=outbound_attribution_facts.metadata||excluded.metadata
     returning id`,
    [
      input.factKey,input.factType,input.sourceKind,input.sourceId,input.leadId,refs.companyId,input.opportunityId,
      input.occurredAt,input.amount,input.currency,input.revenueKind,
      exposure?.campaign_version_id||null,exposure?.experiment_id||null,exposure?.arm_key||null,
      exposure?.id||null,attribution.model,attribution.confidence,
      JSON.stringify({...input.metadata,attributionWindowDays:ATTRIBUTION_WINDOW_DAYS}),
    ],
  );
  return {id:row?.id??null,attributed:Boolean(exposure?.campaign_version_id),campaignVersionId:exposure?.campaign_version_id||null};
}

// Each fact is its own upsert round trip, and a full backlog can mean hundreds of
// them sequentially - easily 60s+ against Neon's per-query latency, which Vercel
// then hard-kills mid-loop instead of returning a clean response. The unprocessed-only
// queries below already make this safe to resume (a killed run just leaves fewer facts
// written; the next cron tick picks up exactly where it left off), so this budget just
// stops before the platform does and returns cleanly instead of crashing.
const SYNC_BUDGET_MS=42_000;

export async function syncRevenueAttribution(){
  const startedAt=Date.now();
  const withinBudget=()=>Date.now()-startedAt<SYNC_BUDGET_MS;
  const events=await query<{
    id:string;event_type:string;lead_id:string|null;company_id:string|null;occurred_at:Date;payload:Record<string,unknown>
  }>(
    `select e.id,e.event_type,e.lead_id,e.company_id,e.occurred_at,e.payload
     from outbound_events e
     where e.workspace='default'
       and e.event_type=any($1::text[])
       and not (e.payload ? 'attributionFactId')
       and e.occurred_at>=now()-interval '365 days'
       and not exists(
         select 1 from outbound_attribution_facts f
         where f.workspace=e.workspace and f.fact_key='event:'||e.id::text
       )
     order by e.occurred_at asc
     limit 250`,
    [["meeting_booked","meeting_held","opportunity_created","won","lost","revenue_recorded"]],
  );
  let eventFacts=0;
  for(const event of events){
    if(!withinBudget())break;
    const factType=event.event_type==="revenue_recorded"?"revenue":event.event_type as AttributionInput["factType"];
    const amountRaw=event.payload?.amount;
    const amount=typeof amountRaw==="number"?amountRaw:typeof amountRaw==="string"&&Number.isFinite(Number(amountRaw))?Number(amountRaw):null;
    await upsertFact({
      factKey:`event:${event.id}`,factType,sourceKind:"outbound_event",sourceId:event.id,
      leadId:event.lead_id,companyId:event.company_id,opportunityId:String(event.payload?.opportunityId||"")||null,
      occurredAt:event.occurred_at,amount,currency:String(event.payload?.currency||"EUR").slice(0,3).toUpperCase(),
      revenueKind:factType==="revenue"?String(event.payload?.revenueKind||"recorded"):null,
      metadata:{sourceEventType:event.event_type},
    });
    eventFacts++;
  }

  const opportunities=!withinBudget()?[]:await query<{
    id:string;lead_id:string|null;company_id:string|null;stage:string|null;status:string|null;
    setup_value:number|null;monthly_value:number|null;created_at:Date;updated_at:Date
  }>(
    `select o.id,o.lead_id,o.company_id,o.stage,o.status,o.setup_value,o.monthly_value,o.created_at,o.updated_at
     from sales_opportunities o
     left join outbound_attribution_facts f
       on f.workspace=o.workspace
      and f.fact_key='opportunity:'||o.id||':created'
     where o.workspace='default'
       and o.created_at>=now()-interval '365 days'
       and (f.id is null or o.updated_at>f.updated_at)
     order by case when f.id is null then 0 else 1 end,o.updated_at desc
     limit 100`
  );
  let opportunityFacts=0,wonFacts=0,revenueFacts=0,lostFacts=0;
  for(const opportunity of opportunities){
    if(!withinBudget())break;
    await upsertFact({
      factKey:`opportunity:${opportunity.id}:created`,factType:"opportunity_created",
      sourceKind:"sales_opportunity",sourceId:opportunity.id,leadId:opportunity.lead_id,
      companyId:opportunity.company_id,opportunityId:opportunity.id,occurredAt:opportunity.created_at,
      amount:null,currency:"EUR",revenueKind:null,
      metadata:{stage:opportunity.stage,status:opportunity.status},
    });
    opportunityFacts++;

    const state=`${opportunity.stage||""} ${opportunity.status||""}`.toLowerCase();
    const won=/\bgewonnen\b|\bwon\b|closed[_ -]?won|erfolgreich abgeschlossen/.test(state);
    const lost=/\bverloren\b|\blost\b|closed[_ -]?lost|abgelehnt/.test(state);
    if(won){
      await upsertFact({
        factKey:`opportunity:${opportunity.id}:won`,factType:"won",sourceKind:"sales_opportunity",
        sourceId:opportunity.id,leadId:opportunity.lead_id,companyId:opportunity.company_id,
        opportunityId:opportunity.id,occurredAt:opportunity.updated_at,amount:null,currency:"EUR",revenueKind:null,
        metadata:{stage:opportunity.stage,status:opportunity.status},
      });
      wonFacts++;
      const amount=Number(opportunity.setup_value||0)+12*Number(opportunity.monthly_value||0);
      if(amount>0){
        await upsertFact({
          factKey:`opportunity:${opportunity.id}:booked12m`,factType:"revenue",sourceKind:"sales_opportunity",
          sourceId:opportunity.id,leadId:opportunity.lead_id,companyId:opportunity.company_id,
          opportunityId:opportunity.id,occurredAt:opportunity.updated_at,amount,currency:"EUR",
          revenueKind:"booked_12m_contract_value",
          metadata:{setupValue:Number(opportunity.setup_value||0),monthlyValue:Number(opportunity.monthly_value||0),months:12,notCashCollected:true},
        });
        revenueFacts++;
      }
    }else if(lost){
      await upsertFact({
        factKey:`opportunity:${opportunity.id}:lost`,factType:"lost",sourceKind:"sales_opportunity",
        sourceId:opportunity.id,leadId:opportunity.lead_id,companyId:opportunity.company_id,
        opportunityId:opportunity.id,occurredAt:opportunity.updated_at,amount:null,currency:"EUR",revenueKind:null,
        metadata:{stage:opportunity.stage,status:opportunity.status},
      });
      lostFacts++;
    }
  }
  const [backlog]=await query<{count:string}>(
    `select count(*)::text as count
     from sales_opportunities o
     left join outbound_attribution_facts f
       on f.workspace=o.workspace and f.fact_key='opportunity:'||o.id||':created'
     where o.workspace='default'
       and o.created_at>=now()-interval '365 days'
       and (f.id is null or o.updated_at>f.updated_at)`
  );
  return {eventFacts,opportunityFacts,wonFacts,lostFacts,revenueFacts,opportunityBacklog:Number(backlog?.count||0)};
}

export async function recordManualAttributionFact(raw:z.infer<typeof manualSchema>,actorId="admin-session"){
  const input=manualSchema.parse(raw);
  const [lead]=await query<{company_id:string|null}>(
    `select company_id from sales_leads where workspace='default' and id=$1 limit 1`,
    [input.leadId],
  );
  if(!lead)throw new Error("Lead not found.");
  const occurredAt=input.occurredAt||new Date();
  const sourceId=`manual:${sha(JSON.stringify({input,occurredAt:occurredAt.toISOString(),actorId})).slice(0,24)}`;
  const result=await upsertFact({
    factKey:sourceId,factType:input.factType,sourceKind:"manual",sourceId,
    leadId:input.leadId,companyId:lead.company_id,opportunityId:input.opportunityId??null,
    occurredAt,amount:input.amount??null,currency:input.currency.toUpperCase(),
    revenueKind:input.factType==="revenue"?"manual_recorded":null,
    metadata:{note:input.note,recordedBy:actorId},
  });
  await recordOutboundEventByMode({
    workspace:"default",
    type:input.factType==="revenue"?"revenue_recorded":input.factType,
    actorType:"human",actorId,leadId:input.leadId,companyId:lead.company_id,
    campaignVersionId:result.campaignVersionId,
    idempotencyKey:`manual-attribution-event:${sourceId}`,
    payload:{sourceId,attributionFactId:result.id,amount:input.amount??null,currency:input.currency,note:input.note,attributed:result.attributed},
  });
  return result;
}

export async function getRevenueAttributionDashboard(){
  const [summary]=await query<{
    facts:string;attributed:string;meetings:string;opportunities:string;wins:string;revenue:string
  }>(
    `select
       count(*)::text as facts,
       count(*) filter(where campaign_version_id is not null)::text as attributed,
       count(*) filter(where fact_type='meeting_booked')::text as meetings,
       count(*) filter(where fact_type='opportunity_created')::text as opportunities,
       count(*) filter(where fact_type='won')::text as wins,
       coalesce(sum(amount) filter(where fact_type='revenue'),0)::text as revenue
     from outbound_attribution_facts where workspace='default'`
  );
  const campaigns=await query<{
    campaign_version_id:string;campaign_name:string;campaign_key:string;version:number;experiment_id:string|null;
    experiment_arm_key:string|null;exposed:string;meetings:string;opportunities:string;wins:string;revenue:string
  }>(
    `with exposure as (
       select
         coalesce(x.campaign_version_id,o.campaign_version_id) as campaign_version_id,
         x.experiment_id,
         x.arm_key as experiment_arm_key,
         count(distinct x.subject_id)::int as exposed
       from outbound_experiment_exposures x
       left join er_outbox o on o.id=x.legacy_outbox_id
       where x.workspace='default'
       group by 1,2,3
     ),
     nonexp as (
       select o.campaign_version_id,null::uuid as experiment_id,null::text as experiment_arm_key,
              count(distinct coalesce(l.company_id,o.lead_id))::int as exposed
       from er_outbox o
       left join sales_leads l on l.id=o.lead_id and l.workspace=o.workspace
       where o.workspace='default' and o.status='sent' and o.campaign_version_id is not null and o.experiment_id is null
       group by o.campaign_version_id
     ),
     all_exp as (
       select * from exposure
       union all select * from nonexp
     ),
     facts as (
       select campaign_version_id,experiment_id,experiment_arm_key,
              count(*) filter(where fact_type='meeting_booked')::int as meetings,
              count(*) filter(where fact_type='opportunity_created')::int as opportunities,
              count(*) filter(where fact_type='won')::int as wins,
              coalesce(sum(amount) filter(where fact_type='revenue'),0)::numeric as revenue
       from outbound_attribution_facts
       where workspace='default' and campaign_version_id is not null
       group by campaign_version_id,experiment_id,experiment_arm_key
     )
     select cv.id as campaign_version_id,cv.name as campaign_name,cv.campaign_key,cv.version,
            ae.experiment_id,ae.experiment_arm_key,ae.exposed::text,
            coalesce(f.meetings,0)::text as meetings,coalesce(f.opportunities,0)::text as opportunities,
            coalesce(f.wins,0)::text as wins,coalesce(f.revenue,0)::text as revenue
     from all_exp ae
     join outbound_campaign_versions cv on cv.id=ae.campaign_version_id
     left join facts f on f.campaign_version_id=ae.campaign_version_id
       and f.experiment_id is not distinct from ae.experiment_id
       and f.experiment_arm_key is not distinct from ae.experiment_arm_key
     order by cv.created_at desc,ae.experiment_arm_key nulls first`
  );
  const recent=await query<{
    id:string;fact_type:string;lead_id:string|null;company_id:string|null;opportunity_id:string|null;occurred_at:Date;
    amount:number|null;currency:string;revenue_kind:string|null;campaign_version_id:string|null;experiment_arm_key:string|null;
    attribution_model:string;attribution_confidence:number;company_name:string|null
  }>(
    `select f.id,f.fact_type,f.lead_id,f.company_id,f.opportunity_id,f.occurred_at,f.amount,f.currency,
            f.revenue_kind,f.campaign_version_id,f.experiment_arm_key,f.attribution_model,f.attribution_confidence,
            c.name as company_name
     from outbound_attribution_facts f
     left join sales_companies c on c.id=f.company_id and c.workspace=f.workspace
     where f.workspace='default'
     order by f.occurred_at desc limit 100`
  );
  return {
    policyVersion:ATTRIBUTION_POLICY_VERSION,
    attributionWindowDays:ATTRIBUTION_WINDOW_DAYS,
    summary:{
      facts:Number(summary?.facts||0),attributed:Number(summary?.attributed||0),
      meetings:Number(summary?.meetings||0),opportunities:Number(summary?.opportunities||0),
      wins:Number(summary?.wins||0),revenue:Number(summary?.revenue||0),
    },
    campaigns:campaigns.map(row=>{
      const exposed=Number(row.exposed||0),revenue=Number(row.revenue||0);
      return {...row,exposed,meetings:Number(row.meetings),opportunities:Number(row.opportunities),wins:Number(row.wins),revenue,revenuePer100:exposed?revenue/exposed*100:0};
    }),
    recent,
  };
}
