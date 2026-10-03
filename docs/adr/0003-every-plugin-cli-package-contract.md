# ADR 0003: `every-plugin` CLI is the plugin package contract — scripts derive from framework defaults

Date: 2026-09-18
Status: Accepted (amended 2026-09-26 — the contract-declaration mechanism changed: `tsc -p tsconfig.contract.json` / `build:types` are gone. `EmitPluginManifest` inside `every-plugin build`/`deploy`/`dev` regenerates `types/contract.d.ts` whenever `src/contract.ts` is newer (patched TS 7 binary, explicit flags). There is no `tsconfig.contract.json` anywhere and `bos sync` no longer ships one. The decision itself — manifest ordering is the CLI's job, not package scripts — is unchanged; see ADR 0005 phase 2.)

## Context

`Plugin review comment (PR #109, plugins/proposals/package.json): "everything-dev or every-plugin? or should we have a broader architecture play that also combines build:types? We're trying to make the config groupings good, so the necessary code available to edit is comfortable and still have all the necessary abilities, but the framework is cohesive and efficient. Effect.TS idiomatic."`

Every plugin and the api workspace carried an identical copy-pasted script chain, differing only in an `extra` env var:

```json
"build": "bun run build:types && rspack build",
"build:types": "tsc -p tsconfig.contract.json",
"deploy": "bun run build:types && DEPLOY=true rspack build",
"dev": "bun run build:types && every-plugin-serve"
```

The `build:types → tsc → rspack` ordering existed only because `EmitPluginManifest` reads `types/contract.d.ts` (ADR 0002's invariant) — a framework internal leaked into five package.jsons. And the `bos` orchestrator invokes services through workspace `scripts.dev` and builds through `scripts.{build,deploy}`, so scripts are the real API of a plugin package; that API should be one thing, not five hand-synced lines.

## Decision

- **`every-plugin <verb>` is the canonical surface** for `dev | types | build | deploy`. The CLI:
  - runs `tsc -p tsconfig.contract.json` first (no-op when absent), making the manifest-ordering invariant the CLI's job;
  - `build`/`deploy` spawn `rspack build` against the workspace's `rspack.config.js`;
  - **config-less is now the default** — with no `rspack.config.js`, the CLI synthesizes `.every-plugin/rspack.config.generated.mjs`: `createPluginBaseConfig` (ADR 0002) merged with an optional `build.config.ts` partial override, wrapped by `withPluginDeploy` (from `everything-dev/integrity`) when `bos.config.json` is reachable by walking up from the workspace. Deploy without a reachable `bos.config.json` refuses with instructions, since integrity reporting would silently vanish.
- **Ownership boundary:**
  - `every-plugin` owns the plugin lifecycle: contract types, rspack composition, dev serve, verbs.
  - `everything-dev` owns production concerns across workspaces: zephyr wrapping, integrity/SRI writes, `bos.config.json` reporting, publish orchestration (`bos publish --deploy` shells `scripts.deploy`, so the contract holds either way).
- **Plugin package.json scripts shrink to**: `"build": "every-plugin build"`, `"deploy": "every-plugin deploy"`, `"dev": "every-plugin dev"` plus test/typecheck/db verbs. `build:types` is no longer a public script; `tsconfig.contract.json` ships in the workspace only because the CLI's `types` step pointed at it by convention — moving it inside the framework is phase 2 (ADR 0005).
- The `bos` service-descriptor/build pipeline is unchanged — it already keys off `scripts.dev` / `scripts.{build,deploy}`, now pointing at the CLI.

## Consequences

- Adding a plugin = a package.json with 3 one-liner build scripts. rspack configs that remain are pure overrides (typical plugin ships none); the 5-line script chains, the `tsconfig.contract.json` boilerplate chains and cross-workspace drift between templates are gone.
- The Effect idiom this review comment asked for is scoped honestly: the *pipeline* (descriptor → build plan → spawn → deploy → integrity, ADR 0005) is Effect-native because it orchestrates async resources with lifecycle; the CLI verb layer is a thin spawn shell over Effect-free process control, which would be ceremony without value at this seam.
- `every-plugin` requires bun for CLI execution (`import src/*.ts`), consistent with the bos toolchain (`bos` itself is bun-first).
