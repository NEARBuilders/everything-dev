---
"every-plugin": major
---

Export map is now generated from the tsdown entry table, and the dead build surface is gone.

**every-plugin**: the `package.json` exports map's `bun`/`development` blocks are stamped from `tsdown-entries.ts` — one table is the source of truth for the tsdown entry list and the export subpaths (`bun run --cwd packages/every-plugin exports:sync` to stamp, `exports:check` for CI; a unit test pins the stamp, and `tsdown` self-stamps on every build). Resolution semantics are unchanged: `bun`/`development` still resolve `src/`, default still resolves `dist/` (ADR 0018). Removed with zero in-repo callers: the `every-plugin/testing` export (never imported), `RuntimeOptions` (never read), the public `EveryPluginComposedBuild` / `EveryPluginComposedBuildOptions` re-exports (the composed stack stays, internal to `createPluginBaseConfig`; no custom stacks exist), the `additionalExports` build option in `EmitPluginManifest` (manifest *consumption* of `additionalExports` from deployed plugins is untouched), and the deprecated `CommonPluginErrors` alias (use `PluginErrors` or individual imports). Consumers of deployed-plugin manifests are unaffected.

**everything-dev**: internal refactor only — the three near-identical prerequisite builders collapse into one `buildPackageQuietly(cwd, packageName, force)`; `buildWorkspaceTargets` and the `bos dev` boot build are unchanged in behavior, and the regression prod-stack runner (image-stage builds via `scripts/regression/container-build.ts` / the `bos build` CLI) is untouched.
