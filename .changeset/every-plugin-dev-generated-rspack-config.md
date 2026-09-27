---
"every-plugin": patch
---

Fix `every-plugin dev` after per-workspace rspack config deletion: the dev server spawned a bare `rspack build --watch` with no config, falling back to rspack defaults (entry `./src`, no `.ts` resolve extensions) so every local plugin's watch build failed with `Can't resolve './src'`. The generated-config synthesis from the CLI (`build`/`deploy` paths) is now shared (`ensureGeneratedRspackConfig`) and the dev watcher passes `--config .every-plugin/rspack.config.generated.mjs` (bare `rspack build --watch` remains for workspaces that ship their own `rspack.config.js`).
