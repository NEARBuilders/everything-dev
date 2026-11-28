---
"everything-dev": patch
---

Fix #933: publish the `@module-federation/*` rows in the platform catalog as exact versions matching the root lockfile (`@module-federation/*` 2.9.2, `@module-federation/node` 2.7.52). Caret rows made children that re-resolve their lockfile float to a newer patch than the host image was built from, so their plugin bundles reported a mismatched `pluginVersion` and the deploy smoke `bos mf check` rejected every redeploy ("redeploy this plugin" could never succeed). Exact rows also match the gate's own semantics — the compat check compares versions for equality — and a unit drift guard (`mf-catalog-pin.test.ts`) now fails CI if a floating `@module-federation/*` row is reintroduced or the lockfile falls out of step with the catalog. `bos upgrade --check` stays clean: the rows move only when the parent catalog itself moves.
