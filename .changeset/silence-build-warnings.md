---
"every-plugin": minor
"everything-dev": minor
---

Source-first local dev for the framework packages plus quieter builds.

**every-plugin**
- Silenced route-generator build warnings: colocated `*.test`/`*.spec` route files are excluded from route scans via `routeFileIgnorePattern` (prefix with `-` to fully opt out), and the node-environment UI build no longer races the web environment writing `src/routeTree.gen.ts` (its write goes to a scratch path).
- `every-plugin dev` re-execs with `--conditions=development` (guarded by `EVERY_PLUGIN_DEV_CONDITIONS=1`) so the runtime resolves framework packages from TS source.
- Plugin rspack builds resolve `every-plugin`/`everything-dev`/`better-near-auth` through the `development` export condition (TS source) for all local flows; the gate is `DEPLOY !== "true"` (the rspack CLI defaults NODE_ENV to production even for dev watch). Adds json and `.js`→`.ts` extensionAlias rules to make source-resolved packages (package.json imports, node-style specifiers) bundler-compatible. Deploy builds keep the dist-first snapshot that ships.

**everything-dev**
- `bos dev` spawns services with `bun --conditions=development`, so bun-runtime chains (plugin dev servers, MF runtime requires) consume framework sources directly; the host dev server gets `NODE_OPTIONS=--conditions=development` (tsx is TS-capable node).
- Root `dev*`/`bos` scripts run the CLI with the development condition, so the CLI itself starts from source on fresh clones without a prebuilt dist.
- The quiet dist rebuilds at `bos dev` bootstrap remain: rsbuild/rspack config loaders (jiti / native `.mjs` import) are conditions-inert and require dist.
