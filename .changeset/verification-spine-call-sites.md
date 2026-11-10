---
"everything-dev": minor
"every-plugin": minor
---

The #642 revival — integrity back in the federation pipeline (ADR 0046 ticket 03): the MF fetch hook installs inside `createPluginRuntime` (the host's `__mfInstance` probe is gone), the registry keys by the resolved hashed artifact URLs — `resolvedIntegrityMap` derives them (entry, ssr entry, files-map entries) from the pin's resolution and rides the runtime config as `integrityMap` — and a lazily-fetched file whose served bytes drifted from the pin fails with the tagged `IntegrityMismatch` naming expected and actual, refusing the plugin load instead of a webpack TypeError. The SRI primitive collapses into the engine (`computeSri`) — the only `createHash("sha384")` site outside the storage boundary is the engine's. Migrated call sites: SnapshotWatch's entry verification, tenant override verification (blocking and stale-while-revalidate modes preserved), the SSR-entry gate in federation.server, ui-compose's manifest fetch (compose parity stays), and the local dist hashing in `diff.ts`.
