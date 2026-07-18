---
"everything-dev": patch
---

Fix db.ts type error and conditionally copy plugin-owned UI routes during bos init.

- `packages/everything-dev/src/db.ts`: fix TS2345 on `tables.add(tableName)` where `tableName` was `string | undefined` from `String.matchAll()`. Collapsed redundant `if (schemaName)/else if (tableName)` branches into a single `if (tableName)` guard.
- `packages/everything-dev/src/cli/init.ts`: add `buildPluginRouteExclusions(parentConfig, selectedPlugins)` which returns UI route globs claimed by non-selected plugins. `copyFilteredFiles` and `writeInitSnapshot` now accept an optional `ignore` parameter merged into the glob ignore list.
- `packages/everything-dev/src/plugin.ts`: the init command now computes route exclusions from the parent config and excludes plugin-owned routes (e.g. `ui/src/routes/_layout/apps/**`) when the corresponding plugin is not selected. This prevents scaffolded routes from referencing unconfigured plugin API namespaces (e.g. `apiClient.apps` without the `apps` plugin).
- `bos.config.json`: remove `ui/src/routes/_layout/index.tsx` from `plugins.apps.routes` — the home route is a core route, not apps-specific.
