# ADR 0022: Two roots — the self-contained app root and the workspace frame

Date: 2026-10-03
Status: Accepted

## Context

A bos app is fully self-contained in its **app root**: the directory holding the authored
`bos.app.ts` / `bos.dev.ts` pair. Every app fact anchors there — workspace `local:` paths
resolved relative to it, the generated `bos.config.json`, `.bos/` state, `.env` /
`.env.example` / `.env.test`, `docker-compose.yml`, the resolved-config snapshot. Nothing
outside the app root is app state.

But a bos app also lives inside a bun monorepo with a second root: the nearest ancestor
`package.json` declaring `workspaces` — the **workspace root**, which owns the catalog
(`workspaces.catalog`), `bun.lock`, `node_modules`, dependency installs, and framework
package dists.

Every generated child repo is flat, so the two roots coincide and the CLI could (and did)
use one directory for both. That conflation produced latent bugs:

- The prerequisite train (`buildPackageQuietly`) resolved framework packages as
  `${configDir}/packages/<name>` — an app-frame join for a workspace-frame fact — and
  **silently skipped** when the path didn't exist, shipping stale dists with no error.
  The prerequisite package list (`every-plugin`, `everything-dev`, `better-near-auth`)
  was hardcoded next to it, duplicating facts already declared as workspace dependencies.
- `bun install` ran at the config dir, catalog reads and writes
  (`shared-deps.ts`, `framework-version.ts`, `cli/upgrade.ts`, `cli/sync.ts`) assumed
  configDir == workspace root, and the re-exec `bos` bin resolved from the config dir's
  `node_modules` — all correct only by coincidence of flatness.
- Config discovery (`findConfigPath`) walked up only, so an app root nested below the
  invocation directory (e.g. a repo that keeps its app under `app/`) was invisible, and
  callers compensated by threading env hints (`BOS_CONFIG_PATH`) through scripts.

## Decision

1. **Two roots, one primitive each.** The app root is discovered by `findConfigPath`
   (existing walk-up). The workspace root is discovered by `findWorkspaceRoot` — the
   nearest ancestor `package.json` declaring `workspaces` — memoized like
   `findConfigPath`. No env vars, no flags, no layout literals.

2. **Concern classification.** App-frame concerns anchor to the app root: config pair,
   `.bos/` state, env materialization, compose, `local:` workspace paths, generated type
   destinations, publish. Workspace-frame concerns anchor to the workspace root: `bun
   install`, catalog reads/writes, `node_modules` reads, framework package dists,
   version bumps, workspace enumeration. Every workspace-frame site resolves the root
   through `findWorkspaceRoot(dir)?.dir ?? dir`; in flat repos (all children today) this
   is behavior-identical.

3. **The prerequisite train is a derived dependency graph.** `ensureFreshDeps` replaces
   `buildPackageQuietly` and the hardcoded `quietBuildPackages` list. The graph's edges
   are the workspaces' declared `dependencies` + `devDependencies` whose names are
   workspace members (`localDepsOf` — pure, plain-data, targets excluded unless they are
   another target's dependency). A member's dist freshness is judged by its own
   `package.json` export oracle (`exports["."]` → `import`/`default`/`require`/`types`,
   else `module`/`main`, else the `dist/build-report.json` entry) via the existing
   mtime staleness check. Stale members build in parallel; **failures aggregate into a
   typed `DepsBuildFailure` — never a silent skip.** Children (framework installed from
   the registry, no members) get an empty closure and a no-op.

4. **The module is the seam.** The workspace frame is one module,
   `packages/everything-dev/src/workspace.ts`: two verbs (`findWorkspaceRoot`,
   `ensureFreshDeps`), one pure function (`localDepsOf`, also the test surface), four
   types (`WorkspaceMember`, `WorkspaceRoot`, `DepsReport`, `DepsBuildFailure`). All
   enumeration, oracle derivation, staleness, and execution are implementation.

5. **`BOS_CONFIG_PATH` is retired.** The host resolves its config through its own
   `__dirname`-relative fallback chain (`../.bos/bos.resolved-config.json`, then
   `../bos.config.json`), which holds because the host workspace always sits directly
   under the app root; the bundle-fetch identity falls back to `BOS_ACCOUNT` /
   `BOS_GATEWAY`. Scripts no longer thread the env var.

6. **The unit-move invariant.** If an app root is ever relocated (e.g. everything under
   `app/`), it moves as a unit: workspaces, the config pair, `.env*`, compose, and
   `.bos/` state together. App-frame literals are configDir-relative, so moving the unit
   breaks nothing once the workspace-frame sites resolve their own root; moving
   workspaces without the config pair breaks them all.

## Consequences

- A nested app root needs no CLI changes — only the unit-move invariant, plus config
  discovery from above (a bounded probe is the one remaining gap; not needed while the
  parent repo stays flat).
- The prerequisite list is now declarative: adding a framework package with a fresh-dist
  contract requires only that dependents declare it — no train edits.
- Host tests and the container fixture no longer depend on `BOS_CONFIG_PATH`; the
  fallback chain prefers `.bos/bos.resolved-config.json`, which is what the fixture
  wrote explicitly anyway.
- Dev bootstrap builds the same three framework packages in any realistic session
  (every local workspace declares them), but only when actually stale or declared —
  e.g. an api-only session no longer builds `better-near-auth`.
