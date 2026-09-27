import { z } from "zod";
import type { AutonomyLevel } from "@/lib/outbound-contracts";

const modeSchema = z.enum(["off", "shadow", "active"]);

function parseAutonomyLevel(value: string | undefined): AutonomyLevel {
  const parsed = Number(value ?? "2");
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 5) {
    throw new Error("OUTBOUND_AUTONOMY_LEVEL must be an integer from 0 to 5.");
  }
  return parsed as AutonomyLevel;
}

export type OutboundRuntimeConfig = {
  v3Mode: z.infer<typeof modeSchema>;
  complianceMode: "off" | "shadow" | "enforce";
  autonomyLevel: AutonomyLevel;
  durableWorkflowsMode: z.infer<typeof modeSchema>;
};

export function getOutboundRuntimeConfig(): OutboundRuntimeConfig {
  const complianceRaw = process.env.OUTBOUND_COMPLIANCE_MODE ?? "off";
  const complianceMode = z.enum(["off", "shadow", "enforce"]).parse(complianceRaw);

  return {
    v3Mode: modeSchema.parse(process.env.OUTBOUND_OS_V3_MODE ?? "off"),
    complianceMode,
    autonomyLevel: parseAutonomyLevel(process.env.OUTBOUND_AUTONOMY_LEVEL),
    durableWorkflowsMode: modeSchema.parse(process.env.OUTBOUND_DURABLE_WORKFLOWS_MODE ?? "off"),
  };
}
