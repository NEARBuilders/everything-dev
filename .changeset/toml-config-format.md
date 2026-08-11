---
"everything-dev": minor
---

Add TOML config format support (`bos.config.toml`) as a dual-format alternative to `bos.config.json`

- **`bos.config.toml`**: `findBosConfigPath` probes `bos.config.toml` first, then `bos.config.json` in directory tree walks. Both can't coexist — throws on duplicate.
- **Format-preserving writes**: `saveBosConfig` and `reportDeployResult` detect the original config format (TOML or JSON) and write back in the same format.
- **`disabled = true` marker**: Replaces the `null` sentinel pattern for TOML (which has no null). Schema field `disabled` on `BosPluginRefSchema` ensures Zod doesn't strip it. `cleanNullSentinels` strips `disabled: true` entries during merge.
- **Effect-free sync helpers**: `readBosConfigSource`, `findBosConfigPath`, and `findBosConfigPathInDir` are plain sync functions that throw native errors (not `FiberFailure`), preserving readable error messages.
- **Directory-only lookup**: Added `findBosConfigPathInDir` for cases where walking up the tree is incorrect (plugin local path resolution in `resolveComposableReference`).
- **Published form stays JSON**: FastKV registry keys remain `apps/{account}/{gateway}/bos.config.json`; TOML is local authoring only.
- **Bootstrapping**: `bos init` now copies `bos.config.toml` alongside `bos.config.json` in init patterns, and reads/writes configs via format-aware helpers.
- **Migration**: 12 raw `JSON.parse(readFileSync(...))` sites migrated to `readBosConfigSource` across build, plugin, upgrade, status, and init modules.
