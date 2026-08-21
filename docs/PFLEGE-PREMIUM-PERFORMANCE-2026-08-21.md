# Pflege Sales OS · Premium + Performance Pass

## Visual direction

- dark precision sidebar instead of generic light SaaS navigation
- glass-like top bar with high-density controls
- compact typography and spacing with stronger hierarchy
- refined borders, micro-shadows, hover states and motion
- premium lead inspector with restrained depth
- high-density tables remain the primary working surface
- responsive mobile treatment without oversized cards

## Performance changes

- removed complete PflegeProOS remount after every automatic research batch
- automatic research waits for browser idle time
- automatic background research does not call OpenAI; the website/contact/audit fallback brief remains available
- background research runs one lead at a time with pauses
- added `/api/crm/research-queue` to fetch only missing lead IDs instead of loading the full CRM payload before every lead
- the full `/api/crm/launch` response is no longer repeatedly fetched by the background worker
- large scrolling lists/cards use content-visibility/contain-intrinsic-size where safe
- overscroll containment reduces accidental whole-page scroll work

## Manual enrichment

Manual `Enrich` / `Refresh Research` keeps the full AI-enabled path. Background enrichment is intentionally lighter so sales work remains responsive while the backlog fills.
