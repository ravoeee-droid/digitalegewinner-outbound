# DG Outbound OS V3 — Zero-Downtime Migration Plan

Status: Approved migration strategy
Date: 2026-09-27

## Goal

Move from the legacy `er_*` campaign/outbox model to the Outbound OS V3 event/version/experiment model without interrupting the working Netcup mailboxes or existing CRM.

## Rule

There is no big-bang cutover.

Every phase must have:
1. an explicit source of truth;
2. measurable parity criteria;
3. a rollback path;
4. no destructive schema change.

## Phase A — Foundation

Deploy additive `outbound_*` tables only.

Acceptance:
- migration applies cleanly;
- no existing table, row or cron is changed;
- existing send/reply tests still pass;
- RLS prevents client access.

Rollback:
- application ignores the new tables.

## Phase B — Shadow events

Legacy production remains canonical.

The application duplicates selected lifecycle events into `outbound_events` in shadow mode:
- experiment assignment;
- send attempt/provider acceptance;
- reply;
- bounce;
- unsubscribe;
- meeting/opportunity/revenue when available.

Acceptance:
- >= 99.5% event parity for deterministic events;
- no duplicate external sends;
- idempotency keys prevent duplicate provider events.

Rollback:
- disable shadow write flag.

## Phase C — Versioned campaigns

New campaigns are authored as immutable V3 versions while the existing worker can still render/send them through an adapter.

Acceptance:
- version hash is stable;
- published copy cannot be mutated;
- company-level arm assignment is stable across all sequence steps;
- legacy campaigns remain readable.

Rollback:
- launch new campaigns through legacy campaign state only.

## Phase D — Compliance shadow evaluation

Permission policy runs in report-only mode first.

Acceptance:
- every planned send receives a policy decision;
- policy decisions can be audited;
- false blocks/allowances are reviewed before enforcement.

Rollback:
- return mode to shadow.

## Phase E — Enforced send gate

Compliance, suppression, campaign status and sender health become hard prerequisites for V3 sends.

Acceptance:
- no send can bypass a hard gate through another route;
- manual test matrix covers allowed/blocked cases.

Rollback:
- pause V3 launches; legacy sender remains available only for previously approved migration-safe traffic.

## Phase F — Durable workflow shadow

Trigger.dev target workflows mirror scheduling state without owning sends.

Acceptance:
- wait/retry timing parity;
- sequence-stop parity;
- mailbox concurrency parity;
- human approval suspend/resume verified.

## Phase G — Durable workflow cutover

Workflow engine becomes orchestration source; Postgres remains business-state source.

Legacy Vercel cron sender remains disabled-but-runnable rollback infrastructure for a defined stabilization window.

## Phase H — Legacy retirement

Only after:
- V3 has run through full lead -> send -> reply -> meeting -> opportunity -> revenue path;
- at least one real experiment has valid data;
- event ledger parity is stable;
- recovery drill has succeeded.

Then legacy tables may be marked deprecated. Dropping them requires a separate migration and explicit review.

## Migration flags

Target flags:

```
OUTBOUND_OS_V3_MODE=off|shadow|active
OUTBOUND_COMPLIANCE_MODE=off|shadow|enforce
OUTBOUND_AUTONOMY_LEVEL=0..5
OUTBOUND_DURABLE_WORKFLOWS_MODE=off|shadow|active
```

Defaults during first production deployment:

```
OUTBOUND_OS_V3_MODE=shadow
OUTBOUND_COMPLIANCE_MODE=shadow
OUTBOUND_AUTONOMY_LEVEL=2
OUTBOUND_DURABLE_WORKFLOWS_MODE=off
```

## Production promotion checklist

- preview build READY;
- typecheck/lint/build pass;
- additive migration reviewed;
- DB backup/restore path verified;
- mailbox send test passes for all active mailboxes;
- reverse inbound test passes;
- shadow-write counts match legacy counts;
- no compliance hard enforcement until permission data is populated;
- no AI persuasion action above configured autonomy level;
- rollback flag documented and tested.
