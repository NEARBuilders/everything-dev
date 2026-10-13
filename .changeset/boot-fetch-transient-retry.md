---
"everything-dev": patch
---

Boot resilience for the CDN-only image (ADR 0021 amendment follow-up): the boot-time fetch interceptor retries transient failures on idempotent GETs — network errors and 429/5xx responses retry twice (250ms, 750ms backoff) before propagating, so a single edge/registry hiccup no longer hard-fails the host or a plugin during the cold-boot load window, which now has no staged fallback. Non-transient statuses and non-GET requests pass through untouched; the stale-if-error cache still sees the final failure.
