---
"everything-dev": minor
---

Atomic deploys watch hardening: the adopt transaction serializes through a semaphore (concurrent adopts cannot race the swap), the watch interval reads `BOS_SNAPSHOT_WATCH_INTERVAL_MS` (default 30s), extends-ref slots re-read their parent config from FastKV and verify against the parent's latest integrity (the upstream-republish detection the old monitor had, ported into the watch tick), the tick rides the host logger, and an unchanged-pointer verification failure alerts directly (re-adopting an identical pointer cannot heal serving-side corruption). The legacy setInterval integrity monitor is deleted — the watch fiber covers it.
