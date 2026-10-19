---
"everything-dev": patch
---

Regression harness hardening residue (#344, post-#299 checks): the container leg now honors a non-4100 `REGRESSION_BASE_URL` port — `start-container.mjs` adds an explicit runner-port → container-start-port docker map when they differ, and fails loud when the base URL's port collides with the container's fixed 1:1 port block (previously the health probe hung the full 240s budget against a port nobody listens on). The staged layout loader reuses the layout's own base port instead of re-deriving it. `container-build.ts` dedupes the plugin→port mapping into one `pluginPort` helper used by both the slot plan and the static-server layout. The test-plugin fixture drops its dead `eslint-disable` comment (this repo runs Biome; the live `biome-ignore` stays).

The other #344 findings were already fixed on main and verified here: fail-loud `REGRESSION_VARIANT`, uniform health-loop sleep, live `spawnSync("docker rm")` status checks, 2s DB probe timeout, early-container-exit short-circuit, and stale-container reaping in `start-container.mjs`; the canonical sanitiser import in `container-build.ts`; the corrected `ssr-compose.spec.ts` project docblock.
