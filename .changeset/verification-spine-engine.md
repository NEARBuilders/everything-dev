---
"everything-dev": minor
---

The Verifier engine (ADR 0046 ticket 01): one fetch → sha384 → compare implementation behind the `Verifier` `Context.Service`, the `Verified<T>` branded artifact type, the yieldable `IntegrityMismatch` / `ProvenanceUnknown` / `SignatureInvalid` error taxonomy, and process-lifetime verified-document caching where the cache is the last-known-good. `bos verify`, `resolveRemoteVersion`, and `fetchVerifiedManifest` now ride the engine — report and CLI surfaces are unchanged.
