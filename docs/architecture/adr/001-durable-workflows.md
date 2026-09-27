# ADR 001 — Durable workflow orchestration

Status: Accepted target architecture
Date: 2026-09-27

## Context

The current production system uses protected Vercel cron endpoints for send and reply workers. This works for a small system but does not provide a first-class durable state machine for long waits, human approvals, retries, multi-step AI jobs, per-mailbox concurrency or audit-friendly workflow history.

## Decision

Adopt a durable workflow layer as the orchestration boundary in M2. Trigger.dev is the current implementation target. Vercel remains the application/UI host and Postgres remains the source of truth.

No production cron is removed until equivalent workflows have run in shadow mode and parity is proven.

## Consequences

- workflow state is no longer encoded only in scheduled timestamps and cron cadence;
- waits/retries become durable steps;
- mailbox/provider concurrency can be centralized;
- human approval can suspend/resume a workflow;
- deployment of the web app is decoupled from in-flight sales sequences;
- legacy cron remains a rollback path during migration.

## Guardrail

A workflow engine may orchestrate decisions, but it must not become the canonical store for campaign, permission, experiment or revenue state. Those remain in Postgres.
