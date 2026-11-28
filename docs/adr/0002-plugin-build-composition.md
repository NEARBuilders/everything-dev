# ADR 0002: Plugin build composition — one standard rspack stack, inspectable via factory return

Date: 2026-09-18
Status: Accepted

## Context

`Plugin review comment (PR #109, api/rspack.config.js): "Would it make sense to combine EmitPluginManifest, EveryPluginBuild, FixMfDataUriPlugin together?"`

After the v2 toolchain (Rspack 2.2 / MF 2.9) the plugin build surface was 7 byte-similar `rspack.config.js` files (`plugins/{auth,proposals,votes,apps,_template}` + `api`), each repeating the same shape:

```js
plugins: [new EmitPluginManifest(), new EveryPluginBuild({ dts: false }), new FixMfDataUriPlugin(), DrizzleORMMigrations()],
```

The three `every-plugin/build/rspack` plugins are only meaningful composed: `EveryPluginBuild` configures Module Federation (output, loaders, shared deps) from `package.json`; `EmitPluginManifest` reads `types/contract.d.ts` produced by a separate `build:types` step and emits `plugin.manifest.json` + the contract asset; `FixMfDataUriPlugin` patches an MF runtime data-URI resolution quirk. Enumerating them per config was copy-paste orchestration: any framework fix (a fourth plugin, an ordering fix) had to touch 7 files, and the files are `bos sync`-owned so local edits are eventually clobbered anyway.

## Decision

- **The framework owns the composed stack.** `every-plugin/build/rspack` now exports `EveryPluginComposedBuild`, which applies `EmitPluginManifest` → `EveryPluginBuild` → `FixMfDataUriPlugin` in exactly the pre-existing order. Manifest options and `dts` are passthrough options. The individual plugin classes remain exported for custom stacks.
- **The factory return value is the inspection surface.** `createPluginBaseConfig({ drizzle?, externals? })` returns the concrete rspack config object (same shape as the old `baseConfig` export) rather than opaque magic — consumers can spread/audit/override it like any rspack config. Drizzle migration emission is auto-detected via an optional `@proj-airi/unplugin-drizzle-orm-migrations` peer; `drizzle: true` is an explicit opt-in that throws when the peer is missing.
- **Deploy wrapping is a framework helper too.** `everything-dev/integrity` exports `withPluginDeploy(baseConfig, { bosConfigPath, deployLabel?, urlField?, integrityField? })`: no-ops unless `DEPLOY === "true"`, wraps the Zephyr hook, computes SRI, and reports to `bos.config.json` — deriving the url field from `findPluginKey` (plugin workspace) or explicit `urlField` (api → `app.api.production`). This collapsed api's divergent config into the same three lines.
- **Sequencing invariant, now documented where it belongs:** `EmitPluginManifest` reads `types/contract.d.ts`, which is emitted by running the contract tsc step *before* rspack builds. The compose CLI (ADR 0003) owns that ordering; hand-written configs that skip it lose the manifest.

## Build output invariants

Four settings in the composed build are deliberate, each paid for by a failure:

- **`output.clean` is off in watch mode.** The dev serve static handler serves
  `dist/`; cleaning on every rebuild opens a window where `remoteEntry.js` 404s
  for any consumer loading mid-rebuild.
- **`optimization.splitChunks` is off.** rspack 2.x splitChunks re-ids the
  final chunk graph while federation's get-factory codegen keeps pre-split ids,
  so the entry references chunks that were never emitted
  (`ChunkCompletenessPlugin`'s failure mode).
- **`optimization.moduleIds` is `"named"`.** The deterministic default hashes
  module identifiers that embed absolute resource paths, so the same source
  builds to different id spaces on different machines (deploy train vs the
  image's dist-builder stage). A mixed-generation load then splices two
  incompatible id spaces and fails with `__webpack_modules__[r] is not a
  function`. Named ids derive from context-relative requests.
- **Resolution is source-first unless `DEPLOY=true`.** The `development` export
  condition is first in `conditionNames` for local flows and stripped for
  deploy-identical builds; `NODE_ENV` cannot gate this because the rspack CLI
  defaults it to `production` for every `build`, including local watch.
  `byDependency` entries inherit the root conditions, so the strip has to reach
  them too. With source-first on, `extensionAlias` maps node-style `.js`
  specifiers to on-disk `.ts` (`.js` stays first so packages that ship both an
  `index.ts` and a real JS entry keep their JS entry), and `package.json`
  resolves as a JSON module rather than JavaScript.

## Consequences

- A build-fix lands in one upstream file, not seven configs; `bos sync` clobbering stops being a maintenance hazard because there is almost nothing sync-owned left to sync.
- Per-workspace rspack configs that need real customization (e.g., the future native targets) can still spread `createPluginBaseConfig()` — no lock-in.
- The composed plugin appears as one named plugin (`EveryPluginComposedBuild`) in rspack diagnostics/infrastructure logs; name it when debugging.
- `FixMfDataUriPlugin` is now unconditionally on for composed stacks — correct, since it is a framework-wide MF correctness fix, not a per-workspace decision.
