---
"every-plugin": major
"everything-dev": major
---

Plugin identity unified and shared dependencies specified once.

**every-plugin**: new `every-plugin/identity` — one derivation for npm/remote/container names from the config layout key (`remoteName`, `containerName`, `identity`, `pluginLayoutKey`, `resolveDevPluginId`); `plugin.dev.ts` no longer carries `pluginId` (the dev server derives it from the workspace `package.json`, fixing the `dependsOn` sibling lookup). New `every-plugin/shared-deps-spec` — the canonical shared-dependency lists, criticality, and version resolution; unresolved versions now **fail the build loudly** (`SharedDependencyResolutionError`) instead of silently degrading to `*`/`latest` and disabling the strict-singleton guard; all four consumers (rspack, rsbuild, runtime mf-config, host pre-registration) derive from it. The `apps` plugin is renamed `registry` (dir, package `@everything-dev/registry-plugin`, config attachment key `plugins.registry`, `apiClient.registry.*`) — the attachment-key rename is a published-config break; land it with the bundle deploy.

**everything-dev**: consumes both modules; scaffold (`_template`) stops emitting `pluginId`.
