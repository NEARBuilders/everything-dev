---
"everything-dev": patch
---

Consumer-coupling fixes: the deploy image leg skips with a notice when no Dockerfile exists at the config root (children fetch the universal image — ADR 0020/0021) and `bos init` no longer scaffolds a Dockerfile into fresh children; `bos pluginAdd` with a remote URL switches the plugin to remote (drops a conflicting `development: local:` entry — dual local-dev/prod-URL mode is now hand-edit only); the typegen write pass sweeps stale per-plugin `plugins-client.gen.ts` / `auth-types.gen.ts` and `.bos/generated/plugins/<key>` dirs for plugins that flipped local→remote or were removed; the local api/auth contract fallbacks fail loudly instead of emitting imports to missing files; `readBosConfigForBuild` and `bos registry use` fall back form-aware (authored `bos.app.ts` first, legacy `bos.config.json` last).
