# ADR 012 — Optimization Autopilot

Status: Accepted / M10
Date: 2026-09-27

## Decision
Optimization is policy-gated and separates recommendation from execution.

At the current L2 production target, the optimization worker may:
- inspect M6 evaluations;
- create traffic-allocation proposals;
- create new-experiment draft proposals from approved M7/M8 assets;
- write auditable decisions.

It may not change traffic.

Traffic execution requires:
- human-approved and active optimization policy;
- L4 autonomy;
- evidence-signal evaluation;
- clean SRM/guardrails;
- minimum exposure per arm;
- cooldown;
- bounded weight shift;
- minimum retained control traffic.

Existing assignments never move arms. Weight changes affect only future assignments.

New experiment draft execution requires L5. Even at L5, the implementation creates a draft campaign version rather than bypassing permission, audience, compliance or send gates.

The default conservative policy is seeded as DRAFT, never auto-approved or auto-activated.
