# ADR 003 — Channel permission is fail-closed

Status: Accepted product policy
Date: 2026-09-27

## Context

A discovered public business contact is not equivalent to permission for every outbound channel. Permission also depends on jurisdiction, channel, purpose and evidence.

## Decision

Permission becomes a first-class record in `outbound_contact_permissions`.

A send workflow evaluates permission independently from lead qualification and campaign enrollment.

Unknown or missing permission fails closed.

For Germany, the default product rule for promotional email is to require a verified basis explicitly supported by the configured policy. For B2B phone outreach, a separately verified business-expectation basis may be recorded by a human under the current policy.

## Evidence

Permission records retain:
- jurisdiction;
- channel;
- basis;
- status;
- source;
- evidence payload;
- verifier;
- timestamps;
- policy version.

AI cannot invent or upgrade a permission basis.

## Legal boundary

This is a conservative product-control policy, not a substitute for legal advice. Policy versions may change prospectively while historical evidence and decisions remain auditable.
