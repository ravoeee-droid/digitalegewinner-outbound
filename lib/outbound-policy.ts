import type {
  AgentActionClass,
  AutonomyLevel,
  OutboundChannel,
  PermissionBasis,
  PermissionRecord,
} from "@/lib/outbound-contracts";

export type ComplianceContext = {
  jurisdiction: string;
  channel: OutboundChannel;
  permission?: PermissionRecord | null;
  suppressed?: boolean;
  doNotContact?: boolean;
  now?: Date;
};

export type ComplianceDecision = {
  allowed: boolean;
  reason:
    | "suppressed"
    | "do_not_contact"
    | "permission_missing"
    | "permission_not_verified"
    | "permission_expired"
    | "permission_revoked"
    | "basis_not_allowed"
    | "allowed";
  policyVersion: string;
};

export const COMPLIANCE_POLICY_VERSION = "dg-compliance-2026-09-27-v1";

const alwaysAcceptedBases = new Set<PermissionBasis>([
  "explicit_consent",
  "inbound_request",
  "contractual_necessity",
]);

function basisAllowed(jurisdiction: string, channel: OutboundChannel, basis: PermissionBasis) {
  if (alwaysAcceptedBases.has(basis)) return true;

  const country = jurisdiction.trim().toUpperCase();
  if (country === "DE" || country === "DE-DE" || country === "GERMANY") {
    if (channel === "email") return basis === "existing_customer_exception";
    if (channel === "phone") {
      return basis === "existing_customer_exception" || basis === "human_verified_business_expectation";
    }
    return basis === "existing_customer_exception";
  }

  // Unknown jurisdictions fail closed unless an explicit/inbound/contractual basis exists.
  return false;
}

export function evaluateCompliance(context: ComplianceContext): ComplianceDecision {
  if (context.suppressed) {
    return { allowed: false, reason: "suppressed", policyVersion: COMPLIANCE_POLICY_VERSION };
  }
  if (context.doNotContact) {
    return { allowed: false, reason: "do_not_contact", policyVersion: COMPLIANCE_POLICY_VERSION };
  }

  const permission = context.permission;
  if (!permission) {
    return { allowed: false, reason: "permission_missing", policyVersion: COMPLIANCE_POLICY_VERSION };
  }
  if (permission.status === "revoked") {
    return { allowed: false, reason: "permission_revoked", policyVersion: COMPLIANCE_POLICY_VERSION };
  }
  if (permission.status !== "verified") {
    return { allowed: false, reason: "permission_not_verified", policyVersion: COMPLIANCE_POLICY_VERSION };
  }

  const now = context.now ?? new Date();
  if (permission.validFrom && permission.validFrom > now) {
    return { allowed: false, reason: "permission_not_verified", policyVersion: COMPLIANCE_POLICY_VERSION };
  }
  if (permission.validUntil && permission.validUntil < now) {
    return { allowed: false, reason: "permission_expired", policyVersion: COMPLIANCE_POLICY_VERSION };
  }

  if (!basisAllowed(context.jurisdiction, context.channel, permission.basis)) {
    return { allowed: false, reason: "basis_not_allowed", policyVersion: COMPLIANCE_POLICY_VERSION };
  }

  return { allowed: true, reason: "allowed", policyVersion: COMPLIANCE_POLICY_VERSION };
}

const minimumAutonomyLevel: Record<AgentActionClass, AutonomyLevel> = {
  observe: 0,
  draft: 1,
  suppress: 2,
  stop_sequence: 2,
  reduce_sender_capacity: 2,
  pause_sender: 2,
  classify_reply: 2,
  send_safe_reply: 3,
  allocate_experiment_traffic: 4,
  publish_experiment: 5,
  change_claim: 5,
  change_permission_basis: 5,
  legal_response: 5,
};

const alwaysHumanApproval = new Set<AgentActionClass>([
  "change_claim",
  "change_permission_basis",
  "legal_response",
]);

export type AutonomyDecision = {
  executable: boolean;
  requiresApproval: boolean;
  minimumLevel: AutonomyLevel;
  reason: "level_too_low" | "human_approval_required" | "allowed";
};

export function evaluateAutonomy(
  currentLevel: AutonomyLevel,
  actionClass: AgentActionClass,
  approvalGranted = false,
): AutonomyDecision {
  const required = minimumAutonomyLevel[actionClass];
  if (currentLevel < required) {
    return {
      executable: false,
      requiresApproval: true,
      minimumLevel: required,
      reason: "level_too_low",
    };
  }

  if (alwaysHumanApproval.has(actionClass) && !approvalGranted) {
    return {
      executable: false,
      requiresApproval: true,
      minimumLevel: required,
      reason: "human_approval_required",
    };
  }

  return {
    executable: true,
    requiresApproval: alwaysHumanApproval.has(actionClass),
    minimumLevel: required,
    reason: "allowed",
  };
}
