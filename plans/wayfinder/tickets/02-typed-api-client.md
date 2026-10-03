## Question

How do independently deployed web plugin MF remotes get a typed `apiClient` that includes all backend plugins' contracts?

Current state (v1): a single UI monolith imports `useApiClient()` from `@/app`, which resolves to one composed `apiClient` with all plugin routes typed via generated `plugins-types.gen.ts`.

In v2, web plugins are separate MF remotes. They don't share a build context with the host or with each other. The `apiClient` they need depends on which backend plugins are composed in `app.ts`.

Options to evaluate:
1. **Host injects via router context** — `createRootRouteWithContext<{ apiClient: ComposedClient }>()` provides the typed client to all routes. Each plugin's routes access it via `Route.useRouteContext()`. The type is the host's composed client type. Pro: single source of truth. Con: plugin routes can't import specific plugin client types directly.
2. **Shared remote entry** — the host deploys a shared MF remote that re-exports the composed `apiClient`. Web plugins import from `everything-dev/api` which resolves to that shared remote at runtime. Pro: familiar import pattern. Con: circular dependency (host depends on plugins, plugins depend on host's composed client).
3. **Each plugin creates its own client** — web plugins import `everything-dev/api` and create an `apiClient` pointing at the same origin. The client types come from `app.ts` types propagated through a virtual module. Pro: no host injection needed. Con: each plugin has its own client instance, not a shared QueryClient cache.
4. **`apiClient` via TanStack Router context + `createRootRouteWithContext`** — the host composes the client, puts it in router context, and every plugin route (regardless of which remote it came from) accesses it via `useRouteContext()`. Types flow from the root. Pro: Effect.ts idiomatic (context as dependency). Con: plugin code must know the context shape.

Key sub-questions:
- Do plugins need per-plugin typed methods (e.g., `apiClient.registry.listApps()`) or just a generic fetch adapter?
- How does the host compose the final `apiClient` type? From `app.ts`'s plugin declarations?
- Does the QueryClient cache need to be shared across all web remotes? (TanStack Query's `QueryClient` is a MF singleton — shared across remotes.)

## Resolution

**RESOLVED** by the [override prototype](../../prototypes/beta-v2-override/) — Option 1 (host injects via router context) is the proven approach.

- The host builds `apiClient` from `config.api`, folds by namespace (`dashboard` → `apiClient.dashboard.*`), and injects into router context.
- Remote components read it via `useRouteContext({ strict: false })` — works because `react` and `@tanstack/react-router` are shared MF singletons.
- The same `apiClient` object reaches base UI, tenant UI, AND UI-only plugins (e.g., landing calling `apiClient.dashboard.*`). Verified by `verify-api-injection.ts`.
- See [prototype README](../../prototypes/beta-v2-override/README.md) and `host/src/api-client.ts`.
