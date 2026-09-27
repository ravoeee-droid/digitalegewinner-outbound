import { z } from "zod";
import { query } from "@/lib/db";
import { recordOutboundEvent } from "@/lib/outbound-event-ledger";
import { invalidateOutboundRuntimeConfigCache, resolveOutboundRuntimeConfig, type OutboundRuntimeConfig } from "@/lib/outbound-runtime-config";
import type { AutonomyLevel } from "@/lib/outbound-contracts";

const modeSchema = z.enum(["off","shadow","active"]);
const complianceSchema = z.enum(["off","shadow","enforce"]);

export const runtimeUpdateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  v3Mode: modeSchema.optional(),
  complianceMode: complianceSchema.optional(),
  autonomyLevel: z.number().int().min(0).max(5).optional(),
  durableWorkflowsMode: modeSchema.optional(),
  reason: z.string().min(3).max(1000),
});

export type RuntimeUpdateInput = z.infer<typeof runtimeUpdateSchema>;

type RuntimeRow = {
  workspace:string;
  v3_mode:"off"|"shadow"|"active";
  compliance_mode:"off"|"shadow"|"enforce";
  autonomy_level:number;
  durable_workflows_mode:"off"|"shadow"|"active";
  version:number;
  updated_by:string;
  updated_at:Date;
};

export const OUTBOUND_V3_CAPABILITIES = {
  schemaFoundation: true,
  shadowEventLedger: true,
  nativeV3Execution: false,
  complianceEnforcement: false,
  durableWorkflowExecution: false,
  conversationAutopilot: false,
  optimizationAutopilot: false,
} as const;

function toConfig(row:RuntimeRow):OutboundRuntimeConfig {
  return {
    v3Mode:row.v3_mode,
    complianceMode:row.compliance_mode,
    autonomyLevel:row.autonomy_level as AutonomyLevel,
    durableWorkflowsMode:row.durable_workflows_mode,
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
  if(next.durableWorkflowsMode!=="off"&&!OUTBOUND_V3_CAPABILITIES.durableWorkflowExecution){
    blockers.push("Durable workflow mode is locked until the Trigger.dev migration milestone is complete.");
  }
  if(next.autonomyLevel>2){
    blockers.push("Autonomy above L2 is locked until conversation and optimization eval gates are complete.");
  }

  return {allowed:blockers.length===0,blockers};
}

export async function getRuntimeControlPlane(workspace="default"){
  const resolved=await resolveOutboundRuntimeConfig(workspace);
  const [raw]=await query<RuntimeRow>(
    `select workspace,v3_mode,compliance_mode,autonomy_level,durable_workflows_mode,version,updated_by,updated_at
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

  const parity={
    window:"24h",
    sends:{legacy:Number(legacySends?.count||0),v3:Number(v3Sends?.count||0)},
    replies:{legacy:Number(legacyReplies?.count||0),v3:Number(v3Replies?.count||0)},
    bounces:{legacy:Number(legacyBounces?.count||0),v3:Number(v3Bounces?.count||0)},
  };

  const transition=validateRuntimeTransition({
    v3Mode:resolved.v3Mode,
    complianceMode:resolved.complianceMode,
    autonomyLevel:resolved.autonomyLevel,
    durableWorkflowsMode:resolved.durableWorkflowsMode,
  });

  return {
    workspace,
    resolved,
    stored:raw?{
      v3Mode:raw.v3_mode,
      complianceMode:raw.compliance_mode,
      autonomyLevel:raw.autonomy_level,
      durableWorkflowsMode:raw.durable_workflows_mode,
      version:raw.version,
      updatedBy:raw.updated_by,
      updatedAt:raw.updated_at,
    }:null,
    schema:{
      expectedTables:10,
      presentTables:Number(schema?.present||0),
      ready:Number(schema?.present||0)===10,
    },
    capabilities:OUTBOUND_V3_CAPABILITIES,
    parity,
    currentTransitionValid:transition.allowed,
    currentTransitionBlockers:transition.blockers,
    environmentOverrides:{
      v3Mode:Boolean(process.env.OUTBOUND_OS_V3_MODE),
      complianceMode:Boolean(process.env.OUTBOUND_COMPLIANCE_MODE),
      autonomyLevel:Boolean(process.env.OUTBOUND_AUTONOMY_LEVEL),
      durableWorkflowsMode:Boolean(process.env.OUTBOUND_DURABLE_WORKFLOWS_MODE),
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
    `select workspace,v3_mode,compliance_mode,autonomy_level,durable_workflows_mode,version,updated_by,updated_at
     from outbound_runtime_settings where workspace=$1 limit 1`,
    [workspace],
  );
  if(!before)throw new Error("Outbound runtime settings are not initialized.");

  const next:OutboundRuntimeConfig={
    v3Mode:parsed.v3Mode??before.v3_mode,
    complianceMode:parsed.complianceMode??before.compliance_mode,
    autonomyLevel:(parsed.autonomyLevel??before.autonomy_level) as AutonomyLevel,
    durableWorkflowsMode:parsed.durableWorkflowsMode??before.durable_workflows_mode,
  };

  const validation=validateRuntimeTransition(next);
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
         version=version+1,
         updated_by=$7,
         updated_at=now()
     where workspace=$1 and version=$2
     returning workspace,v3_mode,compliance_mode,autonomy_level,durable_workflows_mode,version,updated_by,updated_at`,
    [
      workspace,
      parsed.expectedVersion,
      next.v3Mode,
      next.complianceMode,
      next.autonomyLevel,
      next.durableWorkflowsMode,
      actorId,
    ],
  );

  const after=rows[0];
  if(!after){
    const [current]=await query<RuntimeRow>(
      `select workspace,v3_mode,compliance_mode,autonomy_level,durable_workflows_mode,version,updated_by,updated_at
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
