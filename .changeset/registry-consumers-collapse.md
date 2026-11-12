---
"everything-dev": minor
---

Consumers collapse onto the registry primitive. The `everything-dev/fastkv`
subpath export is removed (no shim, strict cutover policy) — import
`everything-dev/registry` instead; `fetchDeployManifests`,
`fetchBosConfigFromFastKv`, and the transport helpers remain reachable from the
root export, and `fastkv.ts` now delegates to the client + key model so absent
and unreachable registry reads are finally distinct (`RegistryError` propagates
where every previous fetcher collapsed into "No config found" — that message is
preserved for absent reads). The pre-cutover wire keys
(`platform.json`, `platform-versions/<v>.json`, `manifests/<ts>.json`) are
derived in exactly one file (`registry/pointer.ts`); the deploy train's inline
derivations and the legacy `getPlatformManifestKey`/`getPlatformVersionSlotKey`
helpers are gone. The post-publish smoke on release trains reads the pointer
and fails the leg — rollback engages — when it doesn't serve the version just
published.
