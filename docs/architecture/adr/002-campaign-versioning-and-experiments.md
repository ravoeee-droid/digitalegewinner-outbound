# ADR 002 — Immutable campaign versions and company-level experiments

Status: Accepted
Date: 2026-09-27

## Context

Editing live copy destroys attribution. Assigning different contacts from one company to competing sales strategies also creates contamination. Stable sequence-level attribution is required before AI optimization is safe.

## Decision

A live campaign is represented by an immutable `outbound_campaign_versions` row.

Any material change to audience, offer, sequence or copy creates a new version.

Experiments belong to a specific campaign version. The default randomization unit is the company. Assignment is persisted once and reused for the whole sequence.

## Experiment pre-registration

Every experiment records:
- hypothesis;
- primary metric;
- guardrail metrics;
- randomization unit;
- target population;
- arms and weights;
- minimum sample per arm;
- practical effect threshold;
- stop policy.

## Decision policy

Raw percentages never create an automatic winner. The evaluator must first verify:
- minimum sample;
- assignment/data integrity;
- no material guardrail violation;
- no sample-ratio anomaly;
- practical effect threshold.

Adaptive traffic allocation is deferred until fixed-split experiments are reliable at the actual DG volume.
