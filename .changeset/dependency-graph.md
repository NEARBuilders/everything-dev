---
"everything-dev": minor
"host": minor
---

Move to dependency-graph-based plugin composition with manifest stacking and per-plugin type generation

- **Dependency DAG**: New `dag.ts` module with `normalizeToNodes()`, `topologicalSort()`, `buildDependencyDAG()`, `mergeManifestNodes()`, `getDependenciesForNode()`, and `getSingletonKey()`. API implicitly depends on all non-ui siblings unless `dependsOn` is explicit.
- **Manifest stacking (one level deep)**: `buildRuntimeConfig` now fetches the API plugin manifest when remote, discovers sub-plugins with secrets/variables, and merges them into the runtime config. Config-declared plugins override manifest-discovered ones.
- **Per-plugin type generation**: `writeGeneratedFiles()` now generates per-plugin `plugins-client.gen.ts` files in `plugins/{key}/src/` when `dependsOn` is declared, and `plugins-types.gen.ts` is filtered by `apiDependsOn`.
- **Host DAG-based loading**: `plugins.ts` loads auth, plugins, and API in DAG order with a singleton cache, using `getDependenciesForNode` to wire per-plugin client contexts. Removed `loadedPluginKeys.unshift("api")` hack.
- **Node-based runtime config**: `RuntimeConfigSchema` gains a `nodes` field populated by `buildRuntimeConfig`, enabling the host to reason about the plugin graph directly.
- **Async `buildRuntimeConfig`**: Now returns `Promise<RuntimeConfig>` — all callers updated.
