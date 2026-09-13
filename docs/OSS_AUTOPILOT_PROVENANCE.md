# DG Autopilot OSS provenance

This experiment intentionally uses upstream implementations instead of recreating their core behavior from scratch. The production `main` branch is untouched; all DG work lives on `feature/dg-autopilot-oss-stack` until explicitly approved.

## Firecrawl

- Upstream: `firecrawl/firecrawl`
- Component used: JavaScript SDK under `apps/js-sdk/firecrawl`
- Observed SDK version: `4.39.0`
- SDK license: MIT (`apps/js-sdk/firecrawl/LICENSE`)
- Source adapted directly:
  - `apps/js-sdk/firecrawl/src/v2/methods/scrape.ts` (observed blob `14a3577af3985a295dcfafbce0b8abc5a2f9c825`)
  - `apps/js-sdk/firecrawl/src/v2/methods/crawl.ts` (observed blob `7a46c5aadf71d4ec9e40030b0ddb0c6e972c83ee`)
- DG files:
  - `lib/oss/firecrawl-client.ts`
  - `app/api/autopilot/research/route.ts`
- Preserved upstream behavior includes `/v2/scrape`, `/v2/crawl`, crawl polling, payload field semantics, and bounded `processing_continues` resume behavior.

### Firecrawl SDK MIT notice

Copyright (c) 2024 Sideguide Technologies Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Stagehand

- Upstream: `browserbase/stagehand`
- SDK: `@browserbasehq/stagehand`
- Pinned version in experiment: `4.1.0`
- License: MIT
- Upstream v4 lifecycle used directly: `browserbase.launch()` -> `Stagehand.create()` -> browser page -> `stagehand.extract()` with Zod schema.
- DG files:
  - `services/stagehand-worker/package.json`
  - `services/stagehand-worker/server.mjs`
  - `lib/oss/stagehand-client.ts`
- Stagehand runs as a separate worker so browser-agent dependencies are not bundled into the main Next.js serverless app.

## Trigger.dev

- Upstream: `triggerdotdev/trigger.dev`
- Current observed SDK: `@trigger.dev/sdk` `4.5.16`
- SDK license: MIT; repository infrastructure contains Apache-2.0 components.
- Official API/client behavior used by DG: `POST /api/v1/tasks/{taskIdentifier}/trigger`, bearer auth, idempotency support, and the official core client's retry defaults (5 attempts, 1s minimum, 30s maximum, factor 1.6).
- DG file: `lib/oss/trigger-client.ts`
- No deprecated `client.defineJob` API is used.

## PostHog

- Upstream: `PostHog/posthog`
- DG uses the public capture protocol through `lib/oss/posthog-client.ts` rather than copying PostHog application source.
- Purpose: persist intent/conversion events for Autopilot experiments and later A/B comparisons.

## Inbox Zero — intentionally NOT copied

- Upstream: `elie222/inbox-zero`
- Current license observed: AGPLv3 plus additional commercial monetization and enterprise-use restrictions.
- Result: no Inbox Zero source code is copied into DG. Email follow-up concepts may be independently implemented later or connected through a separately licensed/API-compatible component.

## Twenty / other CRM projects

No Twenty CRM source has been copied in this branch. The current experiment keeps the established DG CRM and adds an intelligence layer instead of replacing it. Any future source adoption must pass a license review first.

## Safety / isolation

- Research accepts only public HTTP(S) targets and blocks local/private network destinations.
- No Walkenhorst production data, Supabase records, credentials, branding, or customer-specific logic is read or copied.
- Shared-core parity is performed only at source-code level on a separate peer branch.
- No Vercel deployment or production database migration is performed by this experiment.
