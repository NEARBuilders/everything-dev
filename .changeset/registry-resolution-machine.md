---
"everything-dev": minor
---

The registry resolution state machine and the cache stand-in layer: `resolveRelease`
(`Pinned | Latest → Resolved | Unresolved`) with the digest chain (thin-tag digest
verified against the fetched record's bytes), a structured `Unresolved` reason
(`absent | unreachable | integrityFailure`) carrying the dead-end diagnostic — what
the tag serves, the chain walked, and the terminus's last write — and the #546 cache
stand-in (`hit | stale | miss`) that serves unreachable reads only. The pinned
resolution scans the extends chain's immutable version records, so a root release
never strands a child pin (#574). `resolvePlatformManifest` survives as the machine's
compatibility adapter with exact old semantics.
