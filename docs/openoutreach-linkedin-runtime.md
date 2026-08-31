# OpenOutreach + LinkedIn runtime

This document defines the external worker boundary used by the Digitale Gewinner Pflege Sales OS.

The Next.js/Vercel application is the CRM and orchestration layer. Browser sessions and long-running lead-generation processes must run outside Vercel on a persistent Linux/Docker host.

## Why two workers

The current upstream `eracle/OpenOutreach` is a browserless lead finder/qualifier. It accepts a product description + campaign target, discovers candidates through BetterContact Lead Finder, qualifies them with an LLM/GP loop, and exports qualified rows as CSV or JSON Lines. Current upstream deliberately does not send or automate LinkedIn.

Older OpenOutreach code and the maintained LinkedIn-capable fork `Tanishq2319/openoutreach` still contain the Playwright LinkedIn browser/session, connection-request, pending-check and agentic follow-up pipeline. That implementation depends on `linkedin-agent-cli`.

For Digitale Gewinner we therefore keep the boundary explicit:

1. **OpenOutreach lead worker** — finds and qualifies additional decision-makers.
2. **LinkedIn browser worker** — owns the persistent LinkedIn browser/session and executes paced LinkedIn actions.
3. **Digitale Gewinner Sales OS** — owns CRM truth, A+/A/B ranking and the daily 120/100/30/30 queues.

Do not vendor either GPL worker into the Next.js application. Keep them as separately deployed services.

## Daily targets

- Calls: 120
- Emails: 100
- Personalized videos: 30 top leads
- LinkedIn: 30 top leads

The expensive channels are intentionally limited to the strongest leads.

## OpenOutreach upstream configuration

Current upstream supports headless setup through environment variables:

```env
OPENOUTREACH_PRODUCT_DESCRIPTION=Digitale Gewinner baut conversion-starke Website-, Recruiting- und Bewerber-Systeme für ambulante Pflegedienste in Deutschland.
OPENOUTREACH_CAMPAIGN_TARGET=Geschäftsführer, Inhaber und Pflegedienstleitungen ambulanter Pflegedienste in Deutschland. Pflegeheime, Kliniken und Tagespflege ausschließen. Recruiting-Druck, offene Pflege-Stellen oder schwacher digitaler Auftritt priorisieren.
OPENOUTREACH_CAMPAIGN_NAME=Digitale Gewinner Pflege
OPENOUTREACH_AI_MODEL=openai:gpt-5
OPENOUTREACH_LLM_API_KEY=...
OPENOUTREACH_BETTERCONTACT_API_KEY=...
OPENOUTREACH_OPERATOR_EMAIL=...
OPENOUTREACH_COUNTRY=DE
OPENOUTREACH_ACCEPT_LEGAL_NOTICE=true
OPENOUTREACH_NEWSLETTER=false
```

Verified upstream commands:

```bash
pip install openoutreach
openoutreach init
openoutreach find 50 --json
openoutreach status --json
```

`openoutreach find ... --json` emits JSON Lines containing the fields the Sales OS bridge expects, including `first_name`, `last_name`, `company`, `title`, `website`, `linkedin_url`, `reason`, `lead_id` and (when requested/resolved) `email`.

## HTTP adapter expected by the Sales OS

`lib/openoutreach-bridge.ts` expects a small HTTP wrapper around the OpenOutreach CLI.

### `POST /v1/find`

Request:

```json
{
  "count": 50,
  "emails": false,
  "productDescription": "...",
  "campaignObjective": "...",
  "output": "json"
}
```

Response:

```json
{
  "leads": [
    {
      "lead_id": "provider-id",
      "first_name": "Max",
      "last_name": "Mustermann",
      "company": "Pflegedienst Beispiel GmbH",
      "title": "Geschäftsführer",
      "website": "https://example.de",
      "linkedin_url": "https://www.linkedin.com/in/...",
      "email": "",
      "reason": "Warum dieser Entscheider zum Pflege-ICP passt",
      "city": "Berlin"
    }
  ]
}
```

The adapter should execute the fixed Pflege campaign. `productDescription` and `campaignObjective` are sent for observability/validation; the persistent OpenOutreach campaign remains the source of truth after initialization.

A thin implementation can shell out to:

```bash
openoutreach find "$COUNT" --json
```

then parse one JSON object per stdout line. Keep the OpenOutreach data directory on a persistent volume so the campaign model/qualification history survives restarts.

## LinkedIn worker contract

The Sales OS sends only leads that already have a LinkedIn URL and have survived the CRM ranking.

### `POST /v1/actions`

Request:

```json
{
  "mode": "queue",
  "actions": [
    {
      "taskId": "sales-task-id",
      "leadId": "sales-lead-id",
      "profileUrl": "https://www.linkedin.com/in/example",
      "message": "Personalized first-touch copy"
    }
  ]
}
```

Expected response:

```json
{
  "ok": true,
  "accepted": 1
}
```

`queue` is the production default. `send` is only enabled when `LINKEDIN_AGENT_AUTO_SEND=true` is explicitly configured in the Sales OS.

The LinkedIn worker must:

- run on a persistent host, never inside a Vercel function;
- own the LinkedIn cookies/browser profile and never return them to the Sales OS;
- deduplicate by `taskId`;
- enforce its own conservative daily/weekly action limits;
- check existing connection state before trying to connect;
- handle pending connections before messaging;
- record success/failure per task;
- stop/pause when LinkedIn presents a security checkpoint or rate limit;
- expose logs/health without exposing session secrets.

The LinkedIn-capable OpenOutreach code already demonstrates these primitives: persistent `AccountSession`, connection-state checking, connection requests, daily action limits, pending handling, and agentic follow-up cooldowns. Use that service/codebase as the browser worker rather than reimplementing browser interaction inside Next.js.

## Sales OS environment variables

```env
OPENOUTREACH_WORKER_URL=https://openoutreach-worker.example.com
OPENOUTREACH_WORKER_SECRET=...
LINKEDIN_AGENT_WORKER_URL=https://linkedin-worker.example.com
LINKEDIN_AGENT_WORKER_SECRET=...
LINKEDIN_AGENT_AUTO_SEND=false
```

The two worker secrets are independent bearer tokens.

## Runtime flow

```text
Existing Pflege discovery + jobs + website audit
                  │
                  ├──────────────┐
                  │              │
                  ▼              ▼
          Sales OS CRM     OpenOutreach worker
                  ▲              │
                  └──── qualified people + linkedin_url
                  │
                  ▼
          A+/A/B ranking
                  │
        ┌─────────┼─────────┬─────────┐
        ▼         ▼         ▼         ▼
      Calls      Email     Video    LinkedIn
       120        100       30         30
                                      │
                                      ▼
                             LinkedIn browser worker
```

After every lead-factory cron cycle the Sales OS rebuilds the channel queues. OpenOutreach sync also rebuilds them immediately after new people are imported.

## Upstream references

- Current lead-finder upstream: https://github.com/eracle/OpenOutreach
- LinkedIn-capable OpenOutreach lineage/fork: https://github.com/Tanishq2319/openoutreach

The current upstream and the LinkedIn-capable lineage have materially different behavior. Pin worker versions instead of blindly tracking `latest` in production.
