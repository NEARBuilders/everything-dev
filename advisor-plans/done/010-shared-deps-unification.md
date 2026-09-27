# Plan 010: One shared-dependency source of truth for runtime and build

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9ca44e1..HEAD -- packages/every-plugin/src/runtime/mf-config.ts packages/every-plugin/src/build/shared-deps.ts packages/every-plugin/src/build/rspack/module-federation.ts packages/every-plugin/tests/unit/mf-config-sync.test.ts host/rsbuild.config.ts`
> If any in-scope file changed since this plan was written (plan 006 touches `shared-deps.ts` — its deletions are expected drift), compare "Current state" against live code; on a mismatch beyond that, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/006-stale-surface-purge.md (same file; land 006 first)
- **Category**: tech-debt
- **Planned at**: commit `c9ca44e1`, 2026-09-15

## Why this matters

Two parallel systems describe the Module Federation shared-dependency set: the **runtime** system (`packages/every-plugin/src/runtime/mf-config.ts`) and the **build** system (`packages/every-plugin/src/build/shared-deps.ts`). Both list the same six packages (every-plugin, effect, zod, @orpc/contract, @orpc/client, @orpc/server), each with its own near-identical `getInstalledPackageVersion` resolver whose fallbacks already differ subtly. They are held in lockstep only by a dedicated sync test (`mf-config-sync.test.ts:54-64`) — a pure duplication tax. Adding a core shared dep (the exact operation the Effect 4 migration performed) requires editing two lists or you get the host/plugin share-scope mismatch documented in AGENTS.md's `ModuleFederationError` troubleshooting entry.

## Current state

- `packages/every-plugin/src/build/shared-deps.ts` — the build side: `pluginSharedDependencies` (lines ~36-56, the six packages with `DEFAULT_SHARE_CONFIG`: `requiredVersion: false, singleton: true, strictVersion: false, eager: false`), `getInstalledPackageVersion(packageName, fallbackVersion)` (lines ~58-80, fallback = `extractExactVersion` — matches `\d+\.\d+\.\d+(?:-...)?` or strips range chars), plus `getMajorMinorVersion` (prerelease-preserving after commit `59f98792`).
- `packages/every-plugin/src/runtime/mf-config.ts` — the runtime side: `MF_CORE_SHARED_DEPS` (lines ~17-33, same six packages) plus its **own** `getInstalledPackageVersion` (lines ~52-83) whose fallback differs: `fallbackRange.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)` with a different no-match branch (`fallback.replace(/^[\^~>=<\s]+/, "")` — note the `\s`, absent from the build copy).
- `packages/every-plugin/tests/unit/mf-config-sync.test.ts:54-64` — asserts the two lists and versions stay aligned.
- `packages/every-plugin/src/build/rspack/module-federation.ts:4-5` — `buildSharedDependencies(_pluginInfo)` ignores its `PluginInfo` argument entirely.
- `host/rsbuild.config.ts:110-160` — the host keeps a **third** partial copy: `getInstalledVersion` (walks `require.resolve` like the others) + `pluginShared` listing the same packages, with `SHARE_DEFAULTS.requiredVersion: false`. (Scope note: the host copy composes with bos.config-declared shared maps and has different concerns — see Out of scope.)
- Catalog: `package.json` → `workspaces.catalog` pins `@module-federation/*` at `^2.4.0`; hoisted resolution currently yields 2.9.0 everywhere (verified during the migration).
- Conventions: no comments in implementation; conventional commits.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all) | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| every-plugin unit / integration / dist | `cd packages/every-plugin && bun run test:unit` / `bun run test:integration` / `bun run build` | 67+ / 27 / success |
| Host tests | `bun run --cwd host test` | 150 pass + 2 known deploy-gated |
| MF lockstep check | build all plugin dists + compare manifests | all report the same `@module-federation` version |

## Scope

**In scope**:
- `packages/every-plugin/src/build/shared-deps.ts` (becomes the single source)
- `packages/every-plugin/src/runtime/mf-config.ts` (derives from it)
- `packages/every-plugin/tests/unit/mf-config-sync.test.ts` (kept as the guard)
- `packages/every-plugin/src/build/rspack/module-federation.ts` (only if the ignored `_pluginInfo` param cleanup is trivial)

**Out of scope**:
- `host/rsbuild.config.ts` — the host's `getInstalledVersion` + `pluginShared` block. It composes bos.config shared maps with different merge semantics; consolidating it across package boundaries (host consuming every-plugin's build module) is a bigger API decision. Record it in the plan report as the known remaining copy.
- `getMajorMinorVersion` semantics (settled in commit `59f98792`).
- The `requiredVersion: false` strategy (settled).

## Git workflow

- Branch: `improve/010-shared-deps-unification`.
- Commit style: `refactor(every-plugin)!: runtime mf-config derives from build shared-deps`.
- Do NOT push unless instructed.

## Steps

### Step 1: Export a runtime-shaped view from `shared-deps.ts`

In `packages/every-plugin/src/build/shared-deps.ts`, export:

```ts
export const CORE_SHARED_PACKAGE_NAMES = ["every-plugin", "effect", "zod", "@orpc/contract", "@orpc/client", "@orpc/server"] as const;
export function resolveCoreSharedVersions(): Record<(typeof CORE_SHARED_PACKAGE_NAMES)[number], string>
```

built on the existing `pluginSharedDependencies` (single list, single resolver, single fallback policy — keep `extractExactVersion`). Decide the fallback behavior explicitly: the build copy's `extractExactVersion` wins (it handles prereleases identically; the runtime copy's extra `\s` in its strip regex is not a behavior anyone depends on — verify by reading both fallback paths once more before deleting).

**Verify**: `cd packages/every-plugin && bunx tsc --noEmit -p tsconfig.json` → exit 0.

### Step 2: Derive `MF_CORE_SHARED_DEPS` from it

In `packages/every-plugin/src/runtime/mf-config.ts`, delete the local `getInstalledPackageVersion` (lines ~52-83) and the hand-maintained `MF_CORE_SHARED_DEPS` literal (lines ~17-33); derive the runtime shape from `CORE_SHARED_PACKAGE_NAMES`/`resolveCoreSharedVersions()` (mind the import direction: runtime importing from `../build/shared-deps` — check for any circular-import risk with `grep -n "runtime" packages/every-plugin/src/build/shared-deps.ts`; there is none expected since build doesn't import runtime).

**Verify**: `cd packages/every-plugin && bun run test:unit` → 67+ pass (the sync test now asserts derivation rather than duplication — it should still pass unchanged; if it asserted the literal shapes, update it to assert `resolveCoreSharedVersions()` keys match `CORE_SHARED_PACKAGE_NAMES` and versions match installed reality).

### Step 3: Prove lockstep end to end

Rebuild every-plugin dist, rebuild the plugin dists (`for p in _template apps votes proposals auth; do (cd plugins/$p && bun run build); done` and `cd api && bun run build`), then verify every `mf-manifest.json` reports the same `@module-federation` runtime version (the migration established all report `2.9.0`):

```bash
for m in api/dist/mf-manifest.json plugins/*/dist/mf-manifest.json; do
  python3 -c "import json; print('$m', json.load(open('$m'))['metaData']['pluginVersion'])"
done
```

**Verify**: all manifests print the same version; `bun run --cwd host test` → 150 pass + 2 known (the integration `mf-loading` tests are the behavioral guard).

### Step 4: Full gates

**Verify**: `bun typecheck && bun lint` → exit 0; every-plugin unit + integration green.

## Test plan

- Keep `mf-config-sync.test.ts` as the guard (updated per Step 2 if needed).
- Add one unit case: `resolveCoreSharedVersions()` returns a defined version string for every `CORE_SHARED_PACKAGE_NAMES` entry (catches a rename/drop of a peer dep during future dependency bumps).

## Done criteria

- [ ] `grep -n "getInstalledPackageVersion" packages/every-plugin/src/runtime/mf-config.ts` → no matches (one resolver total, in shared-deps.ts)
- [ ] `MF_CORE_SHARED_DEPS` (or its successor) is derived, not duplicated — the six package names appear in exactly one list in every-plugin src
- [ ] All plugin + api manifests agree on the MF runtime version after rebuild
- [ ] `bun typecheck`, `bun lint`, every-plugin (67+/27), host (150+2 known) pass
- [ ] Changeset added (every-plugin minor)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- runtime→build import creates a cycle or pulls build-only deps (rspack imports) into the runtime bundle — report; the fallback is extracting the shared core into a new `src/shared-deps-core.ts` both sides import.
- The sync test asserted behaviors that differ between the two resolvers today (i.e. the "subtle fallback difference" is load-bearing for some scenario) — characterize it with a test first and report.
- Manifest versions disagree after the change (would indicate the derivation altered resolution).

## Maintenance notes

- The remaining third copy is `host/rsbuild.config.ts:110-160` — a future plan could have the host consume `resolveCoreSharedVersions()` from every-plugin's build export; note it in the index as deferred.
- When a new core shared dep is added (e.g. `@tanstack/react-query` joining the singleton set), the single list is the only edit plus the catalog.
