---
"everything-dev": minor
---

Foreign-namespace bundle resilience for the child tier (ADR 0011 amendment): the host's `/bundles/*` route falls through to a proxy + stale-if-error disk cache for namespaces mapped from the runtime config's slot URLs — a base-origin outage now degrades to serving last-known-good bytes (`x-bundle-cache: stale`) instead of a hard 502. The CLI fetch adapter gains the same cache for boot-time outbound fetches (one cache root, two entrances, `BOS_BUNDLE_CACHE_DIR`, default `.bos/bundle-cache` — deliberately separate from `BOS_BUNDLE_DIR`: cached bytes are a resilience artifact, never a deployment). Never enabled for plain dev sessions; cached bytes serve only when the origin fails, so normal operation keeps serving fresh.
