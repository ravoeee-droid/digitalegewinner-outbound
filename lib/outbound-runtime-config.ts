import { z } from "zod";
import { query } from "@/lib/db";
import type { AutonomyLevel } from "@/lib/outbound-contracts";

const modeSchema = z.enum(["off", "shadow", "active"]);
const complianceModeSchema = z.enum(["off", "shadow", "enforce"]);

function parseAutonomyLevel(value: unknown, fallback: AutonomyLevel = 2): AutonomyLevel {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 5) {
    throw new Error("Outbound autonomy level must be an integer from 0 to 5.");
  }
  return parsed as AutonomyLevel;
}

export type OutboundRuntimeConfig = {
  v3Mode: z.infer<typeof modeSchema>;
  complianceMode: z.infer<typeof complianceModeSchema>;
  autonomyLevel: AutonomyLevel;
  durableWorkflowsMode: z.infer<typeof modeSchema>;
};

export type ResolvedOutboundRuntimeConfig = OutboundRuntimeConfig & {
  workspace: string;
  version: number | null;
  updatedBy: string | null;
  updatedAt: Date | null;
  source: "defaults" | "database" | "database+env" | "env" | "emergency-kill";
};

type RuntimeSettingsRow = {
  workspace: string;
  v3_mode: string;
  compliance_mode: string;
  autonomy_level: number;
  durable_workflows_mode: string;
  version: number;
  updated_by: string;
  updated_at: Date;
};

const defaults: OutboundRuntimeConfig = {
  v3Mode: "off",
  complianceMode: "off",
  autonomyLevel: 2,
  durableWorkflowsMode: "off",
};

const runtimeCache = new Map<string,{expiresAt:number;value:ResolvedOutboundRuntimeConfig}>();
const RUNTIME_CACHE_MS = 5_000;

export function invalidateOutboundRuntimeConfigCache(workspace?:string){
  if(workspace)runtimeCache.delete(workspace);
  else runtimeCache.clear();
}

function envOverrides(): Partial<OutboundRuntimeConfig> {
  const overrides: Partial<OutboundRuntimeConfig> = {};
  if (process.env.OUTBOUND_OS_V3_MODE) {
    overrides.v3Mode = modeSchema.parse(process.env.OUTBOUND_OS_V3_MODE);
  }
  if (process.env.OUTBOUND_COMPLIANCE_MODE) {
    overrides.complianceMode = complianceModeSchema.parse(process.env.OUTBOUND_COMPLIANCE_MODE);
  }
  if (process.env.OUTBOUND_AUTONOMY_LEVEL) {
    overrides.autonomyLevel = parseAutonomyLevel(process.env.OUTBOUND_AUTONOMY_LEVEL);
  }
  if (process.env.OUTBOUND_DURABLE_WORKFLOWS_MODE) {
    overrides.durableWorkflowsMode = modeSchema.parse(process.env.OUTBOUND_DURABLE_WORKFLOWS_MODE);
  }
  return overrides;
}

/**
 * Synchronous fail-safe configuration for code paths that cannot touch the DB.
 * Explicit environment values override the safe defaults.
 */
export function getOutboundRuntimeConfig(): OutboundRuntimeConfig {
  if (process.env.OUTBOUND_EMERGENCY_KILL_SWITCH === "true") {
    return { v3Mode:"off", complianceMode:"off", autonomyLevel:0, durableWorkflowsMode:"off" };
  }
  return { ...defaults, ...envOverrides() };
}

/**
 * Canonical runtime resolver.
 *
 * Database control is used when available so operations can move off -> shadow without
 * a redeploy. Explicit environment values have higher priority and can pin a mode.
 * OUTBOUND_EMERGENCY_KILL_SWITCH=true always wins and fails closed.
 */
export async function resolveOutboundRuntimeConfig(
  workspace = "default",
): Promise<ResolvedOutboundRuntimeConfig> {
  if (process.env.OUTBOUND_EMERGENCY_KILL_SWITCH === "true") {
    return {
      workspace,
      v3Mode:"off",
      complianceMode:"off",
      autonomyLevel:0,
      durableWorkflowsMode:"off",
      version:null,
      updatedBy:null,
      updatedAt:null,
      source:"emergency-kill",
    };
  }

  const cached=runtimeCache.get(workspace);
  if(cached&&cached.expiresAt>Date.now())return cached.value;

  let row: RuntimeSettingsRow | undefined;
  try {
    [row] = await query<RuntimeSettingsRow>(
      `select workspace,v3_mode,compliance_mode,autonomy_level,durable_workflows_mode,version,updated_by,updated_at
       from outbound_runtime_settings
       where workspace=$1
       limit 1`,
      [workspace],
    );
  } catch {
    // During deploy-order transitions the control-plane table may not exist yet.
    // Failing closed to defaults keeps the working legacy engine canonical.
  }

  const dbConfig: OutboundRuntimeConfig = row
    ? {
        v3Mode: modeSchema.parse(row.v3_mode),
        complianceMode: complianceModeSchema.parse(row.compliance_mode),
        autonomyLevel: parseAutonomyLevel(row.autonomy_level),
        durableWorkflowsMode: modeSchema.parse(row.durable_workflows_mode),
      }
    : defaults;

  const overrides = envOverrides();
  const hasOverrides = Object.keys(overrides).length > 0;
  const resolved = { ...dbConfig, ...overrides };

  const value:ResolvedOutboundRuntimeConfig={
    workspace,
    ...resolved,
    version: row?.version ?? null,
    updatedBy: row?.updated_by ?? null,
    updatedAt: row?.updated_at ?? null,
    source: row ? (hasOverrides ? "database+env" : "database") : (hasOverrides ? "env" : "defaults"),
  };
  runtimeCache.set(workspace,{expiresAt:Date.now()+RUNTIME_CACHE_MS,value});
  return value;
}
