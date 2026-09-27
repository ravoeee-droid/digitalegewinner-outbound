import { z } from "zod";
import { query, readState } from "@/lib/db";
import { recordOutboundEvent } from "@/lib/outbound-event-ledger";
import { invalidateOutboundRuntimeConfigCache, resolveOutboundRuntimeConfig, type OutboundRuntimeConfig } from "@/lib/outbound-runtime-config";
import type { AutonomyLevel } from "@/lib/outbound-contracts";
import { loadMailboxCredentials } from "@/lib/mailbox-credentials";
import { getComplianceEnforcementReadiness } from "@/lib/outbound-compliance-engine";

const modeSchema = z.enum(["off","shadow","active"]);
const complianceSchema = z.enum(["off","shadow","enforce"]);
const deliverabilitySchema = z.enum(["off","shadow","enforce"]);
const conversationSchema = z.enum(["off","shadow","assist"]);

export const runtimeUpdateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  v3Mode: modeSchema.optional(),
  complianceMode: complianceSchema.optional(),
  autonomyLevel: z.number().int().min(0).max(5).optional(),
  durableWorkflowsMode: modeSchema.optional(),
  deliverabilityMode: deliverabilitySchema.optional(),
  conversationMode: conversationSchema.optional(),
  reason: z.string().min(3).max(1000),
});

export type RuntimeUpdateInput = z.infer<typeof runtimeUpdateSchema>;

type RuntimeRow = {
  workspace:string;
  v3_mode:"off"|"shadow"|"active";
  compliance_mode:"off"|"shadow"|"enforce";
  autonomy_level:number;
  durable_workflows_mode:"off"|"shadow"|"active";
  deliverability_mode:"off"|"shadow"|"enforce";
  conversation_mode:"off"|"shadow"|"assist";
  version:number;
  updated_by:string;
  updated_at:Date;
};

export const OUTBOUND_V3_CAPABILITIES = {
  schemaFoundation: true,
  shadowEventLedger: true,
  nativeV3Execution: false,
  complianceEnforcement: true,
  durableWorkflowShadow: true,
  durableWorkflowExecution: false,
  deliverabilityShadow: true,
  deliverabilityEnforcement: true,
  conversationIntelligence: true,
  conversationAutopilot: false,
  optimizationAutopilot: false,
} as const;

function toConfig(row:RuntimeRow):OutboundRuntimeConfig {
  return {
    v3Mode:row.v3_mode,
    complianceMode:row.compliance_mode,
    autonomyLevel:row.autonomy_level as AutonomyLevel,
    durableWorkflowsMode:row.durable_workflows_mode,
    deliverabilityMode:row.deliverability_mode,
    conversationMode:row.conversation_mode,
  };
}

export function validateRuntimeTransition(next:OutboundRuntimeConfig) {
  const blockers:string[]=[];

  if(next.v3Mode==="active"&&!OUTBOUND_V3_CAPABILITIES.nativeV3Execution){
    blockers.push("V3 active is locked until the native V3 execution engine passes shadow parity.");
  }
  if(next.complianceMode==="enforce"&&!OUTBOUND_V3_CAPABILITIES.complianceEnforcement){
    blockers.push("Compliance enforcement is locked until permission backfill and enforcement tests pass.");
  }
  if(next.durableWorkflowsMode==="shadow"&&!OUTBOUND_V3_CAPABILITIES.durableWorkflowShadow){
    blockers.push("Durable workflow shadow is not ready yet.");
  }
  if(next.durableWorkflowsMode==="active"&&!OUTBOUND_V3_CAPABILITIES.durableWorkflowExecution){
    blockers.push("Durable workflow active execution is locked until shadow parity and recovery drills pass.");
  }
  if(next.deliverabilityMode==="shadow"&&!OUTBOUND_V3_CAPABILITIES.deliverabilityShadow){
    blockers.push("Deliverability shadow is not ready yet.");
  }
  if(next.deliverabilityMode==="enforce"&&!OUTBOUND_V3_CAPABILITIES.deliverabilityEnforcement){
    blockers.push("Deliverability enforcement is locked until health checks and recovery gates pass.");
  }
  if(next.deliverabilityMode==="enforce"&&next.autonomyLevel<2){
    blockers.push("Deliverability enforcement requires at least L2 safety autonomy.");
  }
  if(next.conversationMode==="assist"&&next.autonomyLevel<2){
    blockers.push("Conversation assist requires at least L2 safety autonomy.");
  }
  if(next.autonomyLevel>2){
    blockers.push("Autonomy above L2 is locked until conversation and optimization eval gates are complete.");
  }

  return {allowed:blockers.length===0,blockers};
}

export async function getRuntimeControlPlane(workspace="default"){
  const resolved=await resolveOutboundRuntimeConfig(workspace);
  const [raw]=await query<RuntimeRow>(
    `select workspace,v3_mode,compliance_mode,autonomy_level,durable_workflows_mode,deliverability_mode,conversation_mode,version,updated_by,updated_at
     from outbound_runtime_settings where workspace=$1 limit 1`,
    [workspace],
  );

  const [schema]=await query<{present:string}>(
    `select count(*)::text as present
     from information_schema.tables
     where table_schema='public'
       and table_name=any($1::text[])`,
    [[
      "outbound_campaign_versions",
      "outbound_experiments",
      "outbound_experiment_arms",
      "outbound_experiment_assignments",
      "outbound_contact_permissions",
      "outbound_events",
      "outbound_agent_decisions",
      "outbound_approvals",
      "outbound_sender_health_snapshots",
      "outbound_runtime_settings",
      "outbound_workflow_runs",
      "outbound_workflow_steps",
      "outbound_workflow_signals",
      "outbound_sender_health_state",
      "outbound_compliance_suppressions",
      "outbound_permission_reviews",
      "outbound_conversation_threads",
      "outbound_conversation_messages",
      "outbound_reply_classifications",
      "outbound_conversation_escalations",
    ]],
  );

  const [legacySends]=await query<{count:string}>(
    `select count(*)::text as count from er_outbox
     where workspace=$1 and status='sent' and sent_at>=now()-interval '24 hours'`,
    [workspace],
  );
  const [v3Sends]=await query<{count:string}>(
    `select count(*)::text as count from outbound_events
     where workspace=$1 and event_type='provider_accepted' and occurred_at>=now()-interval '24 hours'`,
    [workspace],
  );
  const [legacyReplies]=await query<{count:string}>(
    `select count(*)::text as count from er_events
     where workspace=$1 and type='reply' and created_at>=now()-interval '24 hours'`,
    [workspace],
  );
  const [v3Replies]=await query<{count:string}>(
    `select count(*)::text as count from outbound_events
     where workspace=$1 and event_type='reply_received' and occurred_at>=now()-interval '24 hours'`,
    [workspace],
  );
  const [legacyBounces]=await query<{count:string}>(
    `select count(*)::text as count from er_events
     where workspace=$1 and type='bounce' and created_at>=now()-interval '24 hours'`,
    [workspace],
  );
  const [v3Bounces]=await query<{count:string}>(
    `select count(*)::text as count from outbound_events
     where workspace=$1 and event_type='bounce' and occurred_at>=now()-interval '24 hours'`,
    [workspace],
  );

  const complianceRows=await query<{event_type:string;reason:string|null;count:string}>(
    `select event_type,payload->>'reason' as reason,count(*)::text as count
     from outbound_events
     where workspace=$1
       and event_type in ('permission_verified','permission_denied')
       and occurred_at>=now()-interval '24 hours'
     group by event_type,payload->>'reason'
     order by count(*) desc`,
    [workspace],
  );

  const workflowRuns=await query<{status:string;count:string}>(
    `select status,count(*)::text as count
     from outbound_workflow_runs
     where workspace=$1
       and created_at>=now()-interval '30 days'
     group by status`,
    [workspace],
  );
  const [workflowSteps]=await query<{total:string;due:string;leased:string;failed:string}>(
    `select
       count(*)::text as total,
       count(*) filter(
         where status in ('pending','waiting','ready','running')
           and (wake_at is null or wake_at<=now())
       )::text as due,
       count(*) filter(
         where lease_expires_at is not null and lease_expires_at>now()
       )::text as leased,
       count(*) filter(where status in ('failed','blocked'))::text as failed
     from outbound_workflow_steps
     where workspace=$1
       and created_at>=now()-interval '30 days'`,
    [workspace],
  );
  const [workflowSignals]=await query<{pending:string;failed:string}>(
    `select
       count(*) filter(where processed_at is null and attempt<max_attempts)::text as pending,
       count(*) filter(where processed_at is null and attempt>=max_attempts)::text as failed
     from outbound_workflow_signals
     where workspace=$1
       and received_at>=now()-interval '30 days'`,
    [workspace],
  );
  const [legacySequences]=await query<{count:string}>(
    `select count(*)::text as count
     from (
       select distinct campaign_id,lead_id
       from er_outbox
       where workspace=$1
         and campaign_id is not null
         and created_at>=now()-interval '30 days'
     ) sequences`,
    [workspace],
  );
  const [mirroredSequences]=await query<{count:string}>(
    `select count(*)::text as count
     from outbound_workflow_runs
     where workspace=$1
       and legacy_campaign_id is not null
       and created_at>=now()-interval '30 days'`,
    [workspace],
  );

  const parity={
    window:"24h",
    sends:{legacy:Number(legacySends?.count||0),v3:Number(v3Sends?.count||0)},
    replies:{legacy:Number(legacyReplies?.count||0),v3:Number(v3Replies?.count||0)},
    bounces:{legacy:Number(legacyBounces?.count||0),v3:Number(v3Bounces?.count||0)},
  };
  const complianceShadow={
    window:"24h",
    evaluated:complianceRows.reduce((sum,row)=>sum+Number(row.count||0),0),
    allowed:complianceRows.filter(row=>row.event_type==="permission_verified").reduce((sum,row)=>sum+Number(row.count||0),0),
    denied:complianceRows.filter(row=>row.event_type==="permission_denied").reduce((sum,row)=>sum+Number(row.count||0),0),
    reasons:Object.fromEntries(
      complianceRows
        .filter(row=>row.event_type==="permission_denied")
        .map(row=>[row.reason||"unknown",Number(row.count||0)]),
    ),
  };
  const legacySequenceCount=Number(legacySequences?.count||0);
  const mirroredSequenceCount=Number(mirroredSequences?.count||0);
  const workflowShadow={
    window:"30d",
    legacySequences:legacySequenceCount,
    mirroredSequences:mirroredSequenceCount,
    parityPercent:legacySequenceCount===0?100:Math.min(100,Math.round((mirroredSequenceCount/legacySequenceCount)*100)),
    runs:Object.fromEntries(workflowRuns.map(row=>[row.status,Number(row.count||0)])),
    steps:{
      total:Number(workflowSteps?.total||0),
      due:Number(workflowSteps?.due||0),
      leased:Number(workflowSteps?.leased||0),
      failed:Number(workflowSteps?.failed||0),
    },
    signals:{
      pending:Number(workflowSignals?.pending||0),
      failed:Number(workflowSignals?.failed||0),
    },
  };

  const healthRows=await query<{
    target_type:"mailbox"|"domain";target_id:string;domain:string|null;health_status:string;
    health_score:number;base_daily_limit:number|null;recommended_daily_limit:number|null;
    enforced_daily_limit:number|null;last_action:string|null;last_reason:string|null;
    reasons:string[];metrics:Record<string,unknown>;observed_at:Date
  }>(
    `select target_type,target_id,domain,health_status,health_score,base_daily_limit,
            recommended_daily_limit,enforced_daily_limit,last_action,last_reason,reasons,metrics,observed_at
     from outbound_sender_health_state
     where workspace=$1
     order by target_type,target_id`,
    [workspace],
  );
  const deliverability={
    mode:resolved.deliverabilityMode,
    summary:{
      healthy:healthRows.filter(row=>row.health_status==="healthy").length,
      watch:healthRows.filter(row=>row.health_status==="watch").length,
      degraded:healthRows.filter(row=>row.health_status==="degraded").length,
      paused:healthRows.filter(row=>row.health_status==="paused").length,
    },
    domains:healthRows.filter(row=>row.target_type==="domain"),
    mailboxes:healthRows.filter(row=>row.target_type==="mailbox"),
  };

  const transition=validateRuntimeTransition({
    v3Mode:resolved.v3Mode,
    complianceMode:resolved.complianceMode,
    autonomyLevel:resolved.autonomyLevel,
    durableWorkflowsMode:resolved.durableWorkflowsMode,
    deliverabilityMode:resolved.deliverabilityMode,
    conversationMode:resolved.conversationMode,
  });

  return {
    workspace,
    resolved,
    stored:raw?{
      v3Mode:raw.v3_mode,
      complianceMode:raw.compliance_mode,
      autonomyLevel:raw.autonomy_level,
      durableWorkflowsMode:raw.durable_workflows_mode,
      deliverabilityMode:raw.deliverability_mode,
      conversationMode:raw.conversation_mode,
      version:raw.version,
      updatedBy:raw.updated_by,
      updatedAt:raw.updated_at,
    }:null,
    schema:{
      expectedTables:20,
      presentTables:Number(schema?.present||0),
      ready:Number(schema?.present||0)===20,
    },
    capabilities:OUTBOUND_V3_CAPABILITIES,
    parity,
    complianceShadow,
    workflowShadow,
    deliverability,
    currentTransitionValid:transition.allowed,
    currentTransitionBlockers:transition.blockers,
    environmentOverrides:{
      v3Mode:Boolean(process.env.OUTBOUND_OS_V3_MODE),
      complianceMode:Boolean(process.env.OUTBOUND_COMPLIANCE_MODE),
      autonomyLevel:Boolean(process.env.OUTBOUND_AUTONOMY_LEVEL),
      durableWorkflowsMode:Boolean(process.env.OUTBOUND_DURABLE_WORKFLOWS_MODE),
      deliverabilityMode:Boolean(process.env.OUTBOUND_DELIVERABILITY_MODE),
      conversationMode:Boolean(process.env.OUTBOUND_CONVERSATION_MODE),
      emergencyKillSwitch:process.env.OUTBOUND_EMERGENCY_KILL_SWITCH==="true",
    },
  };
}

export async function updateRuntimeControlPlane(
  input:RuntimeUpdateInput,
  workspace="default",
  actorId="admin-session",
){
  const parsed=runtimeUpdateSchema.parse(input);
  const [before]=await query<RuntimeRow>(
    `select workspace,v3_mode,compliance_mode,autonomy_level,durable_workflows_mode,deliverability_mode,conversation_mode,version,updated_by,updated_at
     from outbound_runtime_settings where workspace=$1 limit 1`,
    [workspace],
  );
  if(!before)throw new Error("Outbound runtime settings are not initialized.");

  const next:OutboundRuntimeConfig={
    v3Mode:parsed.v3Mode??before.v3_mode,
    complianceMode:parsed.complianceMode??before.compliance_mode,
    autonomyLevel:(parsed.autonomyLevel??before.autonomy_level) as AutonomyLevel,
    durableWorkflowsMode:parsed.durableWorkflowsMode??before.durable_workflows_mode,
    deliverabilityMode:parsed.deliverabilityMode??before.deliverability_mode,
    conversationMode:parsed.conversationMode??before.conversation_mode,
  };

  const validation=validateRuntimeTransition(next);

  if(parsed.complianceMode==="enforce"&&before.compliance_mode!=="enforce"){
    const readiness=await getComplianceEnforcementReadiness(workspace);
    if(!readiness.ready){
      const blockers=[
        `${readiness.blocked} bereits gequeue-te Nachricht(en) würden vom Compliance Gate blockiert.`,
        ...Object.entries(readiness.reasons).map(([reason,count])=>`${reason}: ${count}`),
      ];
      await recordOutboundEvent({
        workspace,
        type:"runtime_activation_blocked",
        actorType:"human",
        actorId,
        idempotencyKey:`compliance-enforce-blocked:${workspace}:${before.version}`,
        payload:{requested:next,reason:parsed.reason,blockers,readiness},
      });
      return {ok:false,conflict:false,blocked:true,blockers,current:before};
    }
  }

  if(parsed.deliverabilityMode==="enforce"&&before.deliverability_mode!=="enforce"){
    const credentials=await loadMailboxCredentials().catch(()=>[]);
    const state=(await readState().catch(()=>null))?.payload as {mailboxes?:Array<{id:string;enabled?:boolean}>}|undefined;
    const enabledIds=new Set((state?.mailboxes||[]).filter(item=>item.enabled!==false).map(item=>item.id));
    const activeCredentials=enabledIds.size?credentials.filter(item=>enabledIds.has(item.id)):credentials;
    const ids=activeCredentials.map(item=>item.id);
    const healthRows=ids.length?await query<{target_id:string;observed_at:Date}>(
      `select target_id,observed_at
       from outbound_sender_health_state
       where workspace=$1 and target_type='mailbox' and target_id=any($2::text[])`,
      [workspace,ids],
    ):[];
    const healthById=new Map(healthRows.map(row=>[row.target_id,row]));
    const missing=ids.filter(id=>!healthById.has(id));
    const stale=ids.filter(id=>{
      const observed=healthById.get(id)?.observed_at;
      return !observed||(Date.now()-new Date(observed).getTime())>3*60*60*1000;
    });
    if(!ids.length||missing.length||stale.length){
      const blockers=[
        !ids.length?"No configured mailboxes were found.":null,
        missing.length?`Missing health state for: ${missing.join(", ")}`:null,
        stale.length?`Stale health state for: ${stale.join(", ")}`:null,
      ].filter(Boolean) as string[];
      await recordOutboundEvent({
        workspace,
        type:"runtime_activation_blocked",
        actorType:"human",
        actorId,
        idempotencyKey:`deliverability-enforce-blocked:${workspace}:${before.version}`,
        payload:{requested:next,reason:parsed.reason,blockers},
      });
      return {ok:false,conflict:false,blocked:true,blockers,current:before};
    }
  }
  if(!validation.allowed){
    await recordOutboundEvent({
      workspace,
      type:"runtime_activation_blocked",
      actorType:"human",
      actorId,
      idempotencyKey:`runtime-blocked:${workspace}:${before.version}:${JSON.stringify(next)}`,
      payload:{before:toConfig(before),requested:next,reason:parsed.reason,blockers:validation.blockers},
    });
    return {ok:false,conflict:false,blocked:true,blockers:validation.blockers,current:before};
  }

  const rows=await query<RuntimeRow>(
    `update outbound_runtime_settings
     set v3_mode=$3,
         compliance_mode=$4,
         autonomy_level=$5,
         durable_workflows_mode=$6,
         deliverability_mode=$7,
         conversation_mode=$8,
         version=version+1,
         updated_by=$9,
         updated_at=now()
     where workspace=$1 and version=$2
     returning workspace,v3_mode,compliance_mode,autonomy_level,durable_workflows_mode,deliverability_mode,conversation_mode,version,updated_by,updated_at`,
    [
      workspace,
      parsed.expectedVersion,
      next.v3Mode,
      next.complianceMode,
      next.autonomyLevel,
      next.durableWorkflowsMode,
      next.deliverabilityMode,
      next.conversationMode,
      actorId,
    ],
  );

  const after=rows[0];
  if(!after){
    const [current]=await query<RuntimeRow>(
      `select workspace,v3_mode,compliance_mode,autonomy_level,durable_workflows_mode,deliverability_mode,conversation_mode,version,updated_by,updated_at
       from outbound_runtime_settings where workspace=$1 limit 1`,
      [workspace],
    );
    return {ok:false,conflict:true,blocked:false,current};
  }

  invalidateOutboundRuntimeConfigCache(workspace);

  await recordOutboundEvent({
    workspace,
    type:"runtime_config_changed",
    actorType:"human",
    actorId,
    idempotencyKey:`runtime-change:${workspace}:${after.version}`,
    payload:{before:toConfig(before),after:toConfig(after),reason:parsed.reason},
  });

  return {ok:true,conflict:false,blocked:false,current:after};
}
