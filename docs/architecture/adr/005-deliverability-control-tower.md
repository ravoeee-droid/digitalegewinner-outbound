# ADR 005 — Deliverability Control Tower

Status: Accepted / M3
Date: 2026-09-27

## Context

Authentication alone does not prove inbox placement. A production outbound system must continuously observe sender health and react before a mailbox or domain is damaged.

The existing system already has:
- Netcup SMTP/IMAP credentials;
- V3 lifecycle events;
- bounce capture;
- daily mailbox limits;
- a protected scheduler transport.

M3 adds a dedicated safety layer without replacing the current sender.

## Decision

Deliverability is a first-class runtime control with three modes:

- `off`: no health control;
- `shadow`: score and recommend capacity, never block sends;
- `enforce`: apply adaptive limits and hard pauses at the final send boundary.

The default is `shadow`.

## Health model

### Domain signals
- MX presence;
- SPF presence;
- DKIM selector presence;
- DMARC presence;
- PTR/reverse-DNS evidence for SMTP hosts;
- aggregate 7-day bounce, complaint, deferral and failure rates.

### Mailbox signals
- SMTP authentication/connectivity;
- IMAP connectivity or provider-token health;
- 7-day bounce, complaint, deferral and send-failure rates;
- domain health inherited as a lower bound.

## Capacity policy

The configured mailbox daily limit remains the absolute ceiling.

Recommended capacity:
- healthy: 100%;
- watch: 75%;
- degraded: 25%;
- paused: 0%.

In `shadow`, the recommendation is observable only.

In `enforce`, the send worker uses the lower of:
- configured daily limit;
- health-enforced daily limit.

A missing or older-than-3-hours mailbox health state fails closed in enforce mode.

## Rate policy

Rate signals only become strong automatic evidence after minimum sample thresholds.

Examples:
- bounce rate >= 2% with >=20 sends: degraded;
- bounce rate >= 5% with >=20 sends: paused;
- send failure rate >=10% with >=10 attempts: degraded;
- send failure rate >=20% with >=10 attempts: paused;
- deferral rate >=10% with >=10 attempts: watch;
- deferral rate >=20% with >=10 attempts: degraded.

Any complaint is treated as material. At sufficient volume, a complaint rate >=0.3% is critical.

## Recovery

A degraded/paused sender does not instantly return to full capacity after one clean check.

Two consecutive healthy snapshots are required before full restoration. The first healthy snapshot after degradation remains in `watch` with reduced capacity.

## Safety

- Enforce requires L2 or higher safety autonomy.
- Enforce cannot be activated without fresh health state for every configured mailbox.
- Health checks never send external email.
- The health worker is independently scheduled and does not depend on the legacy global scheduler switch.
- The existing sender remains the only message executor until V3 native execution is separately approved.

## Scheduling

The protected `/api/cron/deliverability` worker is invoked hourly through a dedicated `pg_cron -> pg_net` function gated by `deliverability_mode`.

## External guidance

Threshold selection is intentionally conservative and should be reviewed against current provider guidance. Google currently recommends keeping user-reported spam rate below 0.1% and avoiding 0.3% or higher, while also requiring appropriate authentication and DNS hygiene for reliable delivery.
