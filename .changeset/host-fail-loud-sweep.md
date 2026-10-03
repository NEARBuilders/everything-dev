---
"host": patch
---

Host fail-loud sweep: the attestation catch and the auth 504 path log their underlying causes instead of dropping them; `AUTH_TIMEOUT_MS` rejects garbage (and `0`/negatives) with a clear boot error instead of silently defaulting to 30s; the two federation noop catches log at debug with the cause; the post-listen self-probe outcome is surfaced in `/health` (`ssr.selfProbe` — a failed probe degrades health), the unreachable `"composing"` acceptance is removed from the health check, and an empty auth origin in production fails boot loudly instead of masquerading as localhost:3000 (the development fallback stays — it is the pinned, deliberate one owned by `parseTrustedOrigins`).
