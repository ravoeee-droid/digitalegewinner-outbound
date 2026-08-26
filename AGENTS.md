# Instance Boundary — DG-MAIN

This repository is the dedicated production instance for **Digitale Gewinner**.

## Canonical identity

- Instance ID: `DG-MAIN`
- Company: `Digitale Gewinner`
- GitHub: `ravoeee-droid/digitalegewinner-outbound`
- Vercel project: `digitalegewinner-outbound`
- Vercel project ID: `prj_4dgtSJI6FeoUezuUW13PNCFACvyL`
- Supabase project: `digitalegewinner-outbound`
- Supabase project ref: `dessavbytgxyygeohjrn`

## Hard isolation rules

1. Never read from, write to, deploy to, or reuse credentials from a customer instance while working in this repository.
2. Digitale Gewinner mailboxes, leads, campaigns, tracking data, integrations, secrets and auth belong only to this instance.
3. Before any Vercel or Supabase operation, verify that the target IDs match the canonical identity above.
4. Do not point this frontend/backend at another customer's Supabase project.
5. Shared improvements may be ported as code to customer instances, but production customer data and secrets must never be copied into this repository.

## Explicitly forbidden cross-instance targets

- `ravoeee-droid/walkenhorst`
- Vercel project `walkenhorst`
- Vercel project ID `prj_x3nLVnqgVpKxJowHUjaN3iMswr9a`
- Supabase project `walkenhorst-energy-radar`
- Supabase ref `jiahshldcusphxtbqxpv`

When a task is ambiguous, do not assume it belongs to a customer instance. Keep changes in DG-MAIN unless the user explicitly names the customer.