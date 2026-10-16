# DG-MAIN → Cloudflare D1

Target account: `a8f679cc3531e121c635b5da28c7cba6`
Target database: `93c76e96-3c5f-4cf4-905f-73fbfddef85c`
Name: `digitalegewinner-outbound`; jurisdiction: EU.

User requested a fresh database and explicitly declined importing Neon data.
The D1 API token is stored only as a Production Secret on Vercel project
`prj_4dgtSJI6FeoUezuUW13PNCFACvyL`. No secret values belong in this checkout.

## Prepared

- Native, parameterized D1 REST transport with credential-safe errors and deadlines.
- Native D1 state and ciphertext-vault repositories.
- Idempotent SQLite core schema for state, secrets, outbox, suppressions, events and sent mail.
- Core schema applied remotely; all six tables verified through Cloudflare's SQL console.
- SQLite integration tests for state, versioning, isolation, vault updates, injection, error handling and schema.

The mailbox vault, workspace-state operations, sent-mail history and warmup now
select native D1 when its configuration is present. Incomplete D1 configuration
fails explicitly for these operations instead of falling back to PostgreSQL.
The raw-SQL CRM and campaign engines still use PostgreSQL and are not migrated.

Validation: all 12 native SQLite/transport and mailbox integration tests pass;
project TypeScript check and production build pass. Lint passes for every changed code file.
Whole-project lint currently fails on 23 existing errors in unchanged files.

Release is pending the user's explicit main-branch/live-publication confirmation.
Automatic approval review rejected the first direct-main commit/push attempt;
that rejected command made no commit and did not push or deploy any change.
Netcup login reached its emailed security-token step and requires user completion.

## Still required before switching production

- Port `lib/db.ts` callers and PostgreSQL-specific CRM/campaign/runtime queries to SQLite.
- Preserve authorization, send claims, suppression checks and idempotency during the port.
- Verify mailbox/vault/state operations on the production deployment.
- Recover or re-enter and verify the ten Netcup credentials; none are in the current Vercel environment.
- Test login, CRM, state persistence, mailbox IMAP/SMTP and campaign scheduling before release.

Do not advertise full CRM/campaign readiness while these items remain open.
