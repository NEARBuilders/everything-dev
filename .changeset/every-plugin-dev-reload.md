---
"every-plugin": minor
---

Dev reload support (issue #942, ADR 0051): `PluginRuntime.reloadPlugin` drops
one plugin's loaded instance, purges its Module Federation container so the
next load re-fetches rebuilt bytes, and re-runs the load → instantiate →
initialize → register pipeline against the same config — the previous
instance's lifecycle scope closes during the eviction, so scoped resources
(DB pools) release. Backing it, `ModuleFederationService.unregisterRemote`
clears every memoized slot for a remote (registration, module cache, the
evaluated entry exports, the process-global entry-load promise) — the
container memoization lives in process-globals only the runtime's own remote
handler can purge. Dev-loop machinery: production consumers never call it.
