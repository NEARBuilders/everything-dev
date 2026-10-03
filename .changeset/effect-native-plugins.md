---
"every-plugin": major
"everything-dev": major
---

Effect-native plugins: `.effect()` handlers, Layer-returning `initialize`, router merging, and direct package imports. Implements `plans/infra/effect-native-plugins.md` (the handler-idiom half of the oRPC v2 + Effect 4 migration).

**every-plugin — breaking `createPlugin` API**
- `initialize` returns an Effect `Layer` instead of a deps record. The runtime builds the Layer in the plugin's lifecycle scope and exposes services through the oRPC context (`effect/context`), so handlers access them with `yield* Tag` in `.effect()` generators or `Context.get(context["effect/context"], Tag)` in plain/streaming handlers. `Layer.buildWithScope` + `Context.get` extraction in plugin code is gone.
- `createRouter(builder, plugins)` — the deps parameter is removed. Sibling plugin entries in `plugins` carry `{ client, router }` for cross-plugin router merging (nesting a sibling's router also surfaces its routes in the host's OpenAPI spec and MCP tools).
- `shutdown` is removed — Layer finalizers scoped to the plugin handle teardown.
- New optional `servicesTag` on the plugin definition lets the host read a plugin's services from the built Effect context without importing the plugin module (used by the host to mount the auth plugin's Better Auth handler).
- `@orpc/experimental-effect` (`.effect()` builder extension) and `@orpc/openapi` `.route()` extension are pre-loaded by the runtime; plugins import `oc`, `ORPCError`, `zod`, `effect` directly and the `every-plugin/orpc`, `every-plugin/effect`, `every-plugin/zod` re-export barrels (plus the `runEffect`/`flattenError` bridges) are deleted.
- `@orpc/openapi`, `@orpc/experimental-effect`, and `@orpc/publisher` are now Module Federation shared singletons.
- `InitializedPlugin.context` (deps record) is replaced by `InitializedPlugin.effectContext`; `usePlugin`'s `createClient` injects `effect/context` so server-side/SSR calls work with `.effect()` handlers.

**Host**
- `/api/rpc/*` and `/api` handlers inject the serving plugin's Effect context; the base API handler receives the merged context of all initialized plugins so merged sub-routers resolve their own services. MCP tool invocations get the same injection.

**API plugin**
- The four template-plugin passthrough handlers and their re-declared schemas are deleted; the template router is merged directly as `things`, so its routes appear under `/api` OpenAPI docs and MCP automatically.

**Plugins**
- `_template` (reference implementation), `apps`, `auth`, `proposals`, and `votes` migrated to the new API. Streaming handlers stay async generators and read services synchronously from the injected Effect context.
- `bos upgrade`'s `ensureEffectImports` codemod now rewrites legacy `every-plugin/effect` imports to `effect` directly.

**Atomic deploy required** — unchanged from the parent migration: old remote plugins are incompatible and all remotes must be redeployed together (`bos publish --deploy`).
