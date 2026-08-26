# Customer Instance Standard

Every customer gets a fully isolated production instance. Shared code can be copied/ported, but customer data, secrets and infrastructure are never shared.

## Naming standard

For a customer slug `<customer>` use:

- Instance ID: `CLIENT-<CUSTOMER>`
- GitHub repo: `client-<customer>-outbound` or an existing dedicated customer repo
- Vercel project: `client-<customer>-outbound`
- Supabase project: `client-<customer>-outbound`
- Production data: customer instance only
- Secrets/API keys/mailboxes: customer instance only

## Required files in every instance

Each customer repository must contain:

1. `AGENTS.md` with hard isolation rules and the exact GitHub/Vercel/Supabase IDs.
2. `INSTANCE.json` with the machine-readable instance identity.
3. Explicit forbidden cross-instance references for DG-MAIN and other customer environments.

## Deployment guardrail

Before any infrastructure change:

1. Read `INSTANCE.json`.
2. Verify the active GitHub repository matches `github`.
3. Verify the Vercel project ID matches `vercel.projectId`.
4. Verify the Supabase project ref matches `supabase.projectRef`.
5. If any target differs, stop. Never "guess" the intended environment.

## Data boundary

Never share across instances:

- leads or CRM records
- mailboxes / SMTP / IMAP passwords
- OAuth refresh tokens
- API keys and webhooks
- campaign state and analytics
- auth users
- tracking events
- production database connections

## Shared code policy

DG-MAIN can act as the reference implementation for reusable features, but a customer instance remains independently deployable. Port feature code deliberately and test it against the customer's own infrastructure. Do not make a customer runtime depend on the DG-MAIN production database or secrets.

## Current production instances

### DG-MAIN
- GitHub: `ravoeee-droid/digitalegewinner-outbound`
- Vercel: `prj_4dgtSJI6FeoUezuUW13PNCFACvyL`
- Supabase: `dessavbytgxyygeohjrn`

### CLIENT-WALKENHORST
- GitHub: `ravoeee-droid/walkenhorst`
- Vercel: `prj_x3nLVnqgVpKxJowHUjaN3iMswr9a`
- Supabase: `jiahshldcusphxtbqxpv`
