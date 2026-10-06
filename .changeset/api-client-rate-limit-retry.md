---
"everything-dev": patch
---

The API client retries rate-limited (429) responses up to three times, honoring the server's `Retry-After` (capped at 2s) before failing — transient edge saturation self-heals in queries and the session check instead of surfacing errors.
