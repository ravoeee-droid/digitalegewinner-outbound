import { createHash, randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { recordOutboundEventByMode } from "@/lib/outbound-event-ledger";
import { evaluateAutonomy } from "@/lib/outbound-policy";
import { resolveOutboundRuntimeConfig } from "@/lib/outbound-runtime-config";
import type { ExperimentMetric } from "@/lib/outbound-contracts";

export const EXPERIMENT_POLICY_VERSION="dg-experiment-2026-09-27-v1";

type LegacyVariant={label:string;subject:string;body:string};
type LegacyStep={waitDays:number;subject:string;body:string;variants?:LegacyVariant[]};
type ExperimentRow={
  id:string;workspace:string;campaign_version_id:string;experiment_key:string;version:number;
  status:"draft"|"review"|"running"|"paused"|"completed"|"archived";hypothesis:string;
  primary_metric:ExperimentMetric;guardrail_metrics:ExperimentMetric[];randomization_unit:"company"|"contact"|"lead";
  minimum_sample_per_arm:number;practical_effect_threshold:number;stop_policy:Record<string,unknown>;
  legacy_campaign_id:string|null;content_hash:string|null;control_arm_key:string|null;safety_stop_enabled:boolean;
  paused_at:Date|null;pause_reason:string|null;
};
type ArmRow={experiment_id:string;arm_key:string;label:string;weight:number;strategy:Record<string,unknown>;status:"active"|"paused"};
type OutcomeRow={
  arm_key:string;n:string;replies:string;positive_replies:string;qualified_meetings:string;
  meetings_held:string;opportunities:string;wins:string;bounces:string;complaints:string;
  unsubscribes:string;revenue:string;
};

const rateMetrics=new Set<ExperimentMetric>([
  "reply_rate","positive_reply_rate","qualified_meeting_rate","meeting_held_rate",
  "opportunity_rate","won_rate","bounce_rate","complaint_rate","unsubscribe_rate",
]);
const lowerIsBetter=new Set<ExperimentMetric>(["bounce_rate","complaint_rate","unsubscribe_rate"]);

function sha(value:string){return createHash("sha256").update(value).digest("hex")}
function stableJson(value:unknown){return JSON.stringify(value)}
function normalizedCompany(value:string){return value.trim().toLowerCase().replace(/\s+/g," ").slice(0,400)}
function companySubjectId(companyId:string|undefined|null,companyName:string){
  return companyId?.trim()||`name:${sha(normalizedCompany(companyName)).slice(0,32)}`;
}
function hashFloat(value:string){
  const hex=sha(value).slice(0,13);
  return Number.parseInt(hex,16)/0x10000000000000;
}
function chooseWeightedArm(arms:ArmRow[],seed:string){
  const active=arms.filter(arm=>arm.status==="active");
  const pool=active.length?active:arms;
  const total=pool.reduce((sum,arm)=>sum+Number(arm.weight),0)||1;
  const point=hashFloat(seed)*total;
  let cursor=0;
  for(const arm of pool){
    cursor+=Number(arm.weight);
    if(point<cursor)return arm;
  }
  return pool[pool.length-1];
}

function erf(x:number){
  const sign=x<0?-1:1;
  const ax=Math.abs(x);
  const t=1/(1+0.3275911*ax);
  const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-ax*ax);
  return sign*y;
}
function normalCdf(x:number){return 0.5*(1+erf(x/Math.sqrt(2)))}
function twoProportionP(x1:number,n1:number,x2:number,n2:number){
  if(n1<=0||n2<=0)return 1;
  const p=(x1+x2)/(n1+n2);
  const se=Math.sqrt(Math.max(0,p*(1-p)*(1/n1+1/n2)));
  if(!se)return 1;
  const z=Math.abs(x1/n1-x2/n2)/se;
  return Math.max(0,Math.min(1,2*(1-normalCdf(z))));
}
function wilson(x:number,n:number,z=1.959963984540054){
  if(!n)return {low:0,high:0};
  const p=x/n;
  const denom=1+z*z/n;
  const center=(p+z*z/(2*n))/denom;
  const margin=(z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/denom;
  return {low:Math.max(0,center-margin),high:Math.min(1,center+margin)};
}
function srmPValue(observed:number[],expectedWeights:number[]){
  const total=observed.reduce((a,b)=>a+b,0);
  if(total<=0||observed.length<2)return 1;
  let chi=0;
  for(let i=0;i<observed.length;i++){
    const expected=total*expectedWeights[i];
    if(expected<=0)continue;
    chi+=(observed[i]-expected)**2/expected;
  }
  const df=observed.length-1;
  if(df===1)return Math.max(0,Math.min(1,2*(1-normalCdf(Math.sqrt(Math.max(0,chi))))));
  const z=(Math.pow(Math.max(chi,1e-12)/df,1/3)-(1-2/(9*df)))/Math.sqrt(2/(9*df));
  return Math.max(0,Math.min(1,1-normalCdf(z)));
}

function metricParts(row:OutcomeRow,metric:ExperimentMetric){
  const n=Number(row.n||0);
  const counts:Record<Exclude<ExperimentMetric,"revenue_per_100_companies">,number>={
    reply_rate:Number(row.replies||0),
    positive_reply_rate:Number(row.positive_replies||0),
    qualified_meeting_rate:Number(row.qualified_meetings||0),
    meeting_held_rate:Number(row.meetings_held||0),
    opportunity_rate:Number(row.opportunities||0),
    won_rate:Number(row.wins||0),
    bounce_rate:Number(row.bounces||0),
    complaint_rate:Number(row.complaints||0),
    unsubscribe_rate:Number(row.unsubscribes||0),
  };
  if(metric==="revenue_per_100_companies"){
    const revenue=Number(row.revenue||0);
    return {n,count:null,value:n?revenue/n*100:0,revenue};
  }
  const count=counts[metric];
  return {n,count,value:n?count/n:0,revenue:null};
}

function defaultStopPolicy(){
  return {
    alpha:0.05,
    srmAlpha:0.01,
    minimumGuardrailSample:20,
    guardrailAbsoluteDeltas:{
      bounce_rate:0.02,
      complaint_rate:0.003,
      unsubscribe_rate:0.03,
    },
    guardrailHardCeilings:{
      bounce_rate:0.05,
      complaint_rate:0.003,
      unsubscribe_rate:0.10,
    },
  };
}
function numberFromPolicy(policy:Record<string,unknown>,key:string,fallback:number){
  const v=Number(policy[key]);
  return Number.isFinite(v)?v:fallback;
}
function nestedNumber(policy:Record<string,unknown>,group:string,key:string,fallback:number){
  const obj=policy[group];
  if(!obj||typeof obj!=="object")return fallback;
  const v=Number((obj as Record<string,unknown>)[key]);
  return Number.isFinite(v)?v:fallback;
}

export async function ensureLegacySequenceExperiment(input:{
  campaignId:string;
  campaignName?:string;
  audience?:string;
  steps:LegacyStep[];
  workspace?:string;
}){
  const workspace=input.workspace??"default";
  const variantSteps=input.steps.filter(step=>step.variants?.length);
  if(!variantSteps.length)return null;
  const labels=variantSteps[0].variants!.map(v=>v.label);
  if(labels.length<2)return null;
  for(const step of variantSteps){
    const current=(step.variants||[]).map(v=>v.label);
    if(current.length!==labels.length||current.some(label=>!labels.includes(label))){
      throw new Error("Alle experimentellen Schritte müssen dieselben Varianten enthalten.");
    }
  }

  const contentHash=sha(stableJson({
    campaignId:input.campaignId,
    steps:input.steps.map(step=>({
      waitDays:step.waitDays,subject:step.subject,body:step.body,
      variants:(step.variants||[]).map(v=>({label:v.label,subject:v.subject,body:v.body})),
    })),
  }));
  const campaignKey=`legacy:${input.campaignId}`;

  let [campaignVersion]=await query<{id:string;version:number;content_hash:string|null}>(
    `select id,version,content_hash
     from outbound_campaign_versions
     where workspace=$1 and campaign_key=$2 and content_hash=$3
     order by version desc limit 1`,
    [workspace,campaignKey,contentHash],
  );
  if(!campaignVersion){
    const [latest]=await query<{version:number}>(
      `select version from outbound_campaign_versions
       where workspace=$1 and campaign_key=$2
       order by version desc limit 1`,
      [workspace,campaignKey],
    );
    [campaignVersion]=await query<{id:string;version:number;content_hash:string|null}>(
      `insert into outbound_campaign_versions(
         workspace,campaign_key,version,status,name,audience_definition,offer_definition,steps,
         content_hash,created_by,approved_by,approved_at,published_at
       )
       values($1,$2,$3,'running',$4,$5::jsonb,'{}'::jsonb,$6::jsonb,$7,'legacy-bridge','system',now(),now())
       returning id,version,content_hash`,
      [
        workspace,campaignKey,Number(latest?.version||0)+1,input.campaignName||input.campaignId,
        JSON.stringify({source:"legacy",description:input.audience||null}),
        JSON.stringify(input.steps),contentHash,
      ],
    );
  }
  if(!campaignVersion)throw new Error("Campaign version could not be created.");

  const experimentKey=`${input.campaignId}:sequence`;
  let [experiment]=await query<ExperimentRow>(
    `select id,workspace,campaign_version_id,experiment_key,version,status,hypothesis,primary_metric,
            guardrail_metrics,randomization_unit,minimum_sample_per_arm,practical_effect_threshold,
            stop_policy,legacy_campaign_id,content_hash,control_arm_key,safety_stop_enabled,paused_at,pause_reason
     from outbound_experiments
     where workspace=$1 and campaign_version_id=$2 and experiment_key=$3
     limit 1`,
    [workspace,campaignVersion.id,experimentKey],
  );

  if(!experiment){
    [experiment]=await query<ExperimentRow>(
      `insert into outbound_experiments(
         workspace,campaign_version_id,experiment_key,version,status,hypothesis,primary_metric,
         guardrail_metrics,randomization_unit,target_population,minimum_sample_per_arm,
         practical_effect_threshold,stop_policy,legacy_campaign_id,content_hash,control_arm_key,safety_stop_enabled
       )
       values(
         $1,$2,$3,$4,'running',
         'Test whether the sequence variant improves positive reply rate without worsening safety guardrails.',
         'positive_reply_rate',
         array['bounce_rate','complaint_rate','unsubscribe_rate']::text[],
         'company','{}'::jsonb,50,0.02,$5::jsonb,$6,$7,$8,true
       )
       returning id,workspace,campaign_version_id,experiment_key,version,status,hypothesis,primary_metric,
                 guardrail_metrics,randomization_unit,minimum_sample_per_arm,practical_effect_threshold,
                 stop_policy,legacy_campaign_id,content_hash,control_arm_key,safety_stop_enabled,paused_at,pause_reason`,
      [
        workspace,campaignVersion.id,experimentKey,campaignVersion.version,
        JSON.stringify(defaultStopPolicy()),input.campaignId,contentHash,labels[0],
      ],
    );
    if(!experiment)throw new Error("Experiment could not be created.");

    const weight=1/labels.length;
    for(const label of labels){
      const strategy={
        steps:input.steps.map((step,index)=>{
          const variant=step.variants?.find(v=>v.label===label);
          return {
            step:index+1,waitDays:step.waitDays,
            subject:variant?.subject??step.subject,
            body:variant?.body??step.body,
          };
        }),
      };
      await query(
        `insert into outbound_experiment_arms(experiment_id,arm_key,label,weight,strategy,status)
         values($1,$2,$2,$3,$4::jsonb,'active')
         on conflict(experiment_id,arm_key) do nothing`,
        [experiment.id,label,weight,JSON.stringify(strategy)],
      );
    }
    await recordOutboundEventByMode({
      workspace,
      type:"experiment_created",
      actorType:"system",
      campaignVersionId:campaignVersion.id,
      experimentId:experiment.id,
      idempotencyKey:`experiment-created:${experiment.id}`,
      payload:{legacyCampaignId:input.campaignId,experimentKey,labels,contentHash},
    });
  }

  const arms=await query<ArmRow>(
    `select experiment_id,arm_key,label,weight,strategy,status
     from outbound_experiment_arms where experiment_id=$1 order by created_at,arm_key`,
    [experiment.id],
  );
  return {experiment,campaignVersion,arms};
}

export async function assignLegacyExperiment(input:{
  experiment:ExperimentRow;
  arms:ArmRow[];
  leadId:string;
  companyId?:string|null;
  companyName:string;
  workspace?:string;
}){
  const workspace=input.workspace??"default";
  const control=input.experiment.control_arm_key||input.arms[0]?.arm_key||"A";
  if(input.experiment.status!=="running"){
    return {active:false,armKey:control,assignmentId:null,subjectType:"company" as const,subjectId:companySubjectId(input.companyId,input.companyName)};
  }
  const subjectId=companySubjectId(input.companyId,input.companyName);
  const [existing]=await query<{id:string;arm_key:string}>(
    `select id,arm_key from outbound_experiment_assignments
     where experiment_id=$1 and subject_type='company' and subject_id=$2 limit 1`,
    [input.experiment.id,subjectId],
  );
  if(existing){
    return {active:true,armKey:existing.arm_key,assignmentId:existing.id,subjectType:"company" as const,subjectId};
  }

  const chosen=chooseWeightedArm(input.arms,`${input.experiment.id}:${subjectId}`);
  if(!chosen)throw new Error("Experiment has no active arms.");
  const assignmentHash=sha(`${input.experiment.id}:company:${subjectId}:${chosen.arm_key}`);
  const [assignment]=await query<{id:string;arm_key:string}>(
    `insert into outbound_experiment_assignments(
       workspace,experiment_id,subject_type,subject_id,arm_key,assignment_hash
     )
     values($1,$2,'company',$3,$4,$5)
     on conflict(experiment_id,subject_type,subject_id)
     do update set assignment_hash=outbound_experiment_assignments.assignment_hash
     returning id,arm_key`,
    [workspace,input.experiment.id,subjectId,chosen.arm_key,assignmentHash],
  );
  if(!assignment)throw new Error("Experiment assignment could not be created.");

  await recordOutboundEventByMode({
    workspace,
    type:"experiment_assigned",
    actorType:"system",
    leadId:input.leadId,
    campaignVersionId:input.experiment.campaign_version_id,
    experimentId:input.experiment.id,
    experimentArmKey:assignment.arm_key,
    idempotencyKey:`experiment-assigned:${input.experiment.id}:company:${subjectId}`,
    payload:{subjectType:"company",subjectId,legacyCampaignId:input.experiment.legacy_campaign_id},
  });
  return {active:true,armKey:assignment.arm_key,assignmentId:assignment.id,subjectType:"company" as const,subjectId};
}

export async function recordExperimentExposureForSend(input:{
  experimentId:string|null|undefined;
  campaignVersionId:string|null|undefined;
  armKey:string|null|undefined;
  leadId:string;
  legacyCampaignId:string|null;
  legacyOutboxId:string;
  providerMessageId:string|null;
  workspace?:string;
}){
  if(!input.experimentId||!input.armKey)return {recorded:false};
  const workspace=input.workspace??"default";
  const [experiment]=await query<ExperimentRow>(
    `select id,workspace,campaign_version_id,experiment_key,version,status,hypothesis,primary_metric,
            guardrail_metrics,randomization_unit,minimum_sample_per_arm,practical_effect_threshold,
            stop_policy,legacy_campaign_id,content_hash,control_arm_key,safety_stop_enabled,paused_at,pause_reason
     from outbound_experiments where id=$1 and workspace=$2 limit 1`,
    [input.experimentId,workspace],
  );
  if(!experiment)return {recorded:false};

  const [lead]=await query<{company_id:string|null;company_name:string|null}>(
    `select l.company_id,co.name as company_name
     from sales_leads l
     left join sales_companies co on co.id=l.company_id and co.workspace=l.workspace
     where l.workspace=$1 and l.id=$2 limit 1`,
    [workspace,input.leadId],
  );
  const subjectId=companySubjectId(lead?.company_id,lead?.company_name||input.leadId);
  const [assignment]=await query<{id:string}>(
    `select id from outbound_experiment_assignments
     where experiment_id=$1 and subject_type='company' and subject_id=$2 and arm_key=$3 limit 1`,
    [experiment.id,subjectId,input.armKey],
  );

  const [exposure]=await query<{id:string}>(
    `insert into outbound_experiment_exposures(
       workspace,experiment_id,assignment_id,campaign_version_id,subject_type,subject_id,
       company_id,lead_id,arm_key,legacy_campaign_id,legacy_outbox_id,provider_message_id,metadata
     )
     values($1,$2,$3,$4,'company',$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     on conflict(experiment_id,subject_type,subject_id) do nothing
     returning id`,
    [
      workspace,experiment.id,assignment?.id??null,input.campaignVersionId??experiment.campaign_version_id,
      subjectId,lead?.company_id??null,input.leadId,input.armKey,input.legacyCampaignId,
      input.legacyOutboxId,input.providerMessageId,JSON.stringify({firstAcceptedMessage:true}),
    ],
  );
  if(!exposure)return {recorded:false};

  await recordOutboundEventByMode({
    workspace,
    type:"experiment_exposed",
    actorType:"provider",
    leadId:input.leadId,
    companyId:lead?.company_id??null,
    campaignVersionId:input.campaignVersionId??experiment.campaign_version_id,
    experimentId:experiment.id,
    experimentArmKey:input.armKey,
    messageId:input.providerMessageId,
    idempotencyKey:`experiment-exposed:${experiment.id}:company:${subjectId}`,
    payload:{exposureId:exposure.id,legacyOutboxId:input.legacyOutboxId,legacyCampaignId:input.legacyCampaignId},
  });
  return {recorded:true,exposureId:exposure.id};
}

async function loadOutcomeRows(experimentId:string,workspace="default"){
  return query<OutcomeRow>(
    `with units as (
       select arm_key,subject_id,company_id,lead_id,exposed_at
       from outbound_experiment_exposures
       where workspace=$2 and experiment_id=$1
     ),
     related as (
       select distinct u.arm_key,u.subject_id,u.exposed_at,l.id as lead_id
       from units u
       join sales_leads l
         on l.workspace=$2
        and (
          (u.company_id is not null and l.company_id=u.company_id)
          or (u.company_id is null and l.id=u.lead_id)
        )
       union
       select u.arm_key,u.subject_id,u.exposed_at,u.lead_id
       from units u
     ),
     flags as (
       select
         u.arm_key,
         u.subject_id,
         exists(
           select 1 from related r join er_events ev on ev.lead_id=r.lead_id and ev.workspace=$2
           where r.subject_id=u.subject_id and ev.type='reply' and ev.created_at>=u.exposed_at
         ) as replied,
         (
           exists(
             select 1 from related r join er_events ev on ev.lead_id=r.lead_id and ev.workspace=$2
             where r.subject_id=u.subject_id and ev.type='positive_reply' and ev.created_at>=u.exposed_at
           )
           or exists(
             select 1
             from related r
             join outbound_conversation_threads t on t.workspace=$2 and t.lead_id=r.lead_id
             join outbound_reply_classifications c on c.thread_id=t.id and c.is_current=true
             where r.subject_id=u.subject_id
               and c.reply_class in ('positive','meeting_intent')
               and c.created_at>=u.exposed_at
           )
         ) as positive_reply,
         (
           exists(
             select 1 from related r join outbound_events oe on oe.workspace=$2 and oe.lead_id=r.lead_id
             where r.subject_id=u.subject_id and oe.event_type='meeting_booked' and oe.occurred_at>=u.exposed_at
           )
           or exists(
             select 1 from related r join er_events ev on ev.workspace=$2 and ev.lead_id=r.lead_id
             where r.subject_id=u.subject_id and ev.type='appointment' and ev.created_at>=u.exposed_at
           )
         ) as qualified_meeting,
         (
           exists(
             select 1 from related r join outbound_events oe on oe.workspace=$2 and oe.lead_id=r.lead_id
             where r.subject_id=u.subject_id and oe.event_type='meeting_held' and oe.occurred_at>=u.exposed_at
           )
           or exists(
             select 1 from related r join er_events ev on ev.workspace=$2 and ev.lead_id=r.lead_id
             where r.subject_id=u.subject_id and ev.type='appointment_attended' and ev.created_at>=u.exposed_at
           )
         ) as meeting_held,
         exists(
           select 1 from related r join outbound_events oe on oe.workspace=$2 and oe.lead_id=r.lead_id
           where r.subject_id=u.subject_id and oe.event_type='opportunity_created' and oe.occurred_at>=u.exposed_at
         ) as opportunity,
         (
           exists(
             select 1 from related r join outbound_events oe on oe.workspace=$2 and oe.lead_id=r.lead_id
             where r.subject_id=u.subject_id and oe.event_type='won' and oe.occurred_at>=u.exposed_at
           )
           or exists(
             select 1 from related r join sales_leads l on l.workspace=$2 and l.id=r.lead_id
             where r.subject_id=u.subject_id and l.stage='Gewonnen'
           )
         ) as won,
         (
           exists(
             select 1 from related r join er_events ev on ev.workspace=$2 and ev.lead_id=r.lead_id
             where r.subject_id=u.subject_id and ev.type='bounce' and ev.created_at>=u.exposed_at
           )
           or exists(
             select 1 from related r join outbound_events oe on oe.workspace=$2 and oe.lead_id=r.lead_id
             where r.subject_id=u.subject_id and oe.event_type='bounce' and oe.occurred_at>=u.exposed_at
           )
         ) as bounced,
         exists(
           select 1 from related r join outbound_events oe on oe.workspace=$2 and oe.lead_id=r.lead_id
           where r.subject_id=u.subject_id and oe.event_type='complaint' and oe.occurred_at>=u.exposed_at
         ) as complained,
         (
           exists(
             select 1 from related r join outbound_events oe on oe.workspace=$2 and oe.lead_id=r.lead_id
             where r.subject_id=u.subject_id and oe.event_type='unsubscribe' and oe.occurred_at>=u.exposed_at
           )
           or exists(
             select 1 from related r
             join outbound_compliance_suppressions s on s.workspace=$2 and s.lead_id=r.lead_id
             where r.subject_id=u.subject_id and s.reason='unsubscribe' and s.created_at>=u.exposed_at
           )
         ) as unsubscribed,
         coalesce((
           select sum(
             case when coalesce(oe.payload->>'amount','') ~ '^[0-9]+([.][0-9]+)?$'
                  then (oe.payload->>'amount')::numeric else 0 end
           )
           from related r
           join outbound_events oe on oe.workspace=$2 and oe.lead_id=r.lead_id
           where r.subject_id=u.subject_id
             and oe.event_type='revenue_recorded'
             and oe.occurred_at>=u.exposed_at
         ),0)::numeric as revenue
       from units u
     )
     select
       arm_key,
       count(*)::text as n,
       count(*) filter(where replied)::text as replies,
       count(*) filter(where positive_reply)::text as positive_replies,
       count(*) filter(where qualified_meeting)::text as qualified_meetings,
       count(*) filter(where meeting_held)::text as meetings_held,
       count(*) filter(where opportunity)::text as opportunities,
       count(*) filter(where won)::text as wins,
       count(*) filter(where bounced)::text as bounces,
       count(*) filter(where complained)::text as complaints,
       count(*) filter(where unsubscribed)::text as unsubscribes,
       coalesce(sum(revenue),0)::text as revenue
     from flags
     group by arm_key
     order by arm_key`,
    [experimentId,workspace],
  );
}

async function pauseExperimentForSafety(experiment:ExperimentRow,reason:string,workspace="default"){
  const runtime=await resolveOutboundRuntimeConfig(workspace);
  const autonomy=evaluateAutonomy(runtime.autonomyLevel,"pause_experiment_safety",false);
  if(!autonomy.executable)return {paused:false,autonomy};

  const control=experiment.control_arm_key||"A";
  const updated=await query<{id:string}>(
    `update outbound_experiments
     set status='paused',paused_at=now(),pause_reason=$3
     where workspace=$1 and id=$2 and status='running'
     returning id`,
    [workspace,experiment.id,reason],
  );
  if(!updated.length)return {paused:false,autonomy};

  await query(
    `update er_outbox
     set status='stopped',error=$3
     where workspace=$1 and experiment_id=$2 and status='queued'
       and coalesce(experiment_arm_key,'')<>$4`,
    [workspace,experiment.id,`Experiment safety stop: ${reason}`,control],
  );
  await query(
    `update er_outbox
     set experiment_id=null,experiment_arm_key=null,campaign_version_id=null,error=null
     where workspace=$1 and experiment_id=$2 and status='queued'
       and experiment_arm_key=$3`,
    [workspace,experiment.id,control],
  );

  const [decision]=await query<{id:string}>(
    `insert into outbound_agent_decisions(
       workspace,agent_key,action_class,autonomy_level,subject_type,subject_id,recommendation,
       evidence,confidence,policy_version,requires_approval,status,executed_at
     )
     values(
       $1,'experiment-safety','pause_experiment_safety',$2,'experiment',$3,$4::jsonb,
       $5::jsonb,1,$6,false,'executed',now()
     )
     returning id`,
    [
      workspace,runtime.autonomyLevel,experiment.id,
      JSON.stringify({action:"pause_experiment",reason,controlArm:control}),
      JSON.stringify([{key:"safety_stop",value:reason,source:"experiment-engine",observedAt:new Date().toISOString(),confidence:1}]),
      EXPERIMENT_POLICY_VERSION,
    ],
  );

  await recordOutboundEventByMode({
    workspace,
    type:"experiment_safety_paused",
    actorType:"agent",
    actorId:"experiment-safety",
    campaignVersionId:experiment.campaign_version_id,
    experimentId:experiment.id,
    idempotencyKey:`experiment-safety-paused:${experiment.id}:${sha(reason).slice(0,16)}`,
    payload:{reason,controlArm:control,decisionId:decision?.id??null,autonomy},
  });
  return {paused:true,autonomy};
}

export async function evaluateExperiment(experimentId:string,workspace="default"){
  const [experiment]=await query<ExperimentRow>(
    `select id,workspace,campaign_version_id,experiment_key,version,status,hypothesis,primary_metric,
            guardrail_metrics,randomization_unit,minimum_sample_per_arm,practical_effect_threshold,
            stop_policy,legacy_campaign_id,content_hash,control_arm_key,safety_stop_enabled,paused_at,pause_reason
     from outbound_experiments
     where workspace=$1 and id=$2 limit 1`,
    [workspace,experimentId],
  );
  if(!experiment)throw new Error("Experiment not found.");
  const arms=await query<ArmRow>(
    `select experiment_id,arm_key,label,weight,strategy,status
     from outbound_experiment_arms where experiment_id=$1 order by created_at,arm_key`,
    [experiment.id],
  );
  if(arms.length<2)throw new Error("Experiment requires at least two arms.");

  const outcomeRows=await loadOutcomeRows(experiment.id,workspace);
  const byArm=new Map(outcomeRows.map(row=>[row.arm_key,row]));
  const counts=arms.map(arm=>Number(byArm.get(arm.arm_key)?.n||0));
  const weights=arms.map(arm=>Number(arm.weight));
  const total=counts.reduce((a,b)=>a+b,0);
  const srmP=srmPValue(counts,weights);
  const policy={...defaultStopPolicy(),...(experiment.stop_policy||{})};
  const alpha=numberFromPolicy(policy,"alpha",0.05);
  const srmAlpha=numberFromPolicy(policy,"srmAlpha",0.01);
  const minGuardrail=Math.max(10,numberFromPolicy(policy,"minimumGuardrailSample",20));
  const adjustedAlpha=alpha/Math.max(1,arms.length-1);
  const controlKey=experiment.control_arm_key||arms[0].arm_key;
  const controlRow=byArm.get(controlKey)||({
    arm_key:controlKey,n:"0",replies:"0",positive_replies:"0",qualified_meetings:"0",
    meetings_held:"0",opportunities:"0",wins:"0",bounces:"0",complaints:"0",unsubscribes:"0",revenue:"0",
  } as OutcomeRow);
  const controlPrimary=metricParts(controlRow,experiment.primary_metric);

  const primaryResults:Record<string,unknown>={};
  let reviewArm:string|null=null;
  let strongestImprovement=-Infinity;
  let evidenceSignal=false;

  for(const arm of arms){
    const row=byArm.get(arm.arm_key)||({
      arm_key:arm.arm_key,n:"0",replies:"0",positive_replies:"0",qualified_meetings:"0",
      meetings_held:"0",opportunities:"0",wins:"0",bounces:"0",complaints:"0",unsubscribes:"0",revenue:"0",
    } as OutcomeRow);
    const parts=metricParts(row,experiment.primary_metric);
    const ci=rateMetrics.has(experiment.primary_metric)&&parts.count!==null?wilson(parts.count,parts.n):null;
    let comparison:Record<string,unknown>|null=null;
    if(arm.arm_key!==controlKey&&parts.n&&controlPrimary.n){
      const rawDelta=parts.value-controlPrimary.value;
      const improvement=lowerIsBetter.has(experiment.primary_metric)?-rawDelta:rawDelta;
      let pValue:number|null=null;
      if(rateMetrics.has(experiment.primary_metric)&&parts.count!==null&&controlPrimary.count!==null){
        pValue=twoProportionP(parts.count,parts.n,controlPrimary.count,controlPrimary.n);
      }
      const practical=improvement>=Number(experiment.practical_effect_threshold||0);
      const statisticallySupported=pValue!==null&&pValue<adjustedAlpha;
      const supported=practical&&statisticallySupported
        && parts.n>=experiment.minimum_sample_per_arm
        && controlPrimary.n>=experiment.minimum_sample_per_arm;
      comparison={delta:rawDelta,improvement,pValue,adjustedAlpha,practical,statisticallySupported,supported};
      if(supported&&improvement>strongestImprovement){
        strongestImprovement=improvement;
        reviewArm=arm.arm_key;
        evidenceSignal=true;
      }
    }
    primaryResults[arm.arm_key]={
      n:parts.n,count:parts.count,value:parts.value,ci,comparison,label:arm.label,weight:Number(arm.weight),
    };
  }

  const guardrailResults:Record<string,unknown>={};
  const safetyRisks:Array<{armKey:string;metric:string;reason:string;value:number;controlValue:number;pValue:number|null}>=[];
  for(const metric of experiment.guardrail_metrics||[]){
    if(!rateMetrics.has(metric))continue;
    const control=metricParts(controlRow,metric);
    const metricRows:Record<string,unknown>={};
    for(const arm of arms){
      const row=byArm.get(arm.arm_key)||controlRow;
      const parts=metricParts(row,metric);
      let pValue:number|null=null;
      let risk=false;
      let reason="";
      if(arm.arm_key!==controlKey&&parts.n>=minGuardrail&&control.n>=minGuardrail&&parts.count!==null&&control.count!==null){
        const delta=parts.value-control.value;
        pValue=twoProportionP(parts.count,parts.n,control.count,control.n);
        const threshold=nestedNumber(policy,"guardrailAbsoluteDeltas",metric,metric==="complaint_rate"?0.003:0.02);
        const ceiling=nestedNumber(policy,"guardrailHardCeilings",metric,metric==="bounce_rate"?0.05:metric==="complaint_rate"?0.003:0.10);
        const relativeHarm=delta>=threshold&&pValue<adjustedAlpha;
        const hardHarm=parts.value>=ceiling&&delta>0;
        risk=relativeHarm||hardHarm;
        if(relativeHarm)reason=`harmful_delta_${delta.toFixed(4)}`;
        else if(hardHarm)reason=`hard_ceiling_${ceiling}`;
        if(risk)safetyRisks.push({armKey:arm.arm_key,metric,reason,value:parts.value,controlValue:control.value,pValue});
      }
      metricRows[arm.arm_key]={n:parts.n,count:parts.count,value:parts.value,ci:parts.count!==null?wilson(parts.count,parts.n):null,pValue,risk};
    }
    guardrailResults[metric]=metricRows;
  }

  const enoughSample=arms.every((arm,index)=>counts[index]>=experiment.minimum_sample_per_arm);
  const srmReady=total>=Math.max(40,arms.length*10)&&counts.every((_,index)=>total*weights[index]>=5);
  const srmWarning=srmReady&&srmP<srmAlpha;
  let status:"insufficient_data"|"monitoring"|"srm_warning"|"guardrail_risk"|"evidence_signal"|"no_clear_signal";
  if(srmWarning)status="srm_warning";
  else if(safetyRisks.length)status="guardrail_risk";
  else if(!enoughSample)status=total?"monitoring":"insufficient_data";
  else if(evidenceSignal)status="evidence_signal";
  else status="no_clear_signal";

  const recommendation={
    action:srmWarning||safetyRisks.length?"pause_for_safety_review":evidenceSignal?"review_supported_arm":"keep_collecting",
    reviewArm,
    controlArm:controlKey,
    noAutomaticWinner:true,
    rationale:srmWarning
      ?"Sample-ratio mismatch detected; experiment validity needs review."
      :safetyRisks.length
        ?"A non-control arm crossed a safety guardrail."
        :evidenceSignal
          ?"At least one non-control arm has a practically meaningful, multiplicity-adjusted signal. Human review required before any traffic change."
          :enoughSample
            ?"Minimum sample reached without a clear supported effect."
            :"More exposed companies are required.",
  };
  const fingerprint=sha(stableJson({status,total,srmP,primaryResults,guardrailResults,recommendation})).slice(0,48);
  const [evaluation]=await query<{id:string}>(
    `insert into outbound_experiment_evaluations(
       workspace,experiment_id,status,total_exposed,srm_p_value,primary_metric,
       primary_results,guardrail_results,recommendation,safety_action,fingerprint
     )
     values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11)
     on conflict(experiment_id,fingerprint) do nothing
     returning id`,
    [
      workspace,experiment.id,status,total,srmP,experiment.primary_metric,
      JSON.stringify(primaryResults),JSON.stringify(guardrailResults),JSON.stringify(recommendation),
      srmWarning||safetyRisks.length?"pause_experiment":null,fingerprint,
    ],
  );

  let safetyPause:{paused:boolean;autonomy:unknown}|null=null;
  if((srmWarning||safetyRisks.length)&&experiment.safety_stop_enabled&&experiment.status==="running"){
    const reason=srmWarning
      ? `SRM p=${srmP.toFixed(6)} below ${srmAlpha}`
      : `Guardrail risk: ${safetyRisks.map(r=>r.armKey+":"+r.metric+":"+r.reason).join(", ")}`;
    safetyPause=await pauseExperimentForSafety(experiment,reason,workspace);
  }

  if(evaluation){
    await recordOutboundEventByMode({
      workspace,
      type:"experiment_evaluated",
      actorType:"system",
      campaignVersionId:experiment.campaign_version_id,
      experimentId:experiment.id,
      idempotencyKey:`experiment-evaluated:${evaluation.id}`,
      payload:{evaluationId:evaluation.id,status,totalExposed:total,srmPValue:srmP,recommendation},
    });

    if(evidenceSignal&&reviewArm){
      const [recent]=await query<{id:string}>(
        `select id from outbound_agent_decisions
         where workspace=$1 and agent_key='experiment-analyst' and subject_type='experiment' and subject_id=$2
           and action_class='allocate_experiment_traffic' and status='proposed'
           and created_at>=now()-interval '24 hours'
         limit 1`,
        [workspace,experiment.id],
      );
      if(!recent){
        const runtime=await resolveOutboundRuntimeConfig(workspace);
        const autonomy=evaluateAutonomy(runtime.autonomyLevel,"allocate_experiment_traffic",false);
        const [decision]=await query<{id:string}>(
          `insert into outbound_agent_decisions(
             workspace,agent_key,action_class,autonomy_level,subject_type,subject_id,recommendation,
             evidence,confidence,policy_version,requires_approval,status
           )
           values(
             $1,'experiment-analyst','allocate_experiment_traffic',$2,'experiment',$3,$4::jsonb,
             $5::jsonb,$6,$7,true,'proposed'
           )
           returning id`,
          [
            workspace,runtime.autonomyLevel,experiment.id,
            JSON.stringify({action:"review_supported_arm",armKey:reviewArm,noAutomaticWinner:true}),
            JSON.stringify([{key:"evaluation",value:{status,total,srmP,primaryResults},source:"experiment-engine",observedAt:new Date().toISOString(),confidence:0.9}]),
            0.9,EXPERIMENT_POLICY_VERSION,
          ],
        );
        await recordOutboundEventByMode({
          workspace,
          type:"experiment_review_recommended",
          actorType:"agent",
          actorId:"experiment-analyst",
          campaignVersionId:experiment.campaign_version_id,
          experimentId:experiment.id,
          experimentArmKey:reviewArm,
          idempotencyKey:`experiment-review-recommended:${decision?.id??evaluation.id}`,
          payload:{decisionId:decision?.id??null,reviewArm,autonomy,noAutomaticWinner:true},
        });
      }
    }
  }

  return {
    experimentId:experiment.id,status,totalExposed:total,srmPValue:srmP,srmWarning,
    primaryMetric:experiment.primary_metric,primaryResults,guardrailResults,safetyRisks,
    recommendation,safetyPause,
  };
}

export async function backfillMissingExperimentExposures(limit=200,workspace="default"){
  const rows=await query<{
    id:string;lead_id:string;campaign_id:string|null;campaign_version_id:string|null;
    experiment_id:string;experiment_arm_key:string|null;provider_message_id:string|null
  }>(
    `select id,lead_id,campaign_id,campaign_version_id,experiment_id,experiment_arm_key,provider_message_id
     from er_outbox
     where workspace=$1
       and status='sent'
       and sent_at>=now()-interval '30 days'
       and experiment_id is not null
       and experiment_arm_key is not null
     order by sent_at asc
     limit $2`,
    [workspace,Math.max(1,Math.min(1000,limit))],
  );
  let recorded=0;
  for(const row of rows){
    try{
      const result=await recordExperimentExposureForSend({
        experimentId:row.experiment_id,
        campaignVersionId:row.campaign_version_id,
        armKey:row.experiment_arm_key,
        leadId:row.lead_id,
        legacyCampaignId:row.campaign_id,
        legacyOutboxId:row.id,
        providerMessageId:row.provider_message_id,
        workspace,
      });
      if(result.recorded)recorded++;
    }catch{
      // Exposure repair is best-effort and never mutates provider-send state.
    }
  }
  return {scanned:rows.length,recorded};
}

export async function evaluateRunningExperiments(limit=20,workspace="default"){
  const backfill=await backfillMissingExperimentExposures(200,workspace);
  const rows=await query<{id:string}>(
    `select id from outbound_experiments
     where workspace=$1 and status='running'
     order by updated_at asc
     limit $2`,
    [workspace,Math.max(1,Math.min(100,limit))],
  );
  const results=[];
  for(const row of rows){
    try{results.push(await evaluateExperiment(row.id,workspace))}
    catch(error){results.push({experimentId:row.id,error:error instanceof Error?error.message:"Evaluation failed"})}
  }
  return {evaluated:rows.length,backfill,results};
}

export async function setExperimentStatus(input:{
  experimentId:string;
  action:"pause"|"resume"|"complete";
  reason:string;
  actorId?:string;
  workspace?:string;
}){
  const workspace=input.workspace??"default";
  const actorId=input.actorId??"admin-session";
  const target=input.action==="pause"?"paused":input.action==="resume"?"running":"completed";
  const rows=await query<{id:string}>(
    `update outbound_experiments
     set status=$3,
         paused_at=case when $3='paused' then now() else null end,
         pause_reason=case when $3='paused' then $4 else null end
     where workspace=$1 and id=$2
       and status not in ('archived')
     returning id`,
    [workspace,input.experimentId,target,input.reason],
  );
  if(!rows.length)throw new Error("Experiment status could not be changed.");
  await recordOutboundEventByMode({
    workspace,
    type:target==="paused"?"experiment_paused":target==="running"?"experiment_resumed":"experiment_completed",
    actorType:"human",
    actorId,
    experimentId:input.experimentId,
    idempotencyKey:`experiment-status:${input.experimentId}:${target}:${Date.now()}`,
    payload:{status:target,reason:input.reason},
  });
  return {experimentId:input.experimentId,status:target};
}

export async function getExperimentDashboard(workspace="default"){
  const experiments=await query<ExperimentRow&{campaign_name:string;latest_evaluation:Record<string,unknown>|null}>(
    `select e.id,e.workspace,e.campaign_version_id,e.experiment_key,e.version,e.status,e.hypothesis,
            e.primary_metric,e.guardrail_metrics,e.randomization_unit,e.minimum_sample_per_arm,
            e.practical_effect_threshold,e.stop_policy,e.legacy_campaign_id,e.content_hash,e.control_arm_key,
            e.safety_stop_enabled,e.paused_at,e.pause_reason,cv.name as campaign_name,
            (
              select jsonb_build_object(
                'id',ev.id,'status',ev.status,'totalExposed',ev.total_exposed,'srmPValue',ev.srm_p_value,
                'primaryMetric',ev.primary_metric,'primaryResults',ev.primary_results,
                'guardrailResults',ev.guardrail_results,'recommendation',ev.recommendation,
                'safetyAction',ev.safety_action,'evaluatedAt',ev.evaluated_at
              )
              from outbound_experiment_evaluations ev
              where ev.experiment_id=e.id
              order by ev.evaluated_at desc
              limit 1
            ) as latest_evaluation
     from outbound_experiments e
     join outbound_campaign_versions cv on cv.id=e.campaign_version_id
     where e.workspace=$1
     order by e.updated_at desc,e.created_at desc
     limit 100`,
    [workspace],
  );

  const arms=experiments.length?await query<ArmRow&{exposed:string}>(
    `select a.experiment_id,a.arm_key,a.label,a.weight,a.strategy,a.status,
            count(x.id)::text as exposed
     from outbound_experiment_arms a
     left join outbound_experiment_exposures x
       on x.experiment_id=a.experiment_id and x.arm_key=a.arm_key
     where a.experiment_id=any($1::uuid[])
     group by a.experiment_id,a.arm_key,a.label,a.weight,a.strategy,a.status,a.created_at
     order by a.created_at,a.arm_key`,
    [experiments.map(e=>e.id)],
  ):[];

  const armMap=new Map<string,Array<ArmRow&{exposed:string}>>();
  for(const arm of arms){
    const list=armMap.get(arm.experiment_id)||[];
    list.push(arm);armMap.set(arm.experiment_id,list);
  }
  const summary={
    running:experiments.filter(e=>e.status==="running").length,
    paused:experiments.filter(e=>e.status==="paused").length,
    evidence:experiments.filter(e=>(e.latest_evaluation as any)?.status==="evidence_signal").length,
    safety:experiments.filter(e=>["srm_warning","guardrail_risk"].includes(String((e.latest_evaluation as any)?.status||""))).length,
  };
  return {
    policyVersion:EXPERIMENT_POLICY_VERSION,
    optimizationAutopilot:false,
    summary,
    experiments:experiments.map(e=>({...e,arms:armMap.get(e.id)||[]})),
  };
}
