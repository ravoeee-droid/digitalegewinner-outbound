# ADR 011 — Revenue Attribution

Status: Accepted / M9
Date: 2026-09-27

## Decision
Revenue learning is based on conversion facts, not vanity metrics.

Supported facts:
- meeting booked;
- meeting held;
- opportunity created;
- won/lost;
- revenue.

Facts may originate from immutable outbound events, the operational CRM, calendar/CRM connectors or explicit manual records. A conversion is attributed to the latest observed company exposure before the conversion within a 180-day window. If no valid exposure exists, the fact remains unattributed.

Future campaign launches always create an immutable campaign version, including campaigns without experiments, so attribution can identify the exact sent version.

For won CRM opportunities, setup value plus twelve months of monthly value may be stored as `booked_12m_contract_value`. It is explicitly not represented as cash collected.

The primary optimization surface is revenue per 100 exposed companies.
