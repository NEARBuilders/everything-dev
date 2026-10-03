# Plan 023: Typed mount contract — `defineUiPlugin` with a `MountId` union

> **Executor instructions**: Follow step by step; run every verification
> command; STOP conditions below. Update your status row in
> `advisor-plans/README.md` when done.
>
> **Drift check**: `git diff --stat 00d162cb..HEAD -- packages/everything-dev/src/ui/compose`.
> Prerequisite: plan 021 merged — the compose library must exist on `main`
> (`packages/everything-dev/src/ui/compose/{types,compose,mount-registry}.ts`).
> If `mount-registry.ts` is absent, plan 021 has not landed → STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 021-land-open-train.md
- **Category**: types / architecture
- **Planned at**: commit `00d162cb`, 2026-09-18

## Why this matters

The graft protocol currently keys mounts off a stringly convention: a plugin
tree's pathless layout root whose id segment starts with `_` (e.g. `_public`,
`_dashboard`) is a mount declaration, resolved through the `MOUNT_ALIASES`
map. A typo (`_dashbord`) or an unregistered mount fails silently (route never
grafts) or at runtime. Before plugin authors outside this repo consume the
protocol (plans 024/025, child repos), the mount vocabulary must be a compile
error, not a runtime no-op.

## Current state

Excerpts verified from the merged #121 diff (plan 021 lands this code):

- `packages/everything-dev/src/ui/compose/compose.ts`:
  ```ts
  function deriveMountId(route: AnyRoute): string | undefined {
    const id = (route as MutableRoute).options?.id ?? "";
    const seg = lastSegment(id);
    if (!seg.startsWith("_")) return undefined;
    return MOUNT_ALIASES[seg.slice(1)];
  }
  ```
  `composeApp` walks plugin tree ROOT children; each child whose derived mount
  exists in `collectCoreMounts(coreTree)` gets grafted with a namespaced id
  `` `${plugin.name}__${mount}` `` and `getParentRoute: () => coreRoute`.
- `packages/everything-dev/src/ui/compose/types.ts`: exports `MOUNT_ALIASES`,
  `UiPluginModule { name: string; tree: AnyRoute }`, `NavManifest`.
- `packages/everything-dev/src/ui/compose/mount-registry.ts`:
  `MOUNT_REGISTRY` (canonical mount semantics — gates vs shells) and
  `MOUNT_REGISTRY_VERSION = "2026-09-18.2"` (bump invalidates all compose
  digests).
- Plugin ui modules export their raw generated tree (`export default
  routeTree`); there is no helper — the `_`-id convention is implicit.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun typecheck` | 8/8 workspaces pass |
| Framework tests | `bun run --cwd packages/everything-dev test` | all pass (compose tests incl.) |
| Lint | `bun lint` | exit 0 |

## Scope

**In scope**:
- `packages/everything-dev/src/ui/compose/{mount-registry,types,compose,index}.ts`
- `packages/everything-dev/tests/ui/compose.test.ts` (extend)
- `plugins/_template/` ui tree export (if a ui tree exists post-#121; otherwise
  note it for plan 024)
- `packages/everything-dev/src/ui/compose/digest-version.ts` (version bump)

**Out of scope**:
- `host/src/services/ui-compose.ts` (compose pipeline unchanged — the runtime
  matching stays as the implementation detail behind the typed API)
- Any plugin ui carve-out (024/025)
- `ui/src/routes/**`

## Git workflow

- Branch: `feat/typed-mount-contract`. Conventional commit:
  `feat(everything-dev): typed mount contract for ui plugin grafting`.

## Steps

### Step 1: Export the `MountId` union

In `mount-registry.ts`: derive the union from `MOUNT_REGISTRY`'s canonical
keys, e.g. `export type MountId = "public" | "anon" | "authenticated" | "admin"
| "dashboard"` — use exactly the canonical names `MOUNT_ALIASES` maps onto
(read `types.ts` first; if aliases like `_auth → authenticated` exist, the
union holds canonical names only). Export `MOUNTS: readonly MountId[]`.

### Step 2: Add `defineUiPlugin`

In `compose/index.ts` (or a new `define.ts` re-exported from `index.ts`):

```ts
export interface UiPluginDefinition {
  name: string;
  /** Mounts this plugin declares. Each tree root child must declare one. */
  mounts: readonly MountId[];
  tree: AnyRoute;
}
export function defineUiPlugin<const D extends UiPluginDefinition>(def: D): UiPluginModule {
  // validate at construction: for each root child of def.tree, deriveMountId
  // must yield a value contained in def.mounts ∩ MOUNTS; throw with the child
  // id and the closest valid mount otherwise.
}
```

`composeApp` gains an optional second-consumer path: when a plugin module was
produced by `defineUiPlugin`, use its declared mounts (store them on the
module as a non-enumerable `mounts` field or a WeakMap keyed by module) and
skip re-derivation; keep `deriveMountId` as the fallback for raw trees so
existing exports keep working.

**Verify**: `bun run --cwd packages/everything-dev test` → compose tests pass.

### Step 3: Compile-time negatives + version bump

- Add tests: a definition with `mount: "dashbord"` (typo) is a type error —
  assert with `// @ts-expect-error` in the test file; a definition whose tree
  contains an undeclared `_`-root throws at runtime.
- Bump `MOUNT_REGISTRY_VERSION` in `digest-version.ts` to a new date string
  (graft input semantics changed → all compose digests invalidate).

**Verify**: `bun run --cwd packages/everything-dev test` → all pass; `bun
typecheck` → 0 errors.

## Test plan

- New cases in `packages/everything-dev/tests/ui/compose.test.ts`: declared-
  mount path used over derivation; runtime throw for undeclared root; typo
  rejection via `@ts-expect-error`; raw-tree fallback still composes.
- Pattern: existing compose tests (fixture trees constructed inline).

## Done criteria

- [ ] `bun typecheck` exits 0; `bun lint` exits 0
- [ ] `bun run --cwd packages/everything-dev test` green incl. new tests
- [ ] `grep -n "MOUNT_REGISTRY_VERSION" packages/everything-dev/src/ui/compose/digest-version.ts`
      shows a value newer than `2026-09-18.2`
- [ ] `defineUiPlugin` exported from `everything-dev/ui/compose`
- [ ] No files outside in-scope list modified; README row updated

## STOP conditions

- `MOUNT_ALIASES`/`MOUNT_REGISTRY` differ from the described shape.
- Making `defineUiPlugin` typed requires changing the graft pipeline's cache
  keys beyond the version bump (report — cache semantics are plan-021/026
  territory).

## Maintenance notes

- Plans 024/025 use `defineUiPlugin` for their tree exports; keep the
  signature additive.
- When a third-party plugin author surfaces (child repos), this union is the
  compat contract — version it deliberately via `MOUNT_REGISTRY_VERSION`.
