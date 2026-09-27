# ADR 010 — Copy + AI Evals

Status: Accepted / M8
Date: 2026-09-27

## Decision
AI-generated outbound copy is versioned by prompt and must pass a non-bypassable critic before human approval.

The critic enforces:
- concise plain-text email;
- no unresolved placeholders or tracking parameters;
- no excessive spam formatting;
- structured evidence mapping for company-specific facts;
- no unsupported guarantees, ROI, result timelines, percentages, numeric price/result claims or superlatives.

Prompt versions and regression datasets are stored in Postgres. A seeded regression suite contains known-safe and known-unsafe examples. Eval runs are append-only and retain case-level results.

Only an approved M7 strategy can create a production copy candidate. Only critic-passed copy can become human-approved. Model availability is optional; deterministic fallback copy remains available.
