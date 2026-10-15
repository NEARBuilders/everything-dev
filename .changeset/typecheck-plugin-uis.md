---
"everything-dev": patch
---

`bos typecheck` now typechecks plugin UIs: each local plugin with a `ui/tsconfig.json` gets a `plugins/<key>/ui` row that runs the plugin's `typecheck:ui` script (falling back to `tsc --noEmit -p ui/tsconfig.json`), and the typecheck pass materializes the plugin ui's `routeTree.gen.ts` on disk so `createFileRoute` ids resolve. Generated children run `typecheck:ui` per plugin in the root script too. Broken plugin-UI code no longer ships type-clean.
