# Morning Readiness Standard — Pflege Outbound

Goal: At 08:00 Asia/Bangkok the operator opens the system and works. No lead research, sorting or debugging should be required before the first call.

## Hard gates

The morning is GREEN only when all mandatory gates pass:

- Call queue: >= 120 current Pflege 1A leads with a usable phone number.
- Lead pool: >= 160 current leads when supply allows; first 120 are the call list, the rest are buffer.
- Dedupe: one company per daily lead key; CRM do-not-contact/contacted state is preserved.
- Evidence: every 1A lead originates from current Pflege hiring signals and passes excluded-company filters.
- CRM sync: the current daily cards have been synchronized into sales companies, contacts and active opportunities.
- Email: target 100 personalized drafts; never lower quality merely to hit the number. If fewer than 100 pass strict eligibility, surface the exact deficit as YELLOW rather than filling with weak contacts.
- LinkedIn: only queue leads with a real LinkedIn URL. Never manufacture a target count by inserting unresolved profiles.
- Deployment: GitHub main and Vercel production are checked independently from the data pipeline. A frontend deploy issue must not stop creation of the daily call list.

## Pre-08:00 pipeline (Asia/Bangkok)

Supabase is the primary data pipeline. Schedules are stored in UTC and intentionally begin on the previous UTC date while Europe/Berlin is already on the target business date.

- 06:00 — `dg-pflege-daily-base`: generate/cache the 160-lead pool and 120 1A call list.
- 06:20 — `dg-pflege-daily-augment`: enrich the daily pool.
- 06:40 — `dg-pflege-daily-site-phone`: website/phone enrichment.
- from 06:00 — `dg-pflege-email-outreach`: incrementally build the strict personalized email queue every five minutes.
- 07:00 — `dg-pflege-daily-crm-sync`: sync daily leads into the Sales OS without overwriting CRM history.
- 07:15 — base retry.
- 07:25 — augment retry.
- 07:35 — site/phone retry.
- 07:45 — final CRM sync.
- 07:50 — Vercel backup cron calls `/api/cron/lead-factory` and rebuilds channel queues when the current production deployment contains the unified outbound engine.
- 08:00 — ChatGPT Morning Readiness check reports actual counts and blockers.

## Operator order

1. Calls first: work rank 1 → 120. Each card must already contain phone, company, trigger/reason and pitch context.
2. Follow-ups/callbacks take priority over net-new leads when a due next action exists.
3. Email drafts are reviewed/sent from the prepared queue; never research addresses manually during call blocks.
4. Video queue is reserved for the strongest website opportunities with enough source material.
5. LinkedIn queue is used only for resolved profiles; worker/runtime problems are reported separately and must not block calling.

## Fail-safe behavior

- Never silently substitute B/C leads for missing 1A leads.
- Never mark the morning GREEN because a target constant says 120; count actual current rows.
- Never reset do-not-contact, last-contact, callbacks, owner, notes or CRM history during daily sync.
- If a source or worker fails, retry through the independent retry schedule and surface the remaining deficit at 08:00.
- If Vercel is unavailable, the Supabase daily list remains the source of truth for calls and email preparation.

## Current source of truth

- Daily call pool: `public.pflege_daily_leads`
- Generation status: `public.pflege_daily_runs`
- Email drafts: `public.pflege_email_outreach`
- Email runtime control: `public.pflege_email_runtime_control`
- CRM: `public.sales_companies`, `public.sales_contacts`, `public.sales_leads`
- Unified channel queue after production rollout: `public.sales_outbound_tasks`
