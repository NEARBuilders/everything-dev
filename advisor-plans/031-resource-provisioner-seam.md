# Plan 031: `ResourceProvisioner` seam — generalize infra planning; alchemy materializer

> **Executor instructions**: Follow step by step; run every verification
> command; STOP conditions below. Update your status row in
> `advisor-plans/README.md` when done.
>
> **Drift check**: `git diff --stat 00d162cb..HEAD -- packages/everything-dev/src/infra
> packages/everything-dev/src/app.ts`. Prerequisite: plan 028 merged (the
> descriptor's `resources`/`stage`/`bindings` fields exist). If
> `app-descriptor.ts` is absent, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: 028-app-ts-descriptor.md
- **Category**: architecture / direction
- **Planned at**: commit `00d162cb`, 2026-09-18

## Why this matters

`packages/everything-dev/src/infra/` is already an Effect-native plan→
materialize pipeline (`InfraPlan` with ordered `InfraPhase`s,
`InfraMaterializer` as a `Context.Service`) — but it is hardwired to *local
dev* (docker Postgres, port allocation, env files). The platform needs the
same plan shape materialized by different provisioners per `stage`:
workshop = embedded PGlite (wayfinder ticket 11's resolution), sandbox =
Neon branch + platform storage, production = Neon project + R2 — via
alchemy, which is itself Effect-native (alchemy 2.x peers on effect ≥4,
verified during PR #58). Extracting a `ResourceProvisioner` interface turns
the existing code into one implementation of a seam, and makes the
descriptor's `resources` real without touching app code: **descriptors are
data; provisioners materialize; workspaces receive resolved bindings.**

## Current state

All verified at `00d162cb` (unchanged by 021–028 except descriptor input):

- `packages/everything-dev/src/infra/types.ts`:
  - `InfraPlan { workspaceKey, cliPorts, resolvedPorts, runtimeConfig,
    launch: RuntimeLaunchSpec, envGenerated, composeModel, claims,
    orchestrator: AppOrchestrator }`
  - `InfraPhase = "resolve-config" | "allocate-services" |
    "allocate-databases" | "claim" | "materialize-env" |
    "materialize-compose" | "launch"`; `InfraError extends Data.TaggedError`
    with `phase`
  - `InfraInput.cli` carries `hostSource?/uiSource?/apiSource?/authSource?:
    "local" | "remote"` — the remote-source seam for dev already exists
  - `DatabasePlan { secret, slug, port, dbName, containerName, volumeName,
    url }`, `RedisPlan`, `ComposeModelPlan`
- `infra/planner.ts`: `workspaceKey(configDir)` (sha256-prefix);
  `allocateServices` — Effect.gen, `yield* PortAllocator` service (from
  `../app`), per-plugin port scan, persisted port state.
- `infra/materializer.ts`: `InfraMaterializer extends Context.Service<…>()(
  "InfraMaterializer")` with `materializeTemplate / materializeLocalDevEnv /
  materializeTestInfra / materializeCompose / persistPortState` — Effect
  methods returning `InfraError`.
- `service-descriptor.ts:241`: `AppOrchestrator { packages, description,
  env, port?, interactive?, noLogs? }` — the launch-record seam.
- Binding env handoff: `db/binding.ts` `bindingEnv({ secretName, url })`
  pushes resolved URLs into spawned children ("The process that resolves
  bindings (the CLI composition root) pushes this into spawned children so
  they never re-derive secrets from ambient state" — verified comment).
- Descriptor (post-028): `resources: { db?: AlchemyDatabase, storage?:
  AlchemyStorage }` — pure data; `workspaces.<key>.bindings: { db: "db" }`
  typed `keyof resources`.
- alchemy: Effect-native resource library; PR #58 ran it in a pinned sandbox
  because of the effect-3 pin — that pin is gone (Effect 4 since #97), so a
  direct dependency is now viable; version-pin deliberately (catalog).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun typecheck` | 8/8 workspaces pass |
| Lint | `bun lint` | exit 0 |
| Framework tests | `bun run --cwd packages/everything-dev test` | all pass |
| Dev smoke | `bos dev` | local provisioning behavior unchanged |

## Scope

**In scope**:
- `packages/everything-dev/src/infra/provisioner.ts` (create: interface +
  plan types)
- `packages/everything-dev/src/infra/{planner,materializer}.ts` (adapt into
  `LocalDevProvisioner` — behavior-preserving)
- `packages/everything-dev/src/infra/alchemy/**` (create:
  `AlchemyProvisioner` — stage-mapped)
- `packages/everything-dev/src/cli.ts` / `publish.ts` (pipeline consumes the
  provisioner; resolved bindings → published config + bindingEnv)
- `package.json` catalog (alchemy pin); tests; changeset

**Out of scope**:
- Sandbox *host processes* (plan 032)
- Migration-timing tier switch (workshop boot-migrate vs pre-migrate — fold
  the production mode in here only if trivial; otherwise follow-up)
- Redis provisioning beyond what `LocalDevProvisioner` already does

## Git workflow

- Branch: `feat/resource-provisioner`. Conventional commits:
  `feat(everything-dev): ResourceProvisioner seam + alchemy materializer`.

## Steps

### Step 1: The interface

`infra/provisioner.ts`:
```ts
export interface ResourcePlan {
  stage: "workshop" | "sandbox" | "production";
  resources: ResolvedResourcePlan;   // per descriptor.resources entry
  bindings: Record<string, { secretName: string; url: string }>; // bindingEnv shape
  phases: readonly InfraPhase[];     // extended: "provision" between allocate and materialize
}
export interface ResourceProvisionerShape {
  readonly plan: (descriptor: AppDescriptor) => Effect.Effect<ResourcePlan, InfraError>;
  readonly materialize: (plan: ResourcePlan) => Effect.Effect<ResourcePlan, InfraError>;
}
export class ResourceProvisioner extends Context.Service<ResourceProvisioner, ResourceProvisionerShape>()("ResourceProvisioner") {}
```
Extend `InfraPhase` with `"provision"`. `ResourcePlan` must carry everything
`InfraPlan.materialize*` needs (embed or reference — prefer embedding the
existing `InfraPlan` fields so `LocalDevProvisioner` is a thin adapter).

**Verify**: `bun typecheck` → 0 errors (no behavior change yet).

### Step 2: LocalDevProvisioner (behavior-preserving)

Adapt `planner.ts` + `materializer.ts` into `LocalDevProvisioner` implementing
the interface: `plan` = existing allocate phases (ports, docker Postgres per
`DatabasePlan`); `materialize` = existing materialize* methods. Descriptor →
`RuntimeConfig` conversion reuses 028's resolver; with no `resources`
declared, output is byte-equal to today's plan (golden test: existing
`tests/regression` + orchestrator characterization tests from advisor plan
015 stay green).

**Verify**: `bun run --cwd packages/everything-dev test` → all pass; `bos
dev` smoke identical (services up, `.bos/infra-state.json` behavior
unchanged).

### Step 3: AlchemyProvisioner (stage-mapped)

`infra/alchemy/`:
- `plan`: map descriptor `resources` per stage —
  - workshop: no external resources; `db` → PGlite binding (local file
    URL), storage → local FS/static (or platform CDN in dev).
  - sandbox: `db` → `Neon.Branch` descriptor; `storage` → platform CDN
    binding (plan 029's `/bundles/` base).
  - production: `db` → `Neon.Project`; `storage` → platform-owned R2
    descriptor.
- `materialize`: run the alchemy program (Effect-native) for sandbox/
  production; write resolved `bindings` (secretName → url — Neon URL under
  the workspace's secret name per `bindingEnv`); workshop binds the PGlite
  path directly. Credentials: platform-side (operator env), never
  tenant-visible.
- Deterministic plan serialization test per stage (no live alchemy calls in
  unit tests; live provisioning is the operator's `bos publish --deploy`
  gate — mirror #119's "DEPLOY=true deliberately not run locally" note).

**Verify**: unit tests for stage mapping + plan serialization; `bun
typecheck`; a `--dry-run`-style CLI flag prints the plan.

### Step 4: Pipeline wiring

`bos publish --deploy`: `ResourceProvisioner.plan(descriptor)` →
`materialize` → resolved bindings flow to (a) workspace env via
`bindingEnv` (spawn), (b) the published config's resolved fields, (c) the
db-receipt layer (plan 027 consumes the resolved `DATABASE_URL` unchanged).
`bos dev` uses `LocalDevProvisioner` with the descriptor's resources when
present (else legacy behavior).

**Verify**: dev-stack e2e — descriptor with `resources.db` boots plugins
with schema-isolated migrated dbs (027's layer reads the binding); changeset
written.

## Test plan

- Golden: LocalDevProvisioner output fixtures (existing behavior frozen).
- Stage mapping table tests (workshop/sandbox/production resource sets).
- Plan serialization round-trip; binding-env handoff test (secretName →
  spawned env).
- Live alchemy: operator-gated only (`bos publish --deploy` against a
  sandbox stage on a throwaway project).

## Done criteria

- [ ] `bun typecheck` 8/8; `bun lint` clean; `bun run test` green
- [ ] `bos dev` behavior identical without `resources` (golden tests)
- [ ] Descriptor resources → resolved bindings end-to-end on the dev stack
- [ ] `ResourceProvisioner` exported; stage mapping documented; changeset;
      README row updated

## STOP conditions

- alchemy's Effect version peer conflicts with the repo's Effect 4 pin
  despite the #97 upgrade — report versions; do not add a second Effect.
- LocalDevProvisioner golden tests cannot pass without behavior changes —
  report the divergence (plan 015's characterization tests exist for this).
- Neon/alchemy program needs credentials the operator has not provisioned —
  mark operator-gated, do not fake.

## Maintenance notes

- The `ResourcePlan.bindings` shape (`{ secretName, url }`) is the contract
  consumed by `db/binding.ts` and plan 032's sandbox env injection — stable
  surface.
- Tiered migration timing (027's follow-up) slots into `materialize` per
  stage here.
- Reviewers: no tenant-visible credentials; plan determinism (same
  descriptor → same plan); `MOUNT`-style version discipline not needed here
  but plan hashing must include resource descriptors.
