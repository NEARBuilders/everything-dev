---
"everything-dev": patch
"host": patch
---

Require ssrIntegrity for tenant SSR — prevent no-cache-per-request MF instance creation

Tenant SSR now requires both `ssrUrl` and `ssrIntegrity` to be present. Previously, a whitelisted tenant with `ssrUrl` but no `ssrIntegrity` would bypass the router module cache (`shouldCacheRouterModule` returns false without `ssrIntegrity`), causing a new Module Federation instance to be created on every SSR request — the same pattern that caused the production SSR failure.

Also fixes pre-existing typecheck errors in host test files (Effect Either narrowing, FederationError type annotation).
