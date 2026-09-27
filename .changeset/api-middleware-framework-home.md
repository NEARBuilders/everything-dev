---
"everything-dev": patch
---

**BREAKING for child projects (sync-surface change):** `createAuthMiddleware` moved framework-home — it is now exported from the new `everything-dev/api` subpath (src in dev, dist in prod, mirroring `everything-dev/ui/auth`) and is generic over the workspace's auth context (`createAuthMiddleware<AuthContext>(builder)`); the five near-identical copies (`api/src/lib/auth.ts`, `plugins/*/src/lib/auth.ts`) are deleted and `bos sync` no longer owns or restores `lib/auth.ts` paths. Child projects: import `{ createAuthMiddleware }` from `everything-dev/api` and source `AuthContext`/`AuthOrganizationContext` types from the generated `auth-types.gen.ts` (`AuthPluginContext` is the same type the old copies aliased). Out of scope, unchanged: the `DecoratedMiddleware`/`.use()` typing limitation advisor-plan 007 noted.
