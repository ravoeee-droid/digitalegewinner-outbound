import { query } from "@/lib/db";
import { outboundEventSchema, type OutboundEventInput } from "@/lib/outbound-contracts";
import { getOutboundRuntimeConfig } from "@/lib/outbound-runtime-config";

type EventRow = {
  id: string;
  occurred_at: Date;
};

export async function recordOutboundEvent(input: OutboundEventInput) {
  const event = outboundEventSchema.parse(input);
  const rows = await query<EventRow>(
    `
    insert into outbound_events(
      workspace,
      event_type,
      actor_type,
      actor_id,
      company_id,
      contact_id,
      lead_id,
      campaign_version_id,
      experiment_id,
      experiment_arm_key,
      message_id,
      correlation_id,
      causation_id,
      idempotency_key,
      occurred_at,
      payload
    )
    values(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb
    )
    on conflict (workspace, idempotency_key)
      where idempotency_key is not null
    do nothing
    returning id,occurred_at
    `,
    [
      event.workspace,
      event.type,
      event.actorType,
      event.actorId ?? null,
      event.companyId ?? null,
      event.contactId ?? null,
      event.leadId ?? null,
      event.campaignVersionId ?? null,
      event.experimentId ?? null,
      event.experimentArmKey ?? null,
      event.messageId ?? null,
      event.correlationId ?? null,
      event.causationId ?? null,
      event.idempotencyKey ?? null,
      event.occurredAt,
      JSON.stringify(event.payload),
    ],
  );

  if (rows[0]) return { inserted: true, id: rows[0].id, occurredAt: rows[0].occurred_at };

  if (!event.idempotencyKey) {
    throw new Error("Outbound event insert returned no row without an idempotency key.");
  }

  const existing = await query<EventRow>(
    `select id,occurred_at
       from outbound_events
       where workspace=$1 and idempotency_key=$2
       limit 1`,
    [event.workspace, event.idempotencyKey],
  );

  return {
    inserted: false,
    id: existing[0]?.id ?? null,
    occurredAt: existing[0]?.occurred_at ?? event.occurredAt,
  };
}


export async function recordOutboundEventByMode(input: OutboundEventInput) {
  const { v3Mode } = getOutboundRuntimeConfig();
  if (v3Mode === "off") {
    return { mode: v3Mode, skipped: true as const };
  }

  try {
    const result = await recordOutboundEvent(input);
    return { mode: v3Mode, skipped: false as const, ...result };
  } catch (error) {
    if (v3Mode === "active") throw error;
    const message = error instanceof Error ? error.message : "Unknown V3 event ledger error";
    console.error("[outbound-v3-shadow] event write failed", message);
    return { mode: v3Mode, skipped: false as const, inserted: false, error: message };
  }
}
