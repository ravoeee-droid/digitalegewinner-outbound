# ADR 006 — Compliance Engine and Permission Evidence

Status: Accepted / M4
Date: 2026-09-27

## Context

The outbound system already had a conservative permission evaluator at the final send boundary, but no complete operator workflow for collecting evidence, reviewing a basis, handling opt-outs and auditing decisions.

At the start of M4 the CRM contained hundreds of leads but no verified outbound email permission records. The system therefore must not infer permission from the mere existence of a public business email address.

## Decision

Compliance becomes a first-class operational subsystem with four layers:

1. **Evidence + human review**
   - AI or operators may collect evidence.
   - Evidence creates a pending review, not permission.
   - A human approval is required before a permission becomes `verified`.
   - The approval is evaluated against the current product policy before it can be stored.

2. **Unified suppression ledger**
   - opt-out, bounce, complaint, legal and manual do-not-contact signals are persisted in `outbound_compliance_suppressions`;
   - legacy `er_suppressions` remains mirrored during migration;
   - suppression overrides permission.

3. **Two send gates**
   - campaign launch performs a permission preflight;
   - the send worker evaluates permission again immediately before provider submission;
   - enforcement is fail-closed.

4. **Reply-driven opt-out**
   - only explicit deterministic phrases are auto-suppressed at L2;
   - quoted reply history is stripped before matching;
   - ambiguous replies are not auto-suppressed by the deterministic matcher;
   - an explicit opt-out stops queued sequence steps, marks the CRM lead do-not-contact and revokes active email permissions.

## Germany / email product policy

The current product policy is intentionally conservative.

For promotional email in Germany, the engine only accepts a verified record using one of the bases explicitly allowed by the configured policy, such as:
- explicit consent;
- inbound request;
- existing-customer exception;
- contractual necessity.

A generic public email address or an AI inference is not treated as permission.

For other jurisdictions/channels, the same fail-closed mechanism applies until an explicit policy allows the basis.

This is a product-control policy, not legal advice.

## Review evidence

Every approved permission retains:
- subject (contact/company);
- channel;
- jurisdiction;
- requested basis;
- source;
- evidence payload;
- reviewer;
- review reason;
- policy version;
- evidence hash;
- timestamps.

A newer permission supersedes the prior active permission while preserving historical rows.

## Enforcement activation

`compliance_mode=enforce` is only available after M4 capability is present.

Activation is blocked if already queued/sending messages would fail the current permission evaluator. This avoids silently flipping a live queue into a mass-blocked state.

Once enforcement is enabled, future campaign launches skip disallowed leads and the final send worker remains the non-bypassable last gate.

## AI autonomy

At L2 the agent may:
- observe permission state;
- create safety suppressions from explicit opt-out signals;
- stop sequences;
- prepare evidence/review proposals.

It may not:
- invent consent;
- change a legal basis;
- approve its own permission review;
- answer legal complaints autonomously.

## Migration

M4 is additive:
- no legacy CRM table is removed;
- legacy suppression remains mirrored;
- current campaign sender stays intact;
- shadow mode remains available as rollback.
