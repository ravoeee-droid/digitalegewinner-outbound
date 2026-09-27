import { z } from "zod";

export const outboundEventTypes = [
  "permission_verified",
  "permission_denied",
  "permission_revoked",
  "campaign_version_published",
  "campaign_version_paused",
  "experiment_assigned",
  "send_planned",
  "send_attempted",
  "provider_accepted",
  "send_deferred",
  "bounce",
  "complaint",
  "reply_received",
  "reply_classified",
  "positive_reply",
  "unsubscribe",
  "meeting_booked",
  "meeting_held",
  "opportunity_created",
  "won",
  "lost",
  "revenue_recorded",
  "mailbox_degraded",
  "mailbox_paused",
  "domain_degraded",
  "agent_decision_proposed",
  "agent_decision_executed",
] as const;

export const outboundEventTypeSchema = z.enum(outboundEventTypes);
export type OutboundEventType = z.infer<typeof outboundEventTypeSchema>;

export const outboundActorTypes = ["system", "human", "agent", "provider", "workflow"] as const;
export const outboundActorTypeSchema = z.enum(outboundActorTypes);
export type OutboundActorType = z.infer<typeof outboundActorTypeSchema>;

export const channelSchema = z.enum(["email", "phone", "whatsapp", "linkedin", "sms", "other"]);
export type OutboundChannel = z.infer<typeof channelSchema>;

export const permissionBasisSchema = z.enum([
  "explicit_consent",
  "existing_customer_exception",
  "human_verified_business_expectation",
  "inbound_request",
  "contractual_necessity",
  "unknown",
  "denied",
]);
export type PermissionBasis = z.infer<typeof permissionBasisSchema>;

export const permissionStatusSchema = z.enum(["verified", "unverified", "denied", "revoked", "expired"]);
export type PermissionStatus = z.infer<typeof permissionStatusSchema>;

export const permissionRecordSchema = z.object({
  id: z.string().uuid().optional(),
  workspace: z.string().min(1).default("default"),
  companyId: z.string().min(1).optional().nullable(),
  contactId: z.string().min(1).optional().nullable(),
  channel: channelSchema,
  jurisdiction: z.string().min(2).max(32),
  basis: permissionBasisSchema,
  status: permissionStatusSchema,
  policyVersion: z.string().min(1),
  source: z.string().min(1).optional().nullable(),
  evidence: z.record(z.string(), z.unknown()).default({}),
  verifiedBy: z.string().min(1).optional().nullable(),
  verifiedAt: z.coerce.date().optional().nullable(),
  validFrom: z.coerce.date().optional().nullable(),
  validUntil: z.coerce.date().optional().nullable(),
  revokedAt: z.coerce.date().optional().nullable(),
});
export type PermissionRecord = z.infer<typeof permissionRecordSchema>;

export const campaignVersionStatusSchema = z.enum([
  "draft",
  "review",
  "approved",
  "running",
  "paused",
  "completed",
  "archived",
]);
export type CampaignVersionStatus = z.infer<typeof campaignVersionStatusSchema>;

export const campaignStepSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().min(0),
  waitHours: z.number().int().min(0).max(24 * 90),
  channel: channelSchema,
  subject: z.string().max(500).default(""),
  body: z.string().min(1).max(50_000),
  stopOnReply: z.boolean().default(true),
});

export const campaignVersionSchema = z.object({
  id: z.string().uuid().optional(),
  workspace: z.string().min(1).default("default"),
  campaignKey: z.string().min(1).max(160),
  version: z.number().int().positive(),
  status: campaignVersionStatusSchema,
  name: z.string().min(1).max(240),
  audienceDefinition: z.record(z.string(), z.unknown()).default({}),
  offerDefinition: z.record(z.string(), z.unknown()).default({}),
  steps: z.array(campaignStepSchema).min(1),
  createdBy: z.string().min(1),
  approvedBy: z.string().min(1).optional().nullable(),
  approvedAt: z.coerce.date().optional().nullable(),
  publishedAt: z.coerce.date().optional().nullable(),
  contentHash: z.string().min(8).optional(),
}).superRefine((value, ctx) => {
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const [index, step] of value.steps.entries()) {
    if (ids.has(step.id)) {
      ctx.addIssue({ code: "custom", path: ["steps", index, "id"], message: "Step IDs must be unique." });
    }
    if (orders.has(step.order)) {
      ctx.addIssue({ code: "custom", path: ["steps", index, "order"], message: "Step order values must be unique." });
    }
    ids.add(step.id);
    orders.add(step.order);
  }
});
export type CampaignVersion = z.infer<typeof campaignVersionSchema>;

export const experimentMetricSchema = z.enum([
  "reply_rate",
  "positive_reply_rate",
  "qualified_meeting_rate",
  "meeting_held_rate",
  "opportunity_rate",
  "won_rate",
  "revenue_per_100_companies",
  "bounce_rate",
  "complaint_rate",
  "unsubscribe_rate",
]);
export type ExperimentMetric = z.infer<typeof experimentMetricSchema>;

export const randomizationUnitSchema = z.enum(["company", "contact", "lead"]);
export type RandomizationUnit = z.infer<typeof randomizationUnitSchema>;

export const experimentArmSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
  weight: z.number().positive().max(1),
  strategy: z.record(z.string(), z.unknown()).default({}),
});

export const experimentSpecSchema = z.object({
  id: z.string().uuid().optional(),
  workspace: z.string().min(1).default("default"),
  campaignVersionId: z.string().uuid(),
  experimentKey: z.string().min(1).max(160),
  version: z.number().int().positive(),
  hypothesis: z.string().min(10).max(4000),
  primaryMetric: experimentMetricSchema,
  guardrailMetrics: z.array(experimentMetricSchema).default(["bounce_rate", "complaint_rate", "unsubscribe_rate"]),
  randomizationUnit: randomizationUnitSchema.default("company"),
  targetPopulation: z.record(z.string(), z.unknown()).default({}),
  minimumSamplePerArm: z.number().int().min(10).max(1_000_000).default(50),
  practicalEffectThreshold: z.number().min(0).max(1).default(0.01),
  arms: z.array(experimentArmSchema).min(2).max(8),
  stopPolicy: z.record(z.string(), z.unknown()).default({}),
}).superRefine((value, ctx) => {
  const keys = new Set<string>();
  let totalWeight = 0;
  for (const [index, arm] of value.arms.entries()) {
    if (keys.has(arm.key)) {
      ctx.addIssue({ code: "custom", path: ["arms", index, "key"], message: "Experiment arm keys must be unique." });
    }
    keys.add(arm.key);
    totalWeight += arm.weight;
  }
  if (Math.abs(totalWeight - 1) > 0.000001) {
    ctx.addIssue({ code: "custom", path: ["arms"], message: "Experiment arm weights must sum to 1." });
  }
  if (value.guardrailMetrics.includes(value.primaryMetric)) {
    ctx.addIssue({ code: "custom", path: ["guardrailMetrics"], message: "Primary metric must not be duplicated as a guardrail metric." });
  }
});
export type ExperimentSpec = z.infer<typeof experimentSpecSchema>;

export const replyClassSchema = z.enum([
  "positive",
  "meeting_intent",
  "needs_information",
  "objection_price",
  "objection_existing_solution",
  "objection_timing",
  "not_responsible",
  "referral",
  "not_interested",
  "already_filled",
  "out_of_office",
  "unsubscribe",
  "legal_complaint",
  "unknown",
]);
export type ReplyClass = z.infer<typeof replyClassSchema>;

export const autonomyLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type AutonomyLevel = z.infer<typeof autonomyLevelSchema>;

export const agentActionClassSchema = z.enum([
  "observe",
  "draft",
  "suppress",
  "stop_sequence",
  "reduce_sender_capacity",
  "pause_sender",
  "classify_reply",
  "send_safe_reply",
  "allocate_experiment_traffic",
  "publish_experiment",
  "change_claim",
  "change_permission_basis",
  "legal_response",
]);
export type AgentActionClass = z.infer<typeof agentActionClassSchema>;

export const outboundEventSchema = z.object({
  id: z.string().uuid().optional(),
  workspace: z.string().min(1).default("default"),
  type: outboundEventTypeSchema,
  actorType: outboundActorTypeSchema,
  actorId: z.string().min(1).optional().nullable(),
  companyId: z.string().min(1).optional().nullable(),
  contactId: z.string().min(1).optional().nullable(),
  leadId: z.string().min(1).optional().nullable(),
  campaignVersionId: z.string().uuid().optional().nullable(),
  experimentId: z.string().uuid().optional().nullable(),
  experimentArmKey: z.string().min(1).optional().nullable(),
  messageId: z.string().min(1).optional().nullable(),
  correlationId: z.string().min(1).optional().nullable(),
  causationId: z.string().min(1).optional().nullable(),
  idempotencyKey: z.string().min(1).optional().nullable(),
  occurredAt: z.coerce.date().default(() => new Date()),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type OutboundEvent = z.infer<typeof outboundEventSchema>;

export const evidenceItemSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  source: z.string().min(1),
  sourceUrl: z.string().url().optional().nullable(),
  observedAt: z.coerce.date(),
  confidence: z.number().min(0).max(1),
});
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const agentDecisionSchema = z.object({
  id: z.string().uuid().optional(),
  workspace: z.string().min(1).default("default"),
  agentKey: z.string().min(1).max(120),
  actionClass: agentActionClassSchema,
  autonomyLevel: autonomyLevelSchema,
  subjectType: z.string().min(1).max(80),
  subjectId: z.string().min(1),
  recommendation: z.record(z.string(), z.unknown()).default({}),
  evidence: z.array(evidenceItemSchema).default([]),
  confidence: z.number().min(0).max(1),
  policyVersion: z.string().min(1),
  requiresApproval: z.boolean(),
});
export type AgentDecision = z.infer<typeof agentDecisionSchema>;
