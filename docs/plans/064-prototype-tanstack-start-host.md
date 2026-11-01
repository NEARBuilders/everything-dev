# Plan 064: Prototype — TanStack Start as the host app via `@module-federation/tanstack`, tested on per-tenant UI override

> **Executor instructions**: This is a **prototype spike**: the deliverable is a runnable prototype under `docs/plans/prototypes/start-host/` plus an evidence pack — NOT production code and NOT an adoption commitment. Prototypes are TS 5-pinned and exempt from the repo's TS 7 rules. Honor STOP conditions. When done, update the status row for this plan in `docs/plans/README.md` unless the dispatching reviewer maintains the index.
>
> **Drift check (run first)**: `git log --oneline -5 -- docs/plans/prototypes/` and check the latest `@module-federation/tanstack` release notes — this prototype builds on a dependency that shipped **2026-10-08** (early release). If the API has shifted materially since, re-scope the steps against the current README before proceeding; on a conflict with the facts below, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (sandboxed prototype; early-release dependency stays inside the prototype)
- **Depends on**: none (062 independent; evidence feeds the eventual Start ADR)
- **Category**: direction (spike)
- **Planned at**: commit `1e435601`, 2026-10-28
- **Issue**: https://github.com/NEARBuilders/everything-dev/issues/645

## Why this matters

TanStack Start is v1 and `@module-federation/tanstack` (released 2026-10-08) makes Start + MF work: federated SSR (remotes render server-side and hydrate), React/react-dom shared singletons, Vite+Rsbuild hosts/remotes mixable, `lazyRemote` retry, `getRemoteStylesheets`, offline fallback. The platform already uses TanStack Router with a **host-owned, manifest-composed SSR** (ADR 0007/0008/0024): the host mints all routes from N remotes' manifests per request and per-tenant overrides swap the `ui` slot. The open question this prototype answers with evidence: **can a Start app host reproduce per-tenant UI override with a fixed host** (request-scoped remote swap) — the one capability the current architecture exists to deliver? If yes, Start could eventually absorb the hand-rolled SSR bridge (`ui-compose.ts`/`ssr-render.ts`, ~850 LOC) with ecosystem-backed streaming/hydration; if no, the evidence validates ADR 0007/0024 and settles the question. Note what makes this repo unusually well-positioned: Start+MF's hardest known problem is server functions across the host boundary (`/_serverFn` 404s on the host origin; AsyncLocalStorage context missing in SSR) — this platform doesn't use server functions at all (oRPC behind the host is the API plane), sidestepping the roughest edge by design.

## Current state (inputs the prototype uses)

- `@module-federation/tanstack` v0.x (early release; setup = one plugin added **before** `tanstackStart()` in the Vite or Rsbuild config; six example apps in its repo cover host/remote combinations; `lazyRemote` retries failed remote loads; `getRemoteStylesheets` puts remote CSS into the server response).
- Known friction (from public issue threads, October 2026): `@module-federation/vite` + Start SSR can crash via `loadShare()` returning undefined in the SSR environment (`virtual:mf:...loadShare__react` aliasing) — workarounds exist (client-environment-only MF hooks, SSR alias bypass); `hostInitInjectLocation: "entry"` for non-`index.html` hosts; server functions need base-URL + `runWithStartContext` workarounds (not needed here).
- The capability under test in production terms: `host/src/services/tenant-runtime.ts` + `federation.server.ts` resolve a tenant's `ui` slot per request while the host stays fixed (ADR 0007); config-swap composition is retained by ADR 0008 (see `docs/plans/README.md` prototypes table: `beta-v2-override` validated config-swap composition).
- Prototype conventions: `docs/plans/prototypes/manifest-compose/` is the live reference; new prototype at `docs/plans/prototypes/start-host/` with its own TS 5-pinned `package.json`/`tsconfig.json`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Prototype install | `cd docs/plans/prototypes/start-host && pnpm install` | exit 0 |
| Prototype dev | `pnpm dev` (inside prototype dir) | host at its configured port |
| Repo gates stay green | `pnpm run typecheck && pnpm run lint` (repo root) | exit 0 |

## Scope

**In scope**:
- `docs/plans/prototypes/start-host/` (create: a Start host app + two remotes — `core` and `tenant-override` exposing the same route(s) — `README.md` evidence pack, TS 5-pinned tooling)
- `docs/plans/README.md` prototypes table row

**Out of scope**:
- Any change to the real `host/`, `ui/`, `packages/*` (no adoption, no ADR edits — the evidence pack *proposes* the ADR decision).
- Server functions (`createServerFn`) — deliberately unused; the platform's API plane is oRPC.
- Production deployment of the prototype.

## Git workflow

- Branch: `feat/proto-start-host`
- Commit style: conventional commits, e.g. `feat(prototypes): start-host MF tenant-override evidence`

## Steps

### Step 1: scaffold Start host + two remotes

Host: a TanStack Start app (Vite plugin `tanstackStart()` + `@module-federation/tanstack` plugin before it, `hostInitInjectLocation: "entry"` if the no-index.html shape needs it). Remotes `core` and `tenant-override`: each a Start app (or minimal Start remote per the plugin's examples) exposing the same logical surface — a route `/` plus one nested route — so the swap is observable.

**Verify**: `pnpm dev` → host renders core's routes; both remotes build.

### Step 2: the one test — request-scoped tenant override with a fixed host

Implement the override the way the production host would need it: the host resolves, **per request** (e.g. by Host header or a query param simulating a tenant), whether `/`'s component tree comes from `core` or `tenant-override`, using `lazyRemote`-style dynamic remote loading — remotes stay registered; the *slot* points at a different remote. Server-rendered on the host (federated SSR on), hydrated without losing the choice.

**Verify**: two requests with different tenant markers → two different rendered route trees, same host process, SSR HTML differs and hydrates correctly. Record exact requests + HTML snippets in the README.

### Step 3: compare against the production composition — evidence pack

In `README.md`, score both approaches on the axes the platform actually pays for:
1. **Per-tenant override**: does Start's host support request-scoped remote swap without rebuilding/remounting the host app? (The core finding — if override requires process restarts or static remote maps, this prototype's verdict is NO for the shared-host tier.)
2. **SSR composition**: federated SSR across remotes vs `ui-compose`/`ssr-render`'s manifest composition — what breaks (context crossing, styles, head management)?
3. **Singleton story**: how the plugin shares react/react-dom vs `shared-deps-spec` strictness — is there a skew analog?
4. **Bundle/DX**: dev-server behavior, build output shape vs the CDN-pinned hashed artifacts (ADR 0011) — compatibility with content-addressed deploy (integrity pins), not a blocker assessment, a listing.
5. **LOC delta estimate**: what `ui-compose`+`ssr-render`+`federation.server.ts` surface Start could absorb vs what the host must keep (tenant resolver, pins, oRPC proxying).
6. **Verdict**: adopt / adopt-for-children-only / record-ADR-and-stay — with the evidence, stated as a recommendation for the operator's ADR.

**Verify**: all six sections present with concrete evidence (requests, HTML, configs, LOC counts).

### Step 4: index

`docs/plans/README.md` prototypes table row with the one-line verdict.

**Verify**: row present.

## Test plan

- The Step 2 override demonstration is the test (two requests, two trees). Add a tiny Playwright check inside the prototype dir if convenient; keep it out of the repo regression suite.
- Repo gates green: `pnpm run typecheck && pnpm run lint`.

## Done criteria

- [ ] Prototype runs: Start host + 2 remotes, federated SSR on
- [ ] Request-scoped override demonstrated with recorded requests + HTML
- [ ] Evidence pack complete (six axes + verdict)
- [ ] Repo typecheck + lint green
- [ ] `docs/plans/README.md` updated

## STOP conditions

Stop and report back (do not improvise) if:

- `@module-federation/tanstack` cannot render remotes server-side in the prototype's configuration after consulting the plugin's examples + known `loadShare` SSR workarounds — report the exact error; the SSR leg is load-bearing for the verdict.
- Request-scoped swap proves impossible without host rebuild/restart — that IS a valid verdict (record it) — but stop before hand-rolling an alternate runtime mechanism inside the prototype; the point is to test Start's native capability, not to re-derive the existing host.
- The early-release dependency breaks install/build in a way its own examples don't cover (pin the exact version used in the README either way).

## Maintenance notes

- The evidence pack is the input to a future "TanStack Start adoption" ADR (adopt / children-only / stay). If the verdict is adopt, the migration surface is `ui-compose`/`ssr-render`/`federation.server.ts` — plan 060's reload seam and 061's SRI registration must survive any such migration (note the dependency in the evidence pack).
- Reviewer scrutiny: honesty about what "adopt" would cost — the host's tenant resolver and pin planes are not part of Start's model and stay custom either way.
