---
"everything-dev": patch
"every-plugin": patch
---

Clear every `pnpm run lint` warning (75 → 0) and one broken host SSR assertion.

- **oxlint cleanups**: single-element `Promise.all`, useless `?? {}` fallbacks and spreads, interface method signatures converted to property syntax (`unbound-method`), `await` of synchronous functions removed, template-literal `unknown` interpolations stringified, explicit sort comparators, a `child.pid` guard, and `await act(async …)` in fake-timer tests.
- **Effect v4 hygiene**: `return yield* new DatabaseError(...)` (yieldable errors), `loadMigrations` exported as an Effect value, `Effect.tryPromise` + `orElseSucceed` instead of `try/catch` in the MF service, `Effect.mapError` instead of `catch`+`fail` in the template plugin, and `Data.TaggedError` for `DepsBuildFailure`, `WorkspaceRefreshError`, `TransientStorageError`, `StorageHttpError`, the template service's `TemplateFetchError`, and the SSR-swap test loader errors (constructor signatures moved to args objects).
- **UI**: safe-area insets moved from inline `style` to the `safe-area-inset` Tailwind `@utility`; better-auth's `any`-collapsed `Organization`/`Passkey` inference replaced with explicit interfaces and consumers now use the API-contract `Organization` type; the unused `activeOrg` prop removed from `UserNavMenuContent`.
- **Tests**: reworked the `_template` service test helpers to typed error channels (no `as Effect.Effect<A, never, never>` narrowing), and fixed `ssr-nonce-liveness`'s flip assertion which compared the flipped URL against itself (now guards against the previous deployment's URL leaking).
