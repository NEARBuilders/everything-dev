---
"everything-dev": patch
---

The build train's children run pnpm, not npm (ADR 0026 completion): `buildWorkspaceTargets` (target + default spawn), `ensureFreshDeps` (prerequisite rebuilds), and the container dist builder spawn `pnpm run build` instead of `npm run build`. The deploy CLI is itself a pnpm run-script, so pnpm exported its workspace settings (`node-linker`, `catalog`, `link-workspace-packages`, `overrides`, …) as `npm_config_*` env vars — every npm child then warned `Unknown env config` (one wall of warnings per workspace, and npm's next major drops unknown env configs). pnpm children read those settings natively; the warnings are gone and the fleet posture is uniform.
