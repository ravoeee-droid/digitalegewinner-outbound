# DG Outbound OS — Golden Architecture V1

Status: **Implemented through M10 / Production target L2**
Instance: **DG-MAIN**
Date: 2026-09-27

## Product objective

DG Outbound OS is not a bulk-email sender. It is a revenue-learning system that connects:

`company signal -> permission -> experiment -> message -> reply -> meeting -> opportunity -> revenue -> learning`.

The optimization target is **won revenue per 100 eligible companies**. Reply rate, positive reply rate and meeting rate are leading indicators, not the final goal.

## Non-negotiable principles

1. **Evidence before personalization.** Every company-specific claim must be traceable to a source, observation time and confidence level.
2. **Permission before send.** A campaign enrollment is not permission to contact. Channel permission is evaluated independently.
3. **Immutable live campaign versions.** Editing a live campaign creates a new version.
4. **Company-level experiment assignment.** Contacts from the same company must not be split across competing strategic variants.
5. **Stable sequence assignment.** Once assigned to an experiment arm, a lead/company stays on that arm for the sequence.
6. **Revenue attribution over vanity metrics.** Opens/clicks are optional diagnostics. Replies, positive replies, meetings, opportunities and revenue are primary.
7. **AI cannot self-authorize.** AI may recommend an action but cannot override hard compliance, suppression or deliverability gates.
8. **Safety actions can be more autonomous than persuasion actions.** Bounce suppression and broken-mailbox pausing can run automatically; changing sales claims or legal basis cannot.
9. **Append-only decision history.** Important AI, experiment, compliance and deliverability decisions must be reconstructable.
10. **No hidden mutation of experiments.** Copy, audience or primary metric changes require a new version.

## Target architecture

```
Next.js / React UI
        |
        v
Application API
        |
        +---------------------+
        |                     |
        v                     v
Supabase/Postgres       Durable Workflow Layer
(source of truth)       (Postgres + pg_cron/pg_net)
        |                     |
        |                     +--> send/reply/health/research jobs
        |
        +--> Event Ledger
        +--> Campaign Versions
        +--> Experiments
        +--> Permissions
        +--> Agent Decisions
        +--> Health Snapshots
        |
        v
Provider adapters
Netcup SMTP/IMAP | Gmail API | Microsoft Graph
```

Langfuse is the target observability/evaluation layer for AI runs. Product analytics may use PostHog later, but experiment truth remains in Postgres.

## Canonical lifecycle

### Company / contact

`discovered -> researched -> qualified -> permission_checked -> eligible`

### Campaign version

`draft -> review -> approved -> running -> paused -> completed -> archived`

Published/running versions are immutable.

### Enrollment

`eligible -> assigned -> scheduled -> active -> replied|suppressed|completed|stopped`

### Message

`planned -> queued -> sending -> provider_accepted -> delivered/unknown -> replied|bounced|complained`

SMTP acceptance is not equivalent to inbox placement.

### AI decision

`proposed -> policy_checked -> approved/rejected -> executed -> evaluated`

## Source-of-truth rules

- `sales_companies`, `sales_contacts`, `sales_leads`, `sales_opportunities` remain the operational CRM source during migration.
- Legacy `er_*` tables continue to run until cutover.
- New `outbound_*` tables are additive and become the canonical decision/experiment/event layer.
- No destructive migration is allowed in M0/M1.
- Dual-write may be introduced only after the new tables are deployed and verified.

## Event taxonomy

Core immutable events include:

`permission_verified`
`permission_denied`
`campaign_version_published`
`experiment_assigned`
`send_planned`
`send_attempted`
`provider_accepted`
`send_deferred`
`send_failed`
`bounce`
`complaint`
`reply_received`
`reply_classified`
`positive_reply`
`unsubscribe`
`meeting_booked`
`meeting_held`
`opportunity_created`
`won`
`lost`
`revenue_recorded`
`mailbox_degraded`
`mailbox_paused`
`domain_degraded`
`agent_decision_proposed`
`agent_decision_executed`

Each event must include:
- workspace
- actor type
- entity references
- event type
- occurred_at
- payload
- idempotency key when externally sourced
- causation/correlation identifiers when available

## Experiment standard

Every experiment defines before launch:
- hypothesis
- primary metric
- guardrail metrics
- target population
- randomization unit
- arms
- minimum sample per arm
- minimum detectable effect or practical effect threshold
- stop policy
- version

Default randomization unit is **company**, not contact.

AI is forbidden from declaring a winner based only on raw percentages. Data-quality checks and minimum sample constraints run before recommendation.

## AI autonomy levels

**L0 Observe** — measure only.

**L1 Copilot** — recommendations and drafts only.

**L2 Safety Autopilot** — may suppress hard bounces/unsubscribes, stop follow-ups on reply and reduce/pause unhealthy senders.

**L3 Conversation Autopilot** — may handle explicitly allow-listed low-risk reply classes.

**L4 Optimization Autopilot** — may change traffic allocation only inside an approved experiment policy.

**L5 Autonomous GTM** — may propose and launch new experiments only when all approval, compliance, evaluation and budget policies are satisfied.

Initial production target is **L2**.

## Hard gates

No outbound message may be sent when any hard gate fails:

1. global suppression
2. contact/company do-not-contact
3. channel permission policy
4. campaign version not approved/running
5. mailbox disabled/degraded beyond threshold
6. domain degraded beyond threshold
7. sender daily/provider capacity exhausted
8. sequence already stopped by reply/meeting policy
9. message quality/evidence validation failed
10. campaign experiment integrity failed

## Deliverability posture

- Plain-text first for cold/relationship outreach.
- Open tracking is disabled by default.
- Link tracking is disabled by default.
- Volumes ramp gradually; no sudden scaling.
- Mailbox and domain health are separate concepts.
- Bounce/complaint/deferral trends can reduce capacity automatically.
- DNS authentication state is monitored, but authentication alone does not prove inbox placement.

## Compliance posture

The platform stores permission evidence instead of inferring permission from a public email address.

Permission records are channel- and jurisdiction-specific and include:
- basis
- source
- evidence
- verified_by
- verified_at
- valid_from / valid_until
- revoked_at

For Germany, cold promotional email defaults to **not sendable** unless an approved permission basis has been recorded. This is a conservative product rule; legal review can change policy versions without changing historic evidence.

## Migration plan

### M0 — Architecture Freeze
This document + ADRs + typed contracts.

### M1 — Data/Event Foundation
Add `outbound_*` tables, indexes and RLS. No destructive changes.

### M2 — Durable Execution
Persist runs, steps, waits, retries, leases and signals in Postgres. The protected workflow worker is scheduled through the existing Supabase pg_cron/pg_net transport. Legacy execution remains canonical until shadow parity and recovery gates pass.

### M3 — Deliverability Control Tower
Continuously score domain/mailbox health from authentication, connectivity and delivery events. Run in shadow first, then enforce adaptive daily capacity, L2 sender pauses and two-snapshot recovery at the final send boundary.

### M4 — Compliance Engine
Human-reviewed permission evidence, immutable review trail, unified suppressions, explicit opt-out detection, launch preflight and a final fail-closed send gate. AI may gather evidence and propose reviews but cannot invent or upgrade a legal/permission basis.

### M5 — Conversation Intelligence
Persist conversation threads/messages, classify replies asynchronously with deterministic fallback, prioritize high-intent and risky replies, generate human-review drafts, and route escalations. L2 may classify, draft and create internal tasks but cannot send an automatic external reply.

### M6 — Experiment Engine
Version legacy A/B/n sequences into durable company-level experiments, persist deterministic assignments, count only provider-accepted first exposures, evaluate primary/guardrail metrics with SRM and multiplicity controls, auto-pause only for safety/validity failures, and require human approval for any performance-driven traffic change.

### M7 — Research + Strategy Agents
Evidence-first public-page research with SSRF protection, source/time/confidence/hash persistence, bounded workers, deterministic fallback and human-approved strategy hypotheses.

### M8 — Copy + AI Evals
Versioned prompts, evidence-mapped claims, critic gates, seeded regression datasets and append-only eval runs. Unsupported guarantees, percentages, timelines, price/result claims and fake personalization fail closed for AI-generated copy.

### M9 — Revenue Attribution
Immutable campaign versions for all future launches plus meetings, opportunities, wins/losses and revenue attributed to the latest valid pre-conversion company exposure. Unmatched facts remain unattributed.

### M10 — Optimization Autopilot
Policy-gated traffic and experiment proposals. L2 recommends only. L4 traffic execution requires a human-approved active policy, evidence signal, clean guardrails, sample minimums, cooldown and bounded shifts. L5 may create draft experiments but never bypass permission/compliance/send gates.

## Definition of done for M0

M0 is complete only when:
- architecture is documented
- event names and entity references are typed
- compliance decision contract exists
- AI autonomy levels and action classes are typed
- campaign-version and experiment contracts exist
- DB migration is additive/reviewable
- preview build passes
- production remains unchanged


## Implementation state — 2026-09-27

- M0–M6: implemented.
- M7 Research + Strategy: implemented with public-URL evidence controls and deterministic fallback.
- M8 Copy + AI Evals: implemented with prompt/dataset versioning and critic regression gates.
- M9 Revenue Attribution: implemented with 180-day pre-conversion last-company-exposure attribution.
- M10 Optimization: implemented behind explicit policy/autonomy gates.
- Current production autonomy target remains L2.
- L3 external conversation auto-replies remain disabled.
- L4 traffic allocation and L5 experiment-draft execution remain non-executable until the required autonomy level and human-approved policy are explicitly enabled.
- OPENAI_API_KEY is optional; without it, deterministic fallbacks remain active.
