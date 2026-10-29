# Evolution API → DG Outbound (DG-MAIN), phase 1: inbound-only pilot

## Status
- Experimental, **not deployed**. Enabled only with EVOLUTION_INBOUND_ENABLED=1.
- No auto replies, sending, CRM stage changes, AI processing, calendar booking, or cold outreach.
- This is **NOT** official WhatsApp Business App Coexistence. QR/Baileys may risk account restrictions and must not be attached to the user's production +49 number without separate explicit risk approval.
- DG-MAIN only. Do not use any other customer instance's secrets, DB, accounts, or phone numbers.

## Implementation
`POST /api/integrations/evolution/webhook`: accepts the Evolution API event envelopes `messages.upsert` and `messages.set` for a configured exact instance. Ingests only individual `@s.whatsapp.net` messages; ignores group/broadcast/channel and unsupported event types. Dedupe keyed by workspace/instance/event/message id, stores plaintext (max 16k) and a phone number in `dg_wa_inbound_events`, with a 100-item/1 MB batch limit. Unknown events acknowledge/ignore. **Do not load private chats into this DB** without policy/retention/access reviews.

`GET /api/integrations/evolution/webhook`: admin-only pilot status, no raw content exposure.

### Required Vercel secrets (never commit actual values)
- `EVOLUTION_INBOUND_ENABLED=0` (default; explicitly switch to 1 after approval)
- `EVOLUTION_INSTANCE_NAME=dg-whatsapp-test`
- `EVOLUTION_WEBHOOK_SECRET=<random>=32-byte-secret`

In Evolution API use a custom webhook header `x-dg-evolution-secret: <same secret>` with base URL `https://<DG-HOST>/api/integrations/evolution/webhook`, and enable `MESSAGES_UPSERT`, optionally `MESSAGES_SET`. Note Evolution event spellings/transports may vary by version; confirm exact installed version payloads with a **test number** before enabling. Do not put secret in query parameters or a public URL.

### Security & scope before testing
1. Operator approves a **test number**, NOT existing +49 business number. Host Evolution on a persistent container with encrypted storage and restricted public access. Never host its persistent WhatsApp session on Vercel's ephemeral functions.
2. Test handler only after deployment to non-production preview, configured secret and sample payloads. Current implementation stores event bodies; complete retention policy, access restrictions, auditability, suppressions and erasure/export handling before live real personal data.
3. Configure 30-day example retention at deployment level *only after* a lawful retention decision; no default deletion is implemented yet.
4. If all tests pass, add controlled CRM contact matching, historical sync pagination, review-only AI suggestions, Google Calendar OAuth/bookings, human handoff and compliance gates as subsequent PRs.
5. For official production Coexistence use Meta Cloud API path when app/partner is approved; Evolution supports Cloud API transport but that alone does **not** grant official Coexistence or history-sync permissions.

### Tests to run (not yet executed)
- disabled -> 503; missing/wrong header -> 401; wrong instance -> 403
- message.upsert 1:1 -> insert 1, repeated event -> 0
- messages.set batch up to 100; group jid -> 0
- unsupported events -> ignored; oversized body -> 413
- GET without admin -> 401
- ensure no existing email, PV-WhatsApp or cron workers change

**Shared-core note**: This is a DG-only, dedicated integration endpoint and private inbound staging table; existing shared CRM/UI are unchanged. Any future shared inbox or CRM changes require peer code inspection and parity per AGENTS.md.
