## Question

How do we make `createPlugin` fully Effect.ts idiomatic while remaining composable across independently deployed modules?

The v2 plan pushes toward Effect-native patterns: `Layer`-based plugins, `.effect()` handlers, `yield* Tag`. But there are open design questions.

Current v1 `createPlugin` signature:
```typescript
createPlugin({
  variables: z.object({}),
  secrets: z.object({ DATABASE_URL: z.string() }),
  contract,
  initialize: (config) => Layer.provide(MyService.Live, ...),
  createRouter: (builder) => ({ getById: builder.getById.effect(...) }),
})
```

v2 proposed signature (from ../beta-v2/overview.md):
```typescript
createPlugin({
  variables: z.object({}),
  secrets: z.object({ DATABASE_URL: z.string() }),
  contract,
  initialize: (config) => Layer.provide(MyService.Live, ...),
  createRouter: (builder) => ({
    getById: builder.getById.effect(function* ({ input }) {
      const svc = yield* MyService
      return yield* svc.findById(input.id)
    }, { errorStatusMap: { NOT_FOUND: 404 } }),
  }),
})
```

Questions to resolve:
1. **Scoped resources** — `tools.buildService(tag, layer)` in `initialize` binds resources to the plugin's lifecycle. Does this work correctly when plugins are independently deployed (MF remotes)? The host loads them into its Effect runtime — does each plugin get its own scope?
2. **Plugin-to-plugin service dependencies** — if `dashboard` needs `registry`'s `RegistryService` Tag at runtime, how does it get it? The host composes all plugin Layers into one runtime. Does `dashboard`'s `createRouter` just `yield* RegistryService` and trust the host composed it?
3. **`createRouter` with Effects** — today `createRouter` returns plain async handlers. The `.effect()` wrapper is proposed but doesn't exist yet in oRPC. What's the actual oRPC v2 API for Effect-native handlers? Does oRPC support `Effect.gen` yield* patterns natively?
4. **`initialize` return type** — should `initialize` return a `Layer` (as today) or an `Effect`? If plugins need to do async initialization (connect to DB, fetch config from FastKV), should that be an `Effect.gen`?
5. **Secrets and configuration** — today secrets come from `config.secrets.DATABASE_URL` (passed by host). In v2 with `app.ts`, secrets are declared but the actual values come from the environment. How does the host resolve which secrets to inject into which plugin?
6. **Error handling** — Effect.ts error types (`ConfigError`, `Tag` hierarchy) vs oRPC error status codes. How do they compose? Does `.effect()` map `Effect.Error` to oRPC error responses automatically?
7. **Lifecycle hooks** — Effect.ts `Scope` management. When a plugin is loaded, its Layer is built into a `Scope`. When the plugin is unloaded (or the host shuts down), the scope is released. Does every-plugin's runtime support this today?

Key question: what's the minimal change to `createPlugin` to be "Effect.ts idiomatic" without a full rewrite? The `.effect()` handler syntax is the most visible change, but the real power is in Layer composition and scoped resources.

## Resolution

**RESOLVED (direction) — unblocked and sequenced first on the `v2` branch.**

The blocking premise — "the `.effect()` wrapper is proposed but doesn't exist yet in oRPC" (question 3) — is stale. `@orpc/experimental-effect` shipped with oRPC v2 public beta (v2.0.0-beta.28, Aug 2026):

- `handlerGen(function* ...)` — Effect-generator handlers
- `.effect()` — builder extension via `import '@orpc/experimental-effect/extensions/effect'` (matches the migration plan's pre-load approach: import in the every-plugin bootstrap, zero contract syntax changes)
- `WithEffectContext` + `effect/context` — services provided through oRPC context (the migration plan's `initialize`-returns-`Layer` model)
- `catchORPCError` / `catchORPCErrorCode(s)` — `ORPCError` yielded as `Effect.fail` maps to typed error responses (answers question 6)
- Installs against `effect@beta` — the Effect 4 channel

Consequences:

1. **Effect 4 migration rides along** — the repo pins Effect 3.21; `@orpc/experimental-effect` wants the Effect 4 beta channel. Moving to Effect 4 also unblocks alchemy 2.x as a direct dependency (it peers on effect ≥4), dissolving the PR #58 `.bos/alchemy` sandbox.
2. **Sequencing** (map decision 17): this migration is the opening phase of the `v2` branch, ahead of the deploy service (which is then built Effect-native from day one). The 8-phase execution order in `../infra/orpc-v2-effect-migration.md` governs; its atomic-deploy constraint (V1 client can't talk to V2 server) is absorbed inside the branch.
3. **Remaining verification at implementation time** — questions 1, 2, 4, 5, 7 (scoped resources across MF remotes, plugin-to-plugin `Tag` deps, `initialize` return type, secrets injection, `Scope` lifecycle) are answered by the migration plan but confirmed empirically during Phase 1 of the migration, not pre-specified here.
