# Plan 028: `App()` descriptor — authored `app.ts`, generated `bos.config.json`, sync retired

> **Executor instructions**: Follow step by step; run every verification
> command; STOP conditions below. Update your status row in
> `advisor-plans/README.md` when done.
>
> **Drift check**: `git diff --stat 00d162cb..HEAD -- packages/everything-dev/src/publish.ts
> packages/everything-dev/src/cli packages/everything-dev/src/merge.ts bos.config.json`.
> Prerequisites: plans 025 and 026 merged (the `ui/` shape the descriptor
> absorbs must be stable). ADR 0005 (`docs/adr/0005-app-ts-authored-descriptor.md`)
> and `plans/beta-v2/composable.md` are the design sources — read both before
> starting.
>
> **2026-09-21 amendment**: the plugin shape the descriptor absorbs is
> ADR 0008's manifest shape (standard route files + generated
> `manifest.gen.json`/`route-config.gen.ts`, mount registry v2). The
> descriptor's `Plugin(name).path()` surface is unchanged, but the `ui`
> constructor describes plugin workspaces consuming manifests, and plan 033's
> prototype `apps.ts` (minimal shape-of-028 descriptor) is prior art for the
> composition-resolver slice — its ergonomics were already smoke-tested there.
> SSR execution is governed by ADR 0007 (runtime composition, source manifests
> in dev).

## 2026-09-23 amendment — Phase 0 demo shipped (flat files, import-extends ratified)

The descriptor demo executed on `feat/platform-cdn` (the branch carrying plan 029), before 034 — a deliberately thin slice:

- **The `descriptor/` module is production code** (`src/descriptor/{constructors,schema,resolve}.ts`, landed `3e21334fb`): `App`/`API`/`UI`/`Plugin(name).path()/.extends()`, zod-validated pure data, `toConfigInput` (authored shape — pipeline fields never authored), `resolveApp`/`resolveApps` (registry + depth-1 extends + deploy-map injection).
- **`extends` now also accepts an imported App descriptor value** — an imported parent is an inlined parent: identical materialization to a fetched one, no FastKV call. Cross-repo stays `bos://` (the composable.md invariant stands: a child publish never builds the extends target; the host never executes a tenant's app.ts). Depth-1 guard applies to both forms.
- **`applyDevOverlay`** — the `bos.dev.ts` surface: child-wins overlay merged over a resolved config at dev time; never published.
- **`Plugin(name)` extra may override the attachment `name`** — the registry key and the plugin's package name differ (`auth` vs `@everything-dev/auth-plugin`); the authored shape keeps them distinct, and resolve strips a redundant name (identical to the registry key) to match today's file.
- **The repo demo (flat, no directories moved)**: root `bos.app.ts` (the everything.dev runtime — this fork's workspaces under dev.everything.near, the post-merge shape), `bos.citynode.app.ts` (extends the base **by import**, porting every authored field of today's `bos.config.json`), `bos.dev.ts` (overlay example). Zero new workspaces; `path()` resolves relative to the declaring file.
- **Golden fixture test** (`app-descriptor-golden.test.ts`): flatten(citynode) deep-equals today's hand-maintained `bos.config.json` after (a) stripping pipeline fields (production/integrity/ssr/ssrIntegrity) and (b) mirroring `cleanNullSentinels` on the top-level `plugins` record only (the merge drops empty-object fields there — today's hand-written `variables: {}` entries are noise the generator omits; the 028 Step 3 upgrade codemod cleans the file). Two latent findings fixed en route: the Plugin name clobber, and secret-array union semantics (the base declares composition; the deploying child owns its secret surface).
- **Demo simplification**: the base declares no workspace secrets/variables detail (the deploying runtime owns them); the real everything.dev published config (fetched from FastKV at bos://dev.everything.near/everything.dev) carries the old release train (effect 3 / orpc 1.x) and extra fields (`shared` map, `sidebar`) the schema absorbs post-034.
- The full 028 execution (CLI reads the descriptor, publish writes generated config, sync deletion) remains gated on 034 — unchanged.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: done/025-landing-carve-out.md, done/026-shell-into-host.md (superseded by the manifest-first rework — ADR 0007/0008; see 034)
- **Category**: architecture / dx / migration
- **Planned at**: commit `00d162cb`, 2026-09-18

## Why this matters

The platform's configuration surface keeps accreting on `bos.config.json`
(`publish.auth`, `deploy.cdn`, `plugins.<id>.ui.ssr`, ci, staging…), each
field hand-maintained JSON with no types, plus three framework-owned sync
files to keep workspaces conformant. ADR 0005's destination: one authored
`app.ts` per repo — a pure typed descriptor that `bos dev`/`bos build`/
`bos publish` import and execute from; the published JSON is generated, never
hand-edited; `sync`/`snapshot`/`merge` are deleted because there is nothing
left to synchronize. This plan implements that destination for v2, including
the `resources`/`stage`/`bindings` fields that plans 031/032 provision.

## Current state

- Design commitments (verified excerpts):
  - `plans/beta-v2/composable.md:129-151`: "`App(...)` returns a pure typed
    descriptor. `bos dev` and `bos publish` import it and do the work. The
    descriptor IS the deployment plan — no config scanning, no conventional
    discovery." And: "The host reads the published config — it never
    executes a tenant's `app.ts`" (`composable.md:30`).
  - Constructor surface (`composable.md:92-101`): `App({...})`,
    `API({path, plugins})`, `Plugin(name).path(p)` / `.extends(ref)`,
    `BetterAuth({extends})`, UI constructor (`TanStackStart({path})` — after
    plan 026 the ui constructor describes plugin workspaces: rename target
    `Ui()` or keep the name; keep `Plugin(name).path()` semantics).
  - Type source (`composable.md:155-172`): generated
    `.bos/plugin-types.d.ts` declares `module "everything-dev" { interface
    KnownPlugins { registry: typeof _registry; ... } }` so `Plugin("bogus")`
    is a compile error; `Plugin(name)` returns `PluginBuilder<KnownPlugins[K]>`
    whose `PluginRef` carries the contract type.
- Today's implementation:
  - `packages/everything-dev/src/publish.ts` reads `bos.config.json`
    (`loadResolvedConfig`), validates via `BosConfigSchema`
    (`src/types.ts`), merges `extends` (`src/merge.ts`), submits to FastKV
    (`near-signer.ts`) with per-deploy manifests (#120).
  - `packages/everything-dev/src/cli/sync.ts`, `cli/snapshot.ts`,
    `src/merge.ts` exist (verified) — the sync machinery to retire.
  - `packages/everything-dev/src/app.ts` already exists (provides
    `PortAllocator`, imported by `infra/planner.ts`) — the descriptor module
    joins it or lives beside it (`src/app-descriptor.ts`); do not collide.
  - `bos upgrade` runs sync + version bumps (`cli.ts`).
  - This repo's own `bos.config.json` is the porting source (account
    `v1.citynode.near`, domain `citynode.app`, extends chain, plugins, ci).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun typecheck` | 8/8 workspaces pass |
| Lint | `bun lint` | exit 0 |
| Framework tests | `bun run --cwd packages/everything-dev test` | all pass |
| Descriptor boot | `bos dev` | services up, config resolved from app.ts |
| Publish dry run | `bos publish --dry-run` | status dry-run, generated config matches |

## Scope

**In scope**:
- `packages/everything-dev/src/app-descriptor.ts` (create: `App`, `path`,
  `Plugin`, `Alchemy.*` resource factories, zod mirror, types)
- `packages/everything-dev/src/cli.ts`, `src/publish.ts`, `src/build.ts`,
  `src/config.ts` (descriptor → resolved `RuntimeConfig` loading)
- `packages/everything-dev/src/cli/sync.ts`, `cli/snapshot.ts`,
  `src/merge.ts` + their CLI verbs (delete)
- `app.ts` (create — this repo's platform descriptor)
- `.bos/` generated-config writer; `AGENTS.md`; changeset (minor/breaking)

**Out of scope**:
- Alchemy materialization (plan 031 — descriptor fields only here)
- Host runtime config reading (host keeps reading JSON — invariant)
- Child-repo scaffold rewrite (advisor plan 020 consumes this later)

## Git workflow

- Branch: `feat/app-descriptor`. Conventional commits:
  `feat(everything-dev): App() descriptor — authored app.ts, generated config`.
- Breaking removal of `bos sync` ships behind a changeset with explicit
  migration note; the operator decides the release moment.

## Steps

### Step 1: Descriptor module + types

`packages/everything-dev/src/app-descriptor.ts`:
- `App({...})` — fields: `account`, `domain`, `extends?`, `stage?`
  (`"workshop" | "sandbox" | "production"`), `head?` (title/description/
  icon/theme — plan 026 made head host-owned; descriptor feeds it),
  `publish?` (`auth` gate from #120), `deploy?` (`cdn` provider — plan 029
  adds `"platform"`), `resources?` (`{ db?: AlchemyDatabase, storage?:
  AlchemyStorage, ... }` — **pure data factories** returned by
  `Alchemy.Database({...})` / `Alchemy.Storage({...})`; no alchemy import
  here — resource descriptors are plain objects tagged for the provisioner),
  `workspaces` (`{ [key]: path(dir, { variables?, secrets?, bindings?,
  ui? }) }`), `plugins` (`Plugin(name).path()/.extends()` refs typed by
  `KnownPlugins`).
- `bindings: { db: "db" }` validated as `keyof typeof resources` — compile
  error on unknown keys.
- Zod mirror of every field (publish-time validation), full inference types
  (`satisfies` pattern; never annotate inferred descriptor values).

Generate the `KnownPlugins` declaration-merging file from
`bos types gen` (extend `packages/everything-dev/src/plugin.ts`'s
`writeGeneratedFiles` to also emit `.bos/plugin-types.d.ts`).

**Verify**: `bun typecheck` → 0 errors; a scratch descriptor test asserts
`Plugin("bogus")` is a `@ts-expect-error` and `app.api.plugins.registry`
carries the contract type (pattern from `composable.md:129-147`).

### Step 2: CLI reads the descriptor

- `bos dev` / `bos build` / `bos publish` import `<configDir>/app.ts` (bun
  executes TS natively — bin entry `packages/everything-dev/src/cli.ts`
  already runs under bun), validate via the zod mirror, and resolve to the
  existing `RuntimeConfig` (reuse `buildRuntimeConfig`/resolved-config
  machinery; write `.bos/bos.config.resolved.json` for the host).
- `extends` resolution: fetch published parent from FastKV at resolve time
  (reuse `fetchBosConfigFromFastKv`), depth-capped per wayfinder ticket 08
  (depth ≤ 5, publish-time flattening).
- Keep `bos.config.json` reading as a deprecated fallback path during the
  transition; log a warning when used.

**Verify**: `bos dev` boots this repo from `app.ts` with all services up;
`bos publish --dry-run` → generated payload fixture-diff-equal to the
hand-maintained config (add a fixture test).

### Step 3: Port this repo; delete sync

- Write the platform `app.ts` (port every field from `bos.config.json`).
- Delete `cli/sync.ts`, `cli/snapshot.ts`, `src/merge.ts` and the `sync`
  CLI verb; reduce `bos upgrade` to: bump catalog/workspace deps, run
  codemods, refresh published refs (no sync step). Update AGENTS.md
  (workflows, "What Gets Removed" table in `plans/beta-v2/overview.md` is
  now realized — note it), changeset (breaking: `bos sync` removed; children
  migrate via `bos upgrade` codemod that converts `bos.config.json` →
  `app.ts`).

**Verify**: `grep -rn "snapshot\|merge" packages/everything-dev/src/cli` →
no sync/snapshot references; full `bun run test` green.

## Test plan

- New: descriptor validation tests (zod mirror), KnownPlugins negative
  typing (`@ts-expect-error`), resolved-config fixture equality, extends
  depth cap, `bindings` keyof validation.
- Existing: publish/build suites updated to consume the resolved config
  (behavior unchanged once loaded).

## Done criteria

- [ ] `bun typecheck` 8/8; `bun lint` clean; `bun run test` green
- [ ] `bos dev` + `bos publish --dry-run` work from `app.ts` in this repo
- [ ] `packages/everything-dev/src/{merge.ts,cli/sync.ts,cli/snapshot.ts}`
      deleted; `bos sync` verb gone; upgrade reduced
- [ ] Generated `.bos/plugin-types.d.ts` emitted by `bos types gen`
- [ ] Changeset + AGENTS.md updated; README row updated

## STOP conditions

- Any consumer (host boot, CI workflows, regression harness) still requires
  the sync machinery at deletion time — report the dependency; do not keep
  `merge.ts` alive "temporarily".
- Descriptor inference collapses (TS7 serialization limits) on the full
  platform descriptor — report; consider splitting the workspaces field
  rather than loosening types.
- The published-config fixture cannot be made equal (extends flattening
  semantics differ from today's merge) — this is the riskiest equivalence;
  report with the differing fields.

## Maintenance notes

- Plans 031/032 consume `resources`/`stage` — keep resource descriptors pure
  data; alchemy stays materializer-side.
- The resolved-config writer is the single source of truth for the host
  contract; reviewers should diff it against `BosConfigSchema` on every
  change.
- Follow-up (deferred): `App.run()`/`App.dev()` Effects reusing the start/dev
  logic (composable.md future note).
