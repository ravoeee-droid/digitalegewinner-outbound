# DG Outbound — Apple HIG Design Pilot

## Goal
Improve the **internal DG Outbound cockpit** using the open-source *review approach* of [dickwu/apple-design-skill](https://github.com/dickwu/apple-design-skill), informed by Apple Human Interface Guidelines (HIG). Do **not** turn the product into an Apple clone. Preserve the DG brand and commercial workflows.

## Status
Design pilot only. This branch does **not** install the third-party skill, ship a new UI, or enable a production deployment.

## Agent setup
Before the design audit, review the upstream repository, license/permissions, and its latest `SKILL.md`. In a compatible coding agent, install the skill locally (not on production infrastructure):

```bash
npx skills add dickwu/apple-design-skill
```

Follow its design-review and improvement instructions. Do not blindly execute upstream scripts or commit third-party files before license and supply-chain review.

## Target screens (in order)
1. CRM pipeline — make Pflege/PV industry context prominent, show next action and decision-maker.
2. Lead detail — contact person, source, timeline, intent signals and actions in a legible hierarchy.
3. Inbox and signal feed — highlight meaningful video views, booked meetings, replies; de-emphasize noisy open events.
4. Analytics and cockpit overview — readable KPIs, actionable exceptions, clear date ranges.
5. Campaign management — strong guardrails for live outbound send controls.

## Design principles
- **Purpose and clarity:** one primary action per section, recognizable labels, avoid visual clutter.
- **DG identity:** preserve dark/black + neon orange branding. Do not copy Apple's trade dress, icons, imagery, or proprietary assets.
- **Accessibility:** keyboard navigation, visible focus, adequate contrast, reduced-motion support, text resizing, meaningful labels.
- **Responsive:** mobile-first layout for core CRM, avoid fixed pixel widths and clipped tables.
- **Feedback:** explicit loading, empty, success and error states. Confirm irreversible actions.
- **Performance:** keep the app lean; no animation-heavy libraries or translucent overlays without measurable benefit.
- **CRO & workflow:** optimize time to find hot leads and to take the next action, not aesthetics alone.

## Strict non-goals
- No edits to send workers, cron jobs, inbox/reply sync, campaign delivery, suppression or tracking.
- No database schema or migration changes.
- No changes to authentication, environment variables, secrets, API endpoints or billing.
- No automatic production merge or release.

## Implementation sequence
1. Inspect current pages/components and capture before screenshots at mobile and desktop widths.
2. Produce a prioritized, file-specific UI audit; identify HIG sources and DG workflow rationale.
3. Define small token changes (type scale, spacing, radii, colors, focus, interaction states).
4. Implement one isolated UI vertical slice on this branch (prefer CRM pipeline + lead details).
5. Validate `npm run typecheck`, `npm run lint`, `npm run build`, and relevant functional tests. Inspect before/after screens.
6. Compare task success speed and usability; request review before merging.

## Acceptance criteria
- Core flows and outbound behavior unchanged.
- No new console or hydration errors.
- Responsive at ~375px and desktop widths.
- Keyboard and reduced-motion behaviors validated.
- Lead actions remain explicit; industry and pipeline states cannot be confused.
- PR includes screenshots, test results, and list of touched paths.
