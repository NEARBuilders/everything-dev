---
"everything-dev": patch
---

`pnpm run release` now builds publishable workspaces in dependency order (topological sort of the workspace dependency graph, deterministic tie-break, loud failure on cycles) instead of glob order. Glob order built `everything-dev` before `every-plugin`/`better-near-auth` had emitted their dist types, so `assertWorkspaceDtsDependencies` failed every publish attempt on a clean checkout — releases could never catch up with the workspace and the npm `rc` dist-tag drifted behind deployed images.
