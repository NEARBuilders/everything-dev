---
"every-plugin": major
"everything-dev": major
---

Migrate the framework to Effect 4 (`4.0.0-rc.112`) and oRPC v2 (`2.0.0-beta.35`).

**every-plugin**
- Layer-based plugin `initialize`: services are built with `Layer.mergeAll` + `Layer.buildWithScope` inside an `Effect.gen`, replacing the removed `tools.buildService` API. `PluginServicesTools` is gone.
- `Context.Tag` replaced by `Context.Service<Self, Shape>()("id")` throughout.
- Effect 4 API migration: `Effect.either` removed (use tagged results or `runPromiseExit`), `Effect.catchAll` → `Effect.catch`, `Effect.async` → `Effect.callback`, `Layer.scoped` → `Layer.effect`, `Cause.isInterruptedOnly` → `Cause.hasInterruptsOnly`, `Fiber.RuntimeFiber` → `Fiber.Fiber`.
- `PLUGIN_ERROR_STATUS_MAP` now spreads oRPC v2's `COMMON_ERROR_STATUS_MAP` (providing a map replaces the default entirely) and keeps the v1 TIMEOUT → 504 / CONNECTION_ERROR → 502 overrides.
- `getMajorMinorVersion` preserves prerelease segments (`4.0.0-rc.112` → `^4.0.0-rc.112`) so Module Federation requiredVersion ranges keep host/plugin lockstep on RC builds.
- Publisher retention option renamed to `resume: { enabled, seconds }`.

**everything-dev**
- CLI runtime fully migrated to Effect 4; the orchestrator no longer depends on `@effect/platform`/`@effect/experimental` (no Effect 4 release) and spawns processes via `child_process.spawn` with `Effect.callback` exit handling and `Stream.fromReadableStream` output pipelines.
- `bos upgrade` codemod rewrites `Effect.provide(Layer)` call sites to the v4 `Layer.buildWithScope` + `Context.get` pattern and emits balanced-import rewrites.
- Contract parsing reads zod 4 schema internals (`def` instead of `_def`) and oRPC v2 `~orpc.inputSchemas[0]`, fixing boolean/negated flag parsing.

**Host / API / plugins / UI**
- All workspaces on the same Effect 4 + oRPC v2 versions via the catalog. oRPC v2 OpenAPI generator/reference plugin wiring, RPCLink `origin`/`url` split, `errorStatusMap` on all handlers.
- Breaking change for deployed remotes: hosts and plugins must be redeployed together (`bos publish --deploy`). v1 remote bundles are incompatible with the v2 host.
