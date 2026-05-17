---
"everything-dev": patch
---

Update `bos upgrade` to sync inherited catalog entries from the full root `bos.config.json` extends chain, preserve child-only catalog entries, and rewrite matching workspace dependencies to `catalog:`. This also writes fully derived composable/plugin config into the resolved BOS config artifact, adds the shared TanStack UI tooling packages to the root catalog, removes the explicit `@hot-labs/near-connect` pin so apps follow the transitive `better-near-auth` dependency instead, and makes config loading warn and fall back to production when development targets are missing while still erroring on unreachable `extends` targets without a usable local fallback.
