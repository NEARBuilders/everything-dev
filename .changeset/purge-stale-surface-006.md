---
"every-plugin": minor
"everything-dev": minor
---

Purge the stale public surface: delete dead every-plugin exports (`PluginMetadataRegistry`, `LegacyPluginRuntimeConfig`, `PluginConstructor`, `ERROR_PATTERNS`, `getPluginSharedDependenciesVersionRange`, and the deprecated `createLocalPluginRuntime` / `createTestPluginRuntime` / `PluginMap` / `InferBindingsFromMap` testing helpers), restore the `bos upgrade` legacy dist-import rewrite to its original `everything-dev/dist/` → `everything-dev/` pattern (the mapping table had degenerated to an identity rewrite that could never fire), and replace the dead subaccount workflow in generated child AGENTS.md with the DAO-owned tenant flow.
