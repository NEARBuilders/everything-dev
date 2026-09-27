# Discovery pilot runbook

## Readiness and participation

Use 5–10 opted-in communities. A fixture is not a recruited pilot participant. Record the responsible node editor and verify permission to publish the profile and official links. Confirm an approximate city/regional center, a useful summary, an official channel, and at least one real event or attributed post. Online-only communities can remain list-only. Check external destinations, timezone and cancellation information. Never seed invented activity into production.

Manual events and [Luma imports](./luma-events.md) are both supported. Select a Luma calendar once per node; public events publish and update automatically. Check the connection status before campaigns.

Curation/moderation must be ready before launch. Review the map-provider decision, deployment cost ceiling and hosting policy. Confirm an administrator can handle reports and revoke curator access. Separately authorize deployment and participant outreach.

## Measurement rules

Anonymous measurement is enabled by default, with no in-app toggle. The map works when collection is blocked by the browser or unavailable. Respect Do Not Track. Use a random tab-session visit ID with a 30-minute lifetime, not a user identity. A new campaign starts a new visit. Send no email, wallet, IP, raw referrer or arbitrary URL as analytics dimensions.

Within a visit, count each kind/node/target combination once; count one visit and one activation regardless of repeated outbound actions. Campaign attribution is fixed at the visit start. Count node opens, event outbound clicks, official-channel clicks and share actions separately. Social-original-post clicks do not count as official-channel activation. Exclude authenticated platform admins, organization owners/admins and granted growth curators. These are aggregate interaction signals, not attendance, social follows or unique people. Client-originated signals can be fabricated; do not use them for rewards or financial decisions.

The studio reports a rolling 28 days. Retain at most 28 days of detailed measurement rows, purging older rows on ingestion. Browser Do Not Track suppresses collection. There is no persistent measurement preference. Report-form anti-duplicate tokens are separate from measurement visit IDs and last only for the tab session. A database-serialized budget allows at most 20 reports per content target per hour regardless of token rotation; the host also applies its general request limit.

## Four-week procedure

1. Week one: establish a baseline for visits, node opens, outbound actions, active visits and attention across nodes. Record content coverage and known collection gaps; set improvement targets after observing the baseline.
2. Weeks two and three: review freshness weekly, ask responsible editors to correct stale details, curate clearly labeled expiring campaigns, and compare node engagement without conflating clicks with attendance.
3. Week four: review useful outbound engagement, distribution of attention, moderation effort and editorial workload. Decide whether to expand, adjust or pause the pilot.

## Validation before expansion

Run API integration tests for eligibility, node-scoped editing, curator permissions, cancellation, date boundaries, reporting and aggregate access. Run the browser journey against a real API and map renderer; deterministic tile fixtures isolate network reliability. Inspect desktop/mobile rendering and a real basemap separately. Exercise same-location pins, shared links, keyboard selection and failed map assets.

Measure a 10-node pilot dataset and a larger synthetic dataset. Record machine/environment, node counts, read latency and map/list readiness. Synthetic fixture performance is evidence for that dataset, not a production SLA. Investigate measured bottlenecks before selecting rollout limits. The full list is currently bounded by network dataset size rather than viewport pagination, so expansion needs explicit performance review.

## Recorded local baseline

Measured 2026-09-16 on the development workspace with PGlite, Chromium and Vite. Synthetic nodes were split between two coincident geographic locations, exercising 100-node clusters at the larger size.

| Nodes | API discovery read | Browser list + marker readiness |
| --- | --- | --- |
| 10 | 4 ms | 986 ms |
| 200 | 10 ms | 1,007 ms |

Browser timings use the map-failure fallback with actual Leaflet markers, isolating tile network variability. A separate successful visual check loaded real OSM tiles and inspected desktop/mobile screenshots. The larger cluster test exposed an oversized popup; constraining its scroll height made all entries selectable. These are single local samples, not percentile measurements or production capacity estimates.
