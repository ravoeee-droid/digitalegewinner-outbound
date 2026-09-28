# ADR 009 — Research + Strategy Agents

Status: Accepted / M7
Date: 2026-09-27

## Decision
Research is evidence-first. Public company pages from CRM-known URLs may be fetched, but private/localhost destinations are blocked and redirects are revalidated. Every usable observation is stored with source URL, observation time, confidence, excerpt and content hash.

Research agents may propose strategy hypotheses. A hypothesis is explicitly a testable strategy, not a factual claim. Company-specific claims must remain traceable to evidence. Human approval is required before a strategy can feed production copy.

The worker uses structured AI output when OPENAI_API_KEY exists; otherwise deterministic evidence rules remain available. No model may invent vacancy counts, urgency, costs, reach, ROI, guarantees or decision-maker facts.

## Scheduling
The protected research worker seeds a bounded queue and processes a few companies per run. It uses leases/retries and never depends on the legacy global scheduler switch.
