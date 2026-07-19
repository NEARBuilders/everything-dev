---
"host": patch
---

Refactor plugin bootstrap to Effect-native error channel and route `CORS_ORIGIN` through Effect's `Config` primitive.

- `host/src/services/plugins.ts`: `initializePlugins` splits the single `Effect.tryPromise` into a narrow host-infra `tryPromise` (→ `PluginError`) plus per-phase `Effect.gen` steps for auth / non-api plugins / api. Each phase catches `PluginBootstrapError` via `Effect.catchTag` and routes through one shared `logBootstrapError` helper, collapsing three duplicated catch blocks. DB URL secrets now read via `Config.secret` + `Secret` (raw value only touched via `Secret.value` at the masking point); missing env maps to `Secret("unset")` through `catchAll`. `PluginBootstrapError` gains a `message` getter matching the `errors.ts` pattern. Logging inside Effect-managed regions moved to `yield* Effect.logInfo/logError`.
- `host/src/services/plugins.ts`: `buildAuthBaseVariables` simplified — removes dead `/remoteEntry.js`/`/mf-manifest.json` regex stripping (those URLs live on `config.host.entry`, never `config.host.url`) and the redundant `localhost:3000` double-fallback. Dev uses `config.host?.url ?? localhost:PORT`, prod uses `config.domain` (the public ingress, not the Zephyr URL which lives in the separate `config.host.remoteUrl` field).
- `host/src/services/config.ts`: added `readCorsOrigins()` using `Config.array(Config.string(), "CORS_ORIGIN")` with `ConfigProvider.fromEnv`, filtering empty entries, `catchAll` fallback to `[]`.
- `host/src/services/program.ts`: single `yield* readCorsOrigins()` at the top of `createStartServer` replaces both the warning-presence check and the `allowedOrigins` parse. One env read instead of two.
- `host/src/services/plugins.ts`: `buildAuthBaseVariables` now takes `corsOrigins: string[]`; auth phase reads via `yield* readCorsOrigins()`. Removes the inline `process.env.CORS_ORIGIN?.split(",")` read.

Behavior changes for `CORS_ORIGIN` edge cases (both more correct): `CORS_ORIGIN=''` now resolves to `[]` (was `[""]`), so the production warning fires for empty string and `allowedOrigins` falls through to host/ui fallback. `CORS_ORIGIN='a,,b'` now resolves to `["a","b"]` (was `["a","","b"]`).

No public API changes. `PluginResult` shape unchanged. `bun typecheck` clean, biome lint clean, 124/124 host tests pass.
