---
"host": patch
"everything-dev": patch
---

Effect hardening pass 2 (#151): compose and client-config caches live behind host server-layer services with scoped finalizers; federation/local-dist teardown is owned by `FederationLifecycle` (manual `reset*` exports removed); local-container and orchestrator readiness probes use `Schedule` + `Effect.timeout` with the same cadences. Also skips plugin ui sources with no production URL so SSR composition does not crash on a relative manifest fetch (aligns with open #265).
