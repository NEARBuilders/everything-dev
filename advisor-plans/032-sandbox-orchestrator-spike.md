# Plan 032: Sandbox orchestrator + gateway — design + prototype (SPIKE ONLY)

> **Executor instructions**: This is a **spike plan**: the deliverable is a
> working prototype plus a written design — NOT production code, NOT a
> deploy-train change. Do not wire the prototype into default startup paths;
> everything gated behind `BOS_SANDBOX=1` (or spike-only entry points).
> Update your status row in `advisor-plans/README.md` when done.
>
> **Drift check**: `git diff --stat 00d162cb..HEAD -- host/src/services/binding-resolver.ts
> packages/everything-dev/src/infra`. Prerequisites: plans 029 and 031
> merged (platform storage + provisioner exist). If `ResourceProvisioner`
> is absent, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: done/029-platform-cdn.md, 031-resource-provisioner-seam.md
- **Category**: direction / spike
- **Planned at**: commit `00d162cb`, 2026-09-18

## Why this matters

Locked design decisions (operator session, 2026-09-18): a tenant is an
org-owned App instance with `stage: "sandbox"`; sandbox host processes run
**the platform image on alchemy-managed machines** (children never ship
Dockerfiles); the subdomain binding routes visitors to the tenant's host.
This is the productionization path beyond shared-host Tier-1 composition.
Two upstream questions remain unresolved (hot-swap lifecycle = wayfinder
ticket 10; in-flight request drain on teardown) — which is exactly why this
is a spike: prove the lease model, measure the lifecycle behavior, and write
the design before committing the platform to it.

## Current state

- **BindingResolver** (`host/src/services/binding-resolver.ts`, design per
  `plans/beta-v2/tenants.md`): `resolve(hostname) → { configAccount,
  configGateway, allowUi, allowBackend, allowSsr, status }`; full-map fetch,
  30s refresh, O(1) lookup. Tenant statuses: `suspended` (503) /
  `pending_deletion` (410) handled in `resolveRequestRuntime`.
- **Host boot contract** (AGENTS.md, verified): host boots `bos start`,
  fetches published config from FastKV at `bos://<BOS_ACCOUNT>/<BOS_GATEWAY>`,
  env: `BOS_ACCOUNT`, `BOS_GATEWAY`, `BETTER_AUTH_SECRET`.
- **Platform image**: committed root `Dockerfile`; Railway builds it
  (`railway.toml`); deploy workflow runs `bos publish --deploy` + `bos mf
  check` gate (post-#106). The image is provider-agnostic by design
  (alchemy providers swappable).
- **Provisioner** (post-031): `ResourceProvisioner.plan/materialize` with
  `ResourcePlan.bindings: Record<string, { secretName, url }>` — the env
  handoff shape (`bindingEnv`).
- **Scoped-resource idiom**: every-plugin `initialize` returns an Effect
  Layer built against the plugin's lifecycle scope; teardown = Layer
  finalizers (post-#97). The sandbox lease reuses this idiom: acquire on
  spawn, release on idle-TTL/shutdown.
- **Platform storage** (post-029): bundles served at
  `/bundles/<account>/<gateway>/<workspace>/…` — a sandbox host's own
  published artifacts are already addressable without any new storage.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun typecheck` | 8/8 workspaces pass |
| Lint | `bun lint` | exit 0 |
| Framework tests | `bun run --cwd packages/everything-dev test` | all pass |
| Spike e2e | `BOS_SANDBOX=1 bos dev` + scratch tenant | tenant renders via sandbox host |

## Scope

**In scope**:
- `plans/extensions/sandbox-orchestrator.md` (create — the design doc)
- `packages/everything-dev/src/sandbox/**` (prototype orchestrator)
- `host/src/services/binding-resolver.ts` (prototype: `hostMode` field,
  `BOS_SANDBOX=1` gated)
- Local docker as the prototype machine provider (alchemy machine impl
  follows the design doc; docker proves the lease model today)

**Out of scope**:
- Production deployment of the orchestrator (post-spike plan)
- Billing/quotas; multi-region; per-sandbox observability
- Changing the deployed host image or default startup paths
- Resolving ticket 10 fully (the design doc *frames* it; the spike measures it)

## Git workflow

- Branch: `spike/sandbox-orchestrator`. Conventional commits:
  `spike(sandbox): orchestrator prototype + lease design`.

## Steps

### Step 1: Design doc

`plans/extensions/sandbox-orchestrator.md`:
- Lease model: `SandboxOrchestrator` as `Context.Service`;
  `acquire(descriptor) -> Lease` as a scoped Effect resource —
  `acquireRelease` with idle-TTL finalizer; crash cleanup; replacement on
  republish (in-flight request drain = ticket 10: prototype measures
  connection-drop vs drain window, records results).
- Machine model: platform image (digest-pinned to the host train) + env
  (`BOS_ACCOUNT` = tenant account, `BOS_GATEWAY` = tenant gateway,
  `bindings` from `ResourcePlan` via `bindingEnv`, `BETTER_AUTH_SECRET`
  scoped per sandbox); health gate = existing `/health`.
- Gateway: binding gains `hostMode: "shared" | "sandbox"` +
  `sandboxUrl`; `BindingResolver` returns it; host request path proxies to
  `sandboxUrl` when set (flag `BOS_SANDBOX=1`). Extends-chain + integrity
  verification identical in both modes.
- Security: tenant host processes are isolated machines with only their own
  bindings; platform storage creds never injected; relay/session trust
  unchanged.

### Step 2: Orchestrator prototype

`packages/everything-dev/src/sandbox/orchestrator.ts`:
- `SandboxOrchestrator` Context.Service: `acquireLease(tenant: {
  account, gateway, bindings })` → lease handle (`url`, `stop()`),
  spawn = docker container from the platform image (local spike provider),
  health-poll `/health` until ready (bounded retries), idle-TTL sweeper as
  a finalizer.
- Trigger path (spike): a CLI command (`bos sandbox start --account …
  --gateway …`) rather than automatic spawn — keeps production paths clean.

**Verify**: `bun run --cwd packages/everything-dev test` → orchestrator unit
tests (fake provider): lease acquire/release, TTL teardown, crash cleanup.

### Step 3: Gateway prototype + local e2e

- `binding-resolver.ts` (flagged): support `hostMode`/`sandboxUrl` from the
  bindings map; `resolveRequestRuntime` proxies to the sandbox URL when
  set.
- E2E (local): publish a scratch tenant config (`stage: "sandbox"`) →
  `bos sandbox start` → binding row with `hostMode: "sandbox"` → request
  `<slug>.localhost:<port>` → proxy → sandbox host renders the tenant
  (bundles from platform storage, plan 029).
  Teardown: idle TTL expires → container stops → subsequent request
  re-acquires (cold start measured).

**Verify**: record in the design doc: cold-start time, idle teardown
behavior, in-flight drain measurement, failure modes hit.

## Test plan

- Unit: lease lifecycle (acquire/release/TTL/crash) against a fake provider;
  binding hostMode resolution; proxy wiring behind the flag.
- E2E spike runbook (documented in the design doc) — manual, recorded.

## Done criteria

- [ ] Design doc committed and reviewed by operator
- [ ] Prototype passes its unit tests; `BOS_SANDBOX=1` local e2e works
- [ ] No default-path behavior changed without the flag (`bos dev`/`bos
      start` identical when flag absent — golden tests)
- [ ] Measured numbers recorded (cold start, drain); ticket-10 recommendations
      written
- [ ] README row updated

## STOP conditions

- The platform image cannot boot a tenant host without build-time changes
  beyond env injection — report (this invalidates the "children never ship
  Dockerfiles" premise; operator decision needed).
- Subdomain routing on the local spike requires DNS machinery out of scope —
  use `<slug>.localhost` and note the production DNS path (tenants.md custom
  domains) in the design doc instead of building it.
- Any need to weaken the extends-chain/integrity verification to make the
  spike work.

## Maintenance notes

- The spike's lease idiom is deliberately the same acquireRelease/finalizer
  pattern as plugin Layers — the production plan should formalize it as
  scoped resources end-to-end.
- Open upstream dependencies for the production plan: ticket 10 (hot-swap),
  machine provider choice (alchemy machines vs railway API), DNS automation.
- Reviewers: isolation claims (env injection contains no platform secrets),
  flag gating, image digest pinning.
