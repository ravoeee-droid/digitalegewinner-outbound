# ADR 007 — Conversation Intelligence

Status: Accepted / M5
Date: 2026-09-27

## Context

The outbound system already stops a sequence on any reply and M4 handles explicit opt-outs. What was missing was a durable conversation model that can understand reply intent, prioritize the human inbox and prepare the next response without making uncontrolled external decisions.

Inline LLM calls inside the mailbox sync would make reply ingestion slow and fragile. A model outage must never prevent a reply from being recorded.

## Decision

M5 uses a two-stage architecture:

1. **Fast ingestion**
   - inbound and outbound messages are persisted in conversation threads;
   - inbound replies are marked pending for classification;
   - the mailbox worker does not wait for an LLM;
   - explicit deterministic opt-outs remain M4 safety events and bypass AI judgment.

2. **Asynchronous intelligence**
   - a dedicated worker claims pending inbound messages with leases and retries;
   - classification is persisted independently of the mailbox sync;
   - if an OpenAI API key is configured, the worker uses structured model output;
   - without a key, deterministic heuristics provide a fail-safe fallback;
   - after repeated classifier failures, the message becomes an urgent human-review item instead of disappearing.

## Reply taxonomy

The current taxonomy is:

- positive
- meeting_intent
- needs_information
- objection_price
- objection_existing_solution
- objection_timing
- not_responsible
- referral
- not_interested
- already_filled
- out_of_office
- unsubscribe
- legal_complaint
- unknown

## Runtime modes

`conversation_mode` has three states:

- `off`: no classification worker;
- `shadow`: classify and record only;
- `assist`: classification plus internal human tasks, CRM next actions and draft replies.

There is deliberately no auto-send mode in M5.

## L2 autonomy boundary

At L2 the system may:

- classify a reply;
- store confidence and rationale;
- create a human escalation;
- prioritize positive/meeting replies;
- generate a draft that is explicitly not sent;
- update internal CRM next-action metadata.

At L2 it may not:

- send an external reply;
- answer a legal complaint;
- infer or change permission;
- automatically suppress based only on an AI guess;
- book a meeting without an explicit downstream human-approved action.

Only a deterministic M4 opt-out or a human-confirmed unsubscribe can create an unsubscribe suppression.

## Model safety

The classifier receives the current reply plus limited CRM/outbound context.

The prompt requires:
- structured output;
- no fabricated facts, pricing, guarantees or case studies;
- no legal conclusions;
- no consent/permission inference;
- no draft for legal complaints or unsubscribe;
- `unknown` when uncertain.

Low-confidence classifications are forced to `unknown`.

## Human inbox

Assist mode creates prioritized escalations.

- urgent: legal/ambiguous safety issues;
- high: positive/meeting intent and low-confidence unknown;
- normal: information requests, objections, referrals and close-loop cases;
- low: non-actionable/system replies.

Operators can reclassify and resolve items. Human reclassification becomes the current classification while preserving earlier model outputs.

## Durability

Conversation processing uses:

- persisted message state;
- bounded attempts;
- worker leases;
- `FOR UPDATE SKIP LOCKED`;
- idempotent provider-message indexes;
- dedicated scheduler transport.

The conversation worker runs independently of the legacy global scheduler.

## External-message safety

Successful outbound mail is mirrored to the conversation thread on a best-effort basis only after provider acceptance. A conversation-mirroring failure must never turn a successfully sent message into a retry.

## Future gate

Automatic safe replies remain locked behind a later autonomy/evaluation milestone. M5 produces the data and human-review loop required to evaluate that future capability safely.
