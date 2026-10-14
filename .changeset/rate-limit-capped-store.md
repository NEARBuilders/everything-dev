---
"host": patch
---

Bound the rate limiter's memory (#338): the hono-rate-limiter store now caps entries (`RATE_LIMIT_STORE_MAX_ENTRIES`, default 10 000) — under pressure it drops expired windows first, then evicts the oldest-inserted keys. Combined with the last-hop `x-forwarded-for` keying, a rotating-header client can no longer force unbounded key growth toward the memory ceiling. Window semantics unchanged.
