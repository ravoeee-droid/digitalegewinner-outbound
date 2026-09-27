# ADR 004 — AI autonomy is policy-bounded and evaluation-gated

Status: Accepted
Date: 2026-09-27

## Context

The value of an AI SDR is not maximum autonomy. Unbounded autonomy can amplify hallucinations, weak experiments, legal mistakes and deliverability damage.

## Decision

All agent actions are classified by risk and minimum autonomy level.

Levels:
- L0 observe;
- L1 recommend/draft;
- L2 safety actions;
- L3 allow-listed conversation actions;
- L4 experiment traffic optimization;
- L5 experiment generation/publishing under policy.

The initial production target is L2.

## Permanent human gates

The following never become self-authorizing merely because autonomy level is high:
- changing a legal/permission basis;
- sending a legal response;
- introducing or materially changing a sales claim without evidence/approval policy.

## Evaluation

Langfuse is the target AI tracing/evaluation layer in M8. Prompt/model versions must be regression-tested against stored examples for:
- factual accuracy;
- evidence grounding;
- claim accuracy;
- tone/conciseness;
- compliance;
- reply classification accuracy;
- hallucination rate.

Agent decisions are also persisted in Postgres so critical business history does not depend on a third-party observability service.
