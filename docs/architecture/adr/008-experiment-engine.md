# ADR 008 — Experiment Engine

Status: Accepted / M6
Date: 2026-09-27

## Context

The legacy campaign launcher already supported A/B/C content variants and deterministic hashing, but assignment was not durable in the V3 experiment model, exposure was conflated with assignment, and there was no statistical validity or safety layer.

A production experiment system must avoid three common errors:

1. counting assigned-but-never-sent contacts as exposed;
2. moving the same company between arms;
3. declaring a performance winner before sample, guardrail and randomization checks are satisfied.

## Decision

M6 bridges legacy sequence variants into the V3 experiment schema automatically.

### Versioning

When a campaign with variants launches:

- the full sequence definition is hashed;
- a matching immutable campaign version is reused;
- changed content creates a new campaign version;
- a corresponding experiment version is created;
- the first variant is the control arm;
- arms default to equal traffic weights.

No manual experiment registration is required for the existing campaign path.

### Randomization

The default randomization unit is company.

If a canonical company ID exists, it is the subject key. Otherwise a stable hash of the normalized company name is used.

Assignments are persisted in `outbound_experiment_assignments` and never re-randomized inside the same experiment version.

### Exposure

Assignment is not exposure.

An experimental unit is counted only after the provider accepts the first email for that unit. The first accepted message creates one durable `outbound_experiment_exposures` row.

Exposure writes are best-effort after provider acceptance so an analytics failure can never turn a successful email into a retry. The experiment worker periodically backfills missing exposures from sent `er_outbox` rows.

### Metrics

The supported primary/guardrail metrics remain those defined by the foundation contract:

- reply rate;
- positive reply rate;
- qualified meeting rate;
- meeting held rate;
- opportunity rate;
- won rate;
- revenue per 100 companies;
- bounce rate;
- complaint rate;
- unsubscribe rate.

Rate metrics are computed at the randomization-unit level, not message level.

### Statistical validity

M6 applies:

- minimum sample per arm;
- practical effect threshold;
- 95% Wilson intervals for rate display;
- two-proportion tests for control-vs-arm rate comparisons;
- Bonferroni adjustment across non-control comparisons;
- Pearson sample-ratio-mismatch checks using expected arm weights.

The SRM p-value implementation is an approximation suitable for an operational guardrail. It is not presented as an exact inferential test.

Revenue per 100 companies is descriptive until a variance-aware revenue model is introduced.

### Safety guardrails

Default safety guardrails watch:

- bounce rate;
- complaint rate;
- unsubscribe rate.

A non-control arm can trigger a safety review when it crosses configured absolute harm deltas or hard ceilings after the minimum guardrail sample.

SRM can also trigger a validity pause.

### L2 safety stop

A new action class, `pause_experiment_safety`, is allowed at L2.

A safety pause:

- marks the experiment paused;
- stops queued non-control experimental steps;
- detaches queued control steps from experiment tracking so the standard control sequence can continue;
- records an executed agent decision and audit event.

This action is only for safety/validity, not performance optimization.

### Performance optimization

Performance evidence never automatically becomes a winner.

When:

- minimum sample is reached;
- practical effect threshold is met;
- multiplicity-adjusted evidence supports an arm;
- safety guardrails are clean;

M6 creates a human-review recommendation.

Traffic reallocation remains `allocate_experiment_traffic`, which requires a higher autonomy level than the current L2 configuration. `optimizationAutopilot` remains locked.

### Scheduler

The evaluator runs every 15 minutes at minutes 7, 22, 37 and 52 through the existing Supabase `pg_cron -> pg_net` pattern.

### Human controls

Operators can:

- force an evaluation;
- pause;
- resume;
- complete an experiment.

The UI never exposes an automatic "declare winner" control.

## Future work

Later optimization milestones may add:

- variance-aware revenue models;
- sequential testing/e-values;
- contextual bandits;
- approved traffic reallocation.

Those capabilities must not weaken M6's exposure, safety or audit guarantees.
