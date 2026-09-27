import { createHash } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { recordOutboundEventByMode } from "@/lib/outbound-event-ledger";
import { evaluateAutonomy } from "@/lib/outbound-policy";
import { resolveOutboundRuntimeConfig } from "@/lib/outbound-runtime-config";

export const OPTIMIZATION_POLICY_VERSION="dg-optimization-2026-09-27-v1";

type Policy={
  id:string;policy_key:string;version:number;status:"draft"|"approved"|"active"|"paused"|"retired";
  description:string;max_weight_shift_per_cycle:number;min_control_weight:number;min_arm_exposure:number;
  cooldown_hours:number;require_evidence_signal:boolean;require_clean_guardrails:boolean;
  allow_new_experiment_drafts:boolean;allow_traffic_allocation:boolean;max_active_experiments:number;
  policy:Record<string,unknown>;approved_by:string|null;approved_at:Date|null;
};
type ExperimentCandidate={
  id:string;campaign_version_id:string;status:string;control_arm_key:string|null;
  latest_evaluation:Record<string,unknown>|null;
};
type Arm={arm_key:string;label:string;weight:number;status:string};
type Proposal={
  id:string;policy_id:string|null;experiment_id:string|null;proposal_type:"traffic_allocation"|"new_experiment";
  status:string;payload:Record<string,unknown>;rationale:string;evidence:unknown[];
};

const policyActionSchema=z.object({
  policyId:z.string().uuid(),
  action:z.enum(["approve","activate","pause","retire"]),
  reason:z.string().min(3).max(2000),
});
const proposalActionSchema=z.object({
  proposalId:z.string().uuid(),
  action:z.enum(["approve","reject","execute"]),
  reason:z.string().min(3).max(2000),
});

function sha(value:string){return createHash("sha256").update(value).digest("hex")}

async function currentPolicy(){
  const [active]=await query<Policy>(
    `select id,policy_key,version,status,description,max_weight_shift_per_cycle,min_control_weight,
            min_arm_exposure,cooldown_hours,require_evidence_signal,require_clean_guardrails,
            allow_new_experiment_drafts,allow_traffic_allocation,max_active_experiments,policy,
            approved_by,approved_at
     from outbound_optimization_policies
     where workspace='default' and status='active'
     order by version desc limit 1`
  );
  if(active)return active;
  const [fallback]=await query<Policy>(
    `select id,policy_key,version,status,description,max_weight_shift_per_cycle,min_control_weight,
            min_arm_exposure,cooldown_hours,require_evidence_signal,require_clean_guardrails,
            allow_new_experiment_drafts,allow_traffic_allocation,max_active_experiments,policy,
            approved_by,approved_at
     from outbound_optimization_policies
     where workspace='default' and status in ('approved','draft','paused')
     order by case status when 'approved' then 0 when 'draft' then 1 else 2 end,version desc
     limit 1`
  );
  return fallback??null;
}

function latestEvalStatus(ev:Record<string,unknown>|null){
  return ev?String(ev.status||""):null;
}
function latestRecommendation(ev:Record<string,unknown>|null){
  const r=ev?.recommendation;
  return r&&typeof r==="object"?r as Record<string,unknown>:null;
}

async function trafficProposalForExperiment(experiment:ExperimentCandidate,policy:Policy|null){
  const ev=experiment.latest_evaluation;
  if(!ev||latestEvalStatus(ev)!=="evidence_signal")return null;
  const recommendation=latestRecommendation(ev);
  const reviewArm=String(recommendation?.reviewArm||"");
  if(!reviewArm)return null;

  const [existing]=await query<{id:string}>(
    `select id from outbound_optimization_proposals
     where workspace='default' and experiment_id=$1 and proposal_type='traffic_allocation'
       and status in ('proposed','approved')
     order by created_at desc limit 1`,
    [experiment.id],
  );
  if(existing)return null;

  const arms=await query<Arm>(
    `select arm_key,label,weight,status from outbound_experiment_arms
     where experiment_id=$1 order by created_at,arm_key`,
    [experiment.id],
  );
  const payload={
    reviewArm,
    controlArm:experiment.control_arm_key||arms[0]?.arm_key||null,
    currentWeights:Object.fromEntries(arms.map(a=>[a.arm_key,Number(a.weight)])),
    maxShift:Number(policy?.max_weight_shift_per_cycle||0.10),
    noAutomaticWinner:true,
    evaluationId:String(ev.id||""),
  };
  const rationale=String(recommendation?.rationale||"Supported experiment signal requires human review.");
  const [proposal]=await query<{id:string}>(
    `insert into outbound_optimization_proposals(
       workspace,policy_id,experiment_id,proposal_type,status,payload,rationale,evidence,expires_at
     )
     values('default',$1,$2,'traffic_allocation','proposed',$3::jsonb,$4,$5::jsonb,now()+interval '7 days')
     returning id`,
    [policy?.id??null,experiment.id,JSON.stringify(payload),rationale,JSON.stringify([{kind:"experiment_evaluation",value:ev}])],
  );
  if(!proposal)return null;

  const runtime=await resolveOutboundRuntimeConfig();
  const autonomy=evaluateAutonomy(runtime.autonomyLevel,"allocate_experiment_traffic",false);
  const [decision]=await query<{id:string}>(
    `insert into outbound_agent_decisions(
       workspace,agent_key,action_class,autonomy_level,subject_type,subject_id,recommendation,
       evidence,confidence,policy_version,requires_approval,status
     )
     values(
       'default','optimization-agent','allocate_experiment_traffic',$1,'experiment',$2,$3::jsonb,
       $4::jsonb,0.9,$5,true,'proposed'
     )
     returning id`,
    [
      runtime.autonomyLevel,experiment.id,
      JSON.stringify({proposalId:proposal.id,...payload}),
      JSON.stringify([{key:"evaluation",value:ev,source:"experiment-engine",observedAt:new Date().toISOString(),confidence:0.9}]),
      OPTIMIZATION_POLICY_VERSION,
    ],
  );
  await query(`update outbound_optimization_proposals set decision_id=$2 where id=$1`,[proposal.id,decision?.id??null]);
  await recordOutboundEventByMode({
    workspace:"default",type:"optimization_proposal_created",actorType:"agent",actorId:"optimization-agent",
    experimentId:experiment.id,experimentArmKey:reviewArm,
    idempotencyKey:`optimization-proposal:${proposal.id}`,
    payload:{proposalId:proposal.id,proposalType:"traffic_allocation",autonomy,rationale},
  });
  return proposal.id;
}

async function proposeNewExperimentDrafts(policy:Policy|null){
  if(policy&&!policy.allow_new_experiment_drafts)return 0;
  const rows=await query<{
    candidate_id:string;hypothesis_id:string;company_id:string|null;segment_key:string;company_name:string|null;
    subject:string;body:string
  }>(
    `select c.id as candidate_id,h.id as hypothesis_id,h.company_id,h.segment_key,co.name as company_name,
            c.subject,c.body
     from outbound_copy_candidates c
     join outbound_strategy_hypotheses h on h.id=c.strategy_hypothesis_id
     left join sales_companies co on co.id=h.company_id and co.workspace=h.workspace
     where c.workspace='default' and c.status='approved' and h.status='approved'
       and not exists(
         select 1 from outbound_optimization_proposals p
         where p.workspace='default' and p.proposal_type='new_experiment'
           and p.payload->>'copyCandidateId'=c.id::text
           and p.status in ('proposed','approved','executed')
       )
     order by c.created_at desc
     limit 10`
  );
  let created=0;
  for(const row of rows){
    const payload={
      hypothesisId:row.hypothesis_id,copyCandidateId:row.candidate_id,companyId:row.company_id,
      segmentKey:row.segment_key,companyName:row.company_name,subject:row.subject,body:row.body,
      status:"draft_only",requiresAudienceDefinition:true,requiresPermissionPolicy:true,noAutomaticLaunch:true,
    };
    const [proposal]=await query<{id:string}>(
      `insert into outbound_optimization_proposals(
         workspace,policy_id,proposal_type,status,payload,rationale,evidence,expires_at
       )
       values('default',$1,'new_experiment','proposed',$2::jsonb,$3,$4::jsonb,now()+interval '14 days')
       returning id`,
      [
        policy?.id??null,JSON.stringify(payload),
        "Approved evidence-backed strategy and copy are available. Create a draft experiment only after audience and permission review.",
        JSON.stringify([{kind:"approved_strategy",id:row.hypothesis_id},{kind:"approved_copy",id:row.candidate_id}]),
      ],
    );
    if(proposal){
      const runtime=await resolveOutboundRuntimeConfig();
      const autonomy=evaluateAutonomy(runtime.autonomyLevel,"publish_experiment",false);
      const [decision]=await query<{id:string}>(
        `insert into outbound_agent_decisions(
           workspace,agent_key,action_class,autonomy_level,subject_type,subject_id,recommendation,
           evidence,confidence,policy_version,requires_approval,status
         )
         values(
           'default','optimization-agent','publish_experiment',$1,'optimization_proposal',$2,$3::jsonb,
           $4::jsonb,0.8,$5,true,'proposed'
         )
         returning id`,
        [
          runtime.autonomyLevel,proposal.id,JSON.stringify(payload),
          JSON.stringify([{key:"approved_assets",value:{hypothesisId:row.hypothesis_id,copyCandidateId:row.candidate_id},source:"m7-m8",observedAt:new Date().toISOString(),confidence:1}]),
          OPTIMIZATION_POLICY_VERSION,
        ],
      );
      await query(`update outbound_optimization_proposals set decision_id=$2 where id=$1`,[proposal.id,decision?.id??null]);
      await recordOutboundEventByMode({
        workspace:"default",type:"new_experiment_proposed",actorType:"agent",actorId:"optimization-agent",
        companyId:row.company_id,idempotencyKey:`new-experiment-proposal:${proposal.id}`,
        payload:{proposalId:proposal.id,autonomy,noAutomaticLaunch:true},
      });
      created++;
    }
  }
  return created;
}

function computeShift(arms:Arm[],reviewArm:string,controlArm:string,maxShift:number,minControl:number){
  const weights=Object.fromEntries(arms.map(a=>[a.arm_key,Number(a.weight)])) as Record<string,number>;
  if(!(reviewArm in weights))throw new Error("Review arm not found.");
  const others=arms.filter(a=>a.arm_key!==reviewArm);
  const available=others.reduce((sum,a)=>{
    const floor=a.arm_key===controlArm?minControl:0.05;
    return sum+Math.max(0,weights[a.arm_key]-floor);
  },0);
  const shift=Math.min(maxShift,available,Math.max(0,1-weights[reviewArm]-0.05));
  if(shift<=0)throw new Error("No safe allocation headroom.");
  let remaining=shift;
  const newWeights={...weights};
  const reducible=others.map(a=>({arm:a,space:Math.max(0,weights[a.arm_key]-(a.arm_key===controlArm?minControl:0.05))})).filter(x=>x.space>0);
  const totalSpace=reducible.reduce((s,x)=>s+x.space,0);
  for(let i=0;i<reducible.length;i++){
    const item=reducible[i];
    const reduction=i===reducible.length-1?remaining:Math.min(item.space,shift*(item.space/totalSpace));
    newWeights[item.arm.arm_key]-=reduction;remaining-=reduction;
  }
  newWeights[reviewArm]+=shift;
  const total=Object.values(newWeights).reduce((a,b)=>a+b,0);
  for(const key of Object.keys(newWeights))newWeights[key]=newWeights[key]/total;
  return {before:weights,after:newWeights,shift};
}

async function executeTrafficProposal(proposal:Proposal,policy:Policy,actorId:string){
  if(!proposal.experiment_id)throw new Error("Traffic proposal has no experiment.");
  if(policy.status!=="active"||!policy.approved_by||!policy.approved_at)throw new Error("Optimization policy is not human-approved and active.");
  if(!policy.allow_traffic_allocation)throw new Error("Policy does not allow traffic allocation.");

  const runtime=await resolveOutboundRuntimeConfig();
  const autonomy=evaluateAutonomy(runtime.autonomyLevel,"allocate_experiment_traffic",true);
  if(!autonomy.executable)throw new Error(`L4 execution blocked: ${autonomy.reason}`);

  const [experiment]=await query<ExperimentCandidate>(
    `select e.id,e.campaign_version_id,e.status,e.control_arm_key,
            (
              select jsonb_build_object(
                'id',ev.id,'status',ev.status,'totalExposed',ev.total_exposed,'srmPValue',ev.srm_p_value,
                'recommendation',ev.recommendation,'guardrailResults',ev.guardrail_results,'evaluatedAt',ev.evaluated_at
              ) from outbound_experiment_evaluations ev
              where ev.experiment_id=e.id order by ev.evaluated_at desc limit 1
            ) as latest_evaluation
     from outbound_experiments e where e.id=$1 and e.workspace='default' limit 1`,
    [proposal.experiment_id],
  );
  if(!experiment||experiment.status!=="running")throw new Error("Experiment is not running.");
  const ev=experiment.latest_evaluation;
  if(policy.require_evidence_signal&&latestEvalStatus(ev)!=="evidence_signal")throw new Error("Latest evaluation is not an evidence signal.");
  const rec=latestRecommendation(ev);
  const reviewArm=String(proposal.payload.reviewArm||rec?.reviewArm||"");
  if(!reviewArm)throw new Error("No review arm.");
  const safetyStatus=latestEvalStatus(ev);
  if(policy.require_clean_guardrails&&["srm_warning","guardrail_risk"].includes(String(safetyStatus)))throw new Error("Latest evaluation has safety/data-quality risk.");

  const exposureCounts=await query<{arm_key:string;n:string}>(
    `select arm_key,count(*)::text as n from outbound_experiment_exposures where experiment_id=$1 group by arm_key`,
    [experiment.id],
  );
  if(exposureCounts.some(x=>Number(x.n)<policy.min_arm_exposure)||exposureCounts.length<2){
    throw new Error("Minimum arm exposure not reached.");
  }
  const [recent]=await query<{created_at:Date}>(
    `select created_at from outbound_events
     where workspace='default' and event_type='experiment_traffic_reallocated' and experiment_id=$1
     order by created_at desc limit 1`,
    [experiment.id],
  );
  if(recent&&Date.now()-new Date(recent.created_at).getTime()<policy.cooldown_hours*3600_000){
    throw new Error("Optimization cooldown is still active.");
  }

  const arms=await query<Arm>(
    `select arm_key,label,weight,status from outbound_experiment_arms where experiment_id=$1 order by created_at,arm_key`,
    [experiment.id],
  );
  const control=experiment.control_arm_key||arms[0]?.arm_key;
  if(!control)throw new Error("Control arm missing.");
  const shifted=computeShift(arms,reviewArm,control,Number(policy.max_weight_shift_per_cycle),Number(policy.min_control_weight));

  for(const [armKey,weight] of Object.entries(shifted.after)){
    await query(`update outbound_experiment_arms set weight=$3 where experiment_id=$1 and arm_key=$2`,[experiment.id,armKey,weight]);
  }
  await query(
    `update outbound_optimization_proposals
     set status='executed',executed_by=$2,executed_at=now(),execution_result=$3::jsonb
     where id=$1`,
    [proposal.id,actorId,JSON.stringify(shifted)],
  );
  await query(
    `update outbound_agent_decisions
     set status='executed',approved_by=coalesce(approved_by,$2),approved_at=coalesce(approved_at,now()),executed_at=now()
     where id=(select decision_id from outbound_optimization_proposals where id=$1)`,
    [proposal.id,actorId],
  );
  await recordOutboundEventByMode({
    workspace:"default",type:"experiment_traffic_reallocated",actorType:"agent",actorId:"optimization-agent",
    experimentId:experiment.id,experimentArmKey:reviewArm,
    idempotencyKey:`traffic-reallocated:${proposal.id}`,
    payload:{proposalId:proposal.id,policyId:policy.id,...shifted,autonomy},
  });
  return shifted;
}

async function executeNewExperimentDraft(proposal:Proposal,policy:Policy,actorId:string){
  if(policy.status!=="active"||!policy.approved_by||!policy.allow_new_experiment_drafts)throw new Error("Active approved policy required.");
  const runtime=await resolveOutboundRuntimeConfig();
  const autonomy=evaluateAutonomy(runtime.autonomyLevel,"publish_experiment",true);
  if(!autonomy.executable)throw new Error(`L5 execution blocked: ${autonomy.reason}`);

  const payload=proposal.payload;
  const subject=String(payload.subject||"").trim(),body=String(payload.body||"").trim();
  if(!subject||!body)throw new Error("Proposal lacks approved copy.");
  const campaignKey=`agent-draft:${proposal.id}`;
  const [version]=await query<{id:string}>(
    `insert into outbound_campaign_versions(
       workspace,campaign_key,version,status,name,audience_definition,offer_definition,steps,
       content_hash,created_by
     )
     values(
       'default',$1,1,'draft',$2,$3::jsonb,'{}'::jsonb,$4::jsonb,$5,'optimization-agent'
     )
     returning id`,
    [
      campaignKey,`AI Experiment Draft · ${String(payload.segmentKey||"segment")}`,
      JSON.stringify({segmentKey:payload.segmentKey,requiresHumanAudienceDefinition:true}),
      JSON.stringify([{waitDays:0,subject,body}]),
      sha(JSON.stringify({subject,body,segmentKey:payload.segmentKey})),
    ],
  );
  if(!version)throw new Error("Draft campaign version could not be created.");
  await query(
    `update outbound_optimization_proposals
     set status='executed',executed_by=$2,executed_at=now(),execution_result=$3::jsonb
     where id=$1`,
    [proposal.id,actorId,JSON.stringify({campaignVersionId:version.id,status:"draft",notLaunched:true})],
  );
  await recordOutboundEventByMode({
    workspace:"default",type:"new_experiment_draft_created",actorType:"agent",actorId:"optimization-agent",
    campaignVersionId:version.id,idempotencyKey:`new-experiment-draft:${proposal.id}`,
    payload:{proposalId:proposal.id,policyId:policy.id,notLaunched:true,autonomy},
  });
  return {campaignVersionId:version.id,status:"draft",notLaunched:true};
}

export async function runOptimizationCycle(){
  const runtime=await resolveOutboundRuntimeConfig();
  const policy=await currentPolicy();
  const experiments=await query<ExperimentCandidate>(
    `select e.id,e.campaign_version_id,e.status,e.control_arm_key,
            (
              select jsonb_build_object(
                'id',ev.id,'status',ev.status,'totalExposed',ev.total_exposed,'srmPValue',ev.srm_p_value,
                'recommendation',ev.recommendation,'guardrailResults',ev.guardrail_results,'evaluatedAt',ev.evaluated_at
              ) from outbound_experiment_evaluations ev
              where ev.experiment_id=e.id order by ev.evaluated_at desc limit 1
            ) as latest_evaluation
     from outbound_experiments e
     where e.workspace='default' and e.status='running'
     order by e.updated_at desc limit 50`
  );
  let proposed=0,executed=0,blocked=0;
  for(const experiment of experiments){
    try{if(await trafficProposalForExperiment(experiment,policy))proposed++}catch{blocked++}
  }
  proposed+=await proposeNewExperimentDrafts(policy);

  if(policy?.status==="active"&&runtime.autonomyLevel>=4){
    const approved=await query<Proposal>(
      `select id,policy_id,experiment_id,proposal_type,status,payload,rationale,evidence
       from outbound_optimization_proposals
       where workspace='default' and status='approved' and (expires_at is null or expires_at>now())
       order by approved_at asc limit 20`
    );
    for(const proposal of approved){
      try{
        if(proposal.proposal_type==="traffic_allocation")await executeTrafficProposal(proposal,policy,"optimization-agent");
        else if(runtime.autonomyLevel>=5)await executeNewExperimentDraft(proposal,policy,"optimization-agent");
        else {blocked++;continue}
        executed++;
      }catch(error){
        blocked++;
        await query(
          `update outbound_optimization_proposals set blocker_reasons=$2::jsonb where id=$1`,
          [proposal.id,JSON.stringify([error instanceof Error?error.message:"Execution blocked"])],
        );
      }
    }
  }

  const [cycle]=await query<{id:string}>(
    `insert into outbound_optimization_cycles(
       workspace,policy_id,status,autonomy_level,examined,proposed,executed,blocked,summary
     )
     values('default',$1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     returning id`,
    [
      policy?.id??null,blocked&&runtime.autonomyLevel>=4?"blocked":"completed",runtime.autonomyLevel,
      experiments.length,proposed,executed,blocked,
      JSON.stringify({policyStatus:policy?.status||"none",currentTarget:"L2",optimizationAutopilot:runtime.autonomyLevel>=4}),
    ],
  );
  return {cycleId:cycle?.id??null,policyStatus:policy?.status||"none",autonomyLevel:runtime.autonomyLevel,examined:experiments.length,proposed,executed,blocked};
}

export async function reviewOptimizationPolicy(raw:z.infer<typeof policyActionSchema>,actorId="admin-session"){
  const input=policyActionSchema.parse(raw);
  const [policy]=await query<Policy>(
    `select id,policy_key,version,status,description,max_weight_shift_per_cycle,min_control_weight,
            min_arm_exposure,cooldown_hours,require_evidence_signal,require_clean_guardrails,
            allow_new_experiment_drafts,allow_traffic_allocation,max_active_experiments,policy,approved_by,approved_at
     from outbound_optimization_policies where workspace='default' and id=$1 limit 1`,
    [input.policyId],
  );
  if(!policy)throw new Error("Optimization policy not found.");
  let next:string;
  if(input.action==="approve"){
    if(policy.status!=="draft")throw new Error("Only draft policies can be approved.");
    next="approved";
    await query(`update outbound_optimization_policies set status='approved',approved_by=$2,approved_at=now() where id=$1`,[policy.id,actorId]);
  }else if(input.action==="activate"){
    if(!policy.approved_by||!policy.approved_at||!["approved","paused"].includes(policy.status))throw new Error("Policy must be human-approved before activation.");
    await query(`update outbound_optimization_policies set status='paused' where workspace='default' and policy_key=$2 and status='active' and id<>$1`,[policy.id,policy.policy_key]);
    await query(`update outbound_optimization_policies set status='active',activated_by=$2,activated_at=now() where id=$1`,[policy.id,actorId]);
    next="active";
  }else if(input.action==="pause"){
    await query(`update outbound_optimization_policies set status='paused' where id=$1 and status='active'`,[policy.id]);next="paused";
  }else{
    await query(`update outbound_optimization_policies set status='retired' where id=$1 and status<>'active'`,[policy.id]);next="retired";
  }
  await recordOutboundEventByMode({
    workspace:"default",type:"optimization_policy_changed",actorType:"human",actorId,
    idempotencyKey:`optimization-policy:${policy.id}:${next}:${Date.now()}`,
    payload:{policyId:policy.id,from:policy.status,to:next,reason:input.reason},
  });
  return {id:policy.id,status:next};
}

export async function reviewOptimizationProposal(raw:z.infer<typeof proposalActionSchema>,actorId="admin-session"){
  const input=proposalActionSchema.parse(raw);
  const [proposal]=await query<Proposal>(
    `select id,policy_id,experiment_id,proposal_type,status,payload,rationale,evidence
     from outbound_optimization_proposals where workspace='default' and id=$1 limit 1`,
    [input.proposalId],
  );
  if(!proposal)throw new Error("Optimization proposal not found.");
  if(input.action==="reject"){
    await query(`update outbound_optimization_proposals set status='rejected',blocker_reasons=$2::jsonb where id=$1 and status in ('proposed','approved')`,[proposal.id,JSON.stringify([input.reason])]);
    return {id:proposal.id,status:"rejected"};
  }
  if(input.action==="approve"){
    if(proposal.status!=="proposed")throw new Error("Only proposed items can be approved.");
    await query(`update outbound_optimization_proposals set status='approved',approved_by=$2,approved_at=now() where id=$1`,[proposal.id,actorId]);
    await query(`update outbound_agent_decisions set status='approved',approved_by=$2,approved_at=now() where id=(select decision_id from outbound_optimization_proposals where id=$1)`,[proposal.id,actorId]);
    return {id:proposal.id,status:"approved"};
  }
  if(proposal.status!=="approved")throw new Error("Proposal must be approved before execution.");
  const policy=await currentPolicy();
  if(!policy||policy.status!=="active")throw new Error("No active approved optimization policy.");
  const result=proposal.proposal_type==="traffic_allocation"
    ?await executeTrafficProposal(proposal,policy,actorId)
    :await executeNewExperimentDraft(proposal,policy,actorId);
  return {id:proposal.id,status:"executed",result};
}

export async function getOptimizationDashboard(){
  const runtime=await resolveOutboundRuntimeConfig();
  const policies=await query<Policy>(
    `select id,policy_key,version,status,description,max_weight_shift_per_cycle,min_control_weight,
            min_arm_exposure,cooldown_hours,require_evidence_signal,require_clean_guardrails,
            allow_new_experiment_drafts,allow_traffic_allocation,max_active_experiments,policy,
            approved_by,approved_at
     from outbound_optimization_policies where workspace='default'
     order by version desc`
  );
  const proposals=await query<Proposal&{created_at:Date;approved_by:string|null;blocker_reasons:string[]}>(
    `select id,policy_id,experiment_id,proposal_type,status,payload,rationale,evidence,created_at,approved_by,blocker_reasons
     from outbound_optimization_proposals where workspace='default'
     order by case status when 'proposed' then 0 when 'approved' then 1 when 'blocked' then 2 else 3 end,created_at desc
     limit 100`
  );
  const cycles=await query<{id:string;status:string;autonomy_level:number;examined:number;proposed:number;executed:number;blocked:number;summary:Record<string,unknown>;created_at:Date}>(
    `select id,status,autonomy_level,examined,proposed,executed,blocked,summary,created_at
     from outbound_optimization_cycles where workspace='default' order by created_at desc limit 30`
  );
  return {
    policyVersion:OPTIMIZATION_POLICY_VERSION,
    autonomyLevel:runtime.autonomyLevel,
    l4Executable:runtime.autonomyLevel>=4,
    l5Executable:runtime.autonomyLevel>=5,
    currentProductionTarget:"L2",
    policies,proposals,cycles,
    summary:{
      proposed:proposals.filter(p=>p.status==="proposed").length,
      approved:proposals.filter(p=>p.status==="approved").length,
      executed:proposals.filter(p=>p.status==="executed").length,
      blocked:proposals.filter(p=>p.status==="blocked").length,
      activePolicies:policies.filter(p=>p.status==="active").length,
    },
  };
}
