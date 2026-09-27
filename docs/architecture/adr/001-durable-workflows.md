# ADR 001 — Durable workflow orchestration

Status: Accepted / implemented in shadow
Date: 2026-09-27

## Context

The production system already has a reliable server-side scheduler: Supabase `pg_cron` invokes protected Vercel workers through `pg_net`. Send and reply workers run independently of browser sessions and survive application deploys.

What was missing was not a timer. It was a first-class durable state machine for:
- long waits;
- retries and recovery;
- idempotency;
- step-level leases;
- human approvals/signals;
- sequence cancellation on reply/bounce;
- audit-friendly workflow history;
- deterministic migration away from legacy `er_outbox`.

## Decision

Use a **Postgres-first durable workflow layer** as the M2 orchestration boundary.

The canonical durable state lives in:

- `outbound_workflow_runs`
- `outbound_workflow_steps`
- `outbound_workflow_signals`

Supabase `pg_cron` invokes the protected `/api/cron/workflows` worker through the existing `dg_private.invoke_worker(...)` transport.

Vercel remains the application/worker host. Postgres remains the business-state and workflow-state source of truth.

Trigger.dev is no longer required for the first durable execution milestone. It remains an optional future adapter for workloads that genuinely benefit from an external workflow runtime.

## Shadow migration

During shadow mode:

1. legacy `er_outbox` remains the only real send executor;
2. each legacy lead/campaign sequence is mirrored into a durable workflow run;
3. each legacy outbox row is mirrored into a durable workflow step;
4. reply/bounce events are persisted as workflow signals;
5. the workflow worker acquires leases, observes legacy state, applies signals and recovers expired leases;
6. no workflow step produces an external send side effect.

This allows parity, lock recovery and signal handling to be measured before cutover.

## Lease model

Workers claim work with `FOR UPDATE SKIP LOCKED` and short leases.

A crash does not strand work indefinitely:
- expired step leases are recovered;
- expired signal leases are recovered;
- retries are bounded by persisted attempt counters;
- idempotency keys prevent duplicate workflow/run/signal creation.

## Cutover gate

Native workflow execution remains technically locked until all of the following are true:

- sequence mirror parity is stable;
- no unexplained failed/blocked shadow steps;
- reply/bounce stop behavior matches legacy;
- expired-lease recovery has been exercised;
- duplicate-worker concurrency has been tested;
- compliance enforcement is independently ready;
- rollback to legacy has been rehearsed.

## Consequences

- waits and retries survive deploys/restarts;
- workflow history is queryable in the same database as campaign and revenue data;
- no new SaaS dependency or secret surface is required for M2;
- existing pg_cron infrastructure is reused;
- external workflow engines can still be added later behind an adapter without moving canonical state.

## Guardrail

The workflow layer orchestrates actions but does not become the canonical store for campaign definitions, permission evidence, experiment truth or revenue. Those remain in their dedicated Postgres entities.
