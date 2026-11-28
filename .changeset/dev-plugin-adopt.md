---
"everything-dev": minor
---

New `./dev-adopt` subpath export: the backend dev-generation plane's shared
primitives — the built-dist fingerprint (`dist/remoteEntry.js` +
`dist/mf-manifest.json`, content-identity), the settle state machine
(`advanceAdopt`), and the stat-memoed sampler (`createBackendFingerprintSampler`).
Pairs with the dev plugin adopt (issue #942, ADR 0051): the host's dev serving
plane reloads rebuilt plugin generations in-process and swaps the serving
router (`host/src/services/dev-plugin-adopt.ts`), and the dev session replaces
the affected plugin/api/auth child — one log line per generation move
(`[dev] plugins/auth moved to generation N`). Editing a plugin's source now
reaches `/api/rpc/<plugin>/*` without a restart.
