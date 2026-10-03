# ADR 0018: One owner for the session read path — `everything-dev/ui/auth` as a shared singleton

Date: 2026-09-25
Status: Accepted

## Context

The post-sign-in redirect loop ("Too many redirects" after login) was fixed
three times (#162, #175, #178) without staying fixed. Each fix converged the
*invariant* — every session read funnels through one queryFn
(`sessionQueryOptions`, always `disableCookieCache: true`) so every redirect
decision sees the same answer — but the invariant had to hold identically
across **multiple independently deployed bundles**: the session read path lived
in the platform package and was compiled separately into the core ui remote
and every plugin ui remote. `packages/everything-dev/src/ui/auth.ts` (#178's
fix) shipped in the deployed auth-ui bundle while the deployed main ui bundle
disagreed with it — the guards on the two sides of the login ↔ authenticated
redirect pair read divergent copies and ping-ponged past the router's limit.

The cleanup itself drifted the same way: #178 removed the WeakSet bootstrap
bookkeeping from `ui/src/lib/session-cache.ts` but the plugin's copy
(`plugins/auth/ui/src/lib/session-cache.ts`) silently kept it. Three files
across two remotes owned pieces of one concern.

## Decision

1. **Single owner: `everything-dev/ui/auth`.** The session read path
   (`sessionQueryOptions`, `sessionQueryKey`, `refreshSessionCache`), the auth
   redirect policy (`requireSession`, `requireAdmin` — both sides of the
   login ↔ authenticated guard pair), `clearAuthenticatedQueries`, and the
   plugin-path navigation helpers live in the platform package
   (`src/ui/auth.ts` + `src/ui/auth-guards.ts` + `src/ui/plugin-path.ts`),
   following the framework-home convention decided in the amended db/auth
   absorption decision (issue #89: the home is `everything-dev/<area>`, never
   an `every-plugin/*` facade).

2. **One runtime copy via the existing share list.** `everything-dev/ui/auth`
   joins `SHARE_MODULE_NAMES` semantics in the ui build factory
   (`every-plugin/build/ui`): the core ui is the provider, plugin uis are
   consumers (`import: false` — no bundled fallback copy), strict-version
   singleton like react/TanStack. This extends the ADR 0008 build contract,
   not a new mechanism. A mixed deploy (one remote rebuilt, the other stale)
   can no longer run two divergent copies: there is one module in the share
   scope, and a version mismatch fails loudly instead of silently loading a
   second disagreeing copy.

3. **Version negotiation resolves from the building workspace** — the subpath
   share key resolves the installed `everything-dev` package (workspace
   symlink in the monorepo, real install in children), not the declared
   `catalog:` range, per the single-resolver principle of advisor-plan 010.

4. **Sync surface shrinks.** `ui/src/lib/auth-guards.ts`,
   `ui/src/lib/plugin-path.ts`, `ui/src/lib/session-cache.ts`, and
   `plugins/auth/ui/src/lib/session-cache.ts` exit child ownership (deleted;
   the drifted WeakSet copy dies with the last one).
   `resolveSessionFromCache` — the SSR↔query-cache hydration bridge the
   sync-owned `__root.tsx` imports (better-auth owns the session fetch; it has
   no concept of TanStack Router hydration — router glue, not an auth
   concern) — lives in `everything-dev/ui/auth` with the rest of the session
   surface.

## Consequences

- The login route's beforeLoad (auth plugin ui) and the authenticated mounts
  (core ui) import from the same shared module — the redirect graph is owned,
  and unit-testable as a pair, in one place (`tests/ui/auth-guards.test.ts`
  in everything-dev).
- Plugin uis stop bundling better-auth/better-near-auth client code that
  flows through the session module (size redistribution to the provider's
  shared chunk; consumers declare zero assets for it).

**Two resolution rules** (the structural exit from the staleness class):

1. **Bundler-configuration code resolves from source under the workspace
   runtime.** The config factories (`every-plugin/build/ui`,
   `every-plugin/build/rspack`) resolve `src` via bun's always-on `"bun"`
   export condition (plus `"development"`) — bun is the workspace runtime, so
   config code only ever runs at build time from the working tree and a stale
   dist cannot silently drop shared entries from the emitted manifest
   (verified: a ui build succeeds with every-plugin's dist deleted outright).
   Node consumers — scaffolded children running `node node_modules/.bin/bos`
   — resolve the immutable published dist: node refuses to type-strip .ts
   under node_modules, and npm artifacts cannot drift. The
   `everything-dev/ui/mf-build` re-export shim is deleted —
   `ui/rsbuild.config.ts` imports `every-plugin/build/ui` directly,
   matching the generated plugin configs. This is the normalization the app
   descriptor (ADR 0005, plan 028) completes: unit-specific build data lives
   in the unit, machinery stays generic, and the config surfaces resolve
   current source.
2. **Shipped code resolves dist, and the train guarantees freshness.** Runtime
   subpaths (`everything-dev/ui/auth`, `db`, every-plugin's shared runtime)
   resolve built dists; `buildWorkspaceTargets` unconditionally staleness-checks
   and rebuilds the framework prerequisites (`every-plugin`, `everything-dev`,
   `better-near-auth`) before any target. The train (`bun run build`,
   `bun run deploy`) is the only supported build path; raw per-workspace builds
   are unsupported.

- `everything-dev/ui/api` remains per-remote-bundled for now (no cross-remote
  invariant depends on it); the server-side auth middleware copies rest at
  advisor-plan 007's convergence point pending the framework-export ticket.
- The plugin unit shape normalization (`src` → `api/src`, `plugin.dev.ts` →
  `bos.dev.ts`, per-unit authored descriptors) is ticketed as the
  plugin-shape slice of the 028 arc (issues 15/16; CI train consumption is
  issue 17).
