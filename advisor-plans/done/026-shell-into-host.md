# Plan 026: Merge the shell into the host — in-process base tree, plugin-only `ui/`

> **Executor instructions**: Follow step by step; run every verification
> command; STOP conditions below. Update your status row in
> `advisor-plans/README.md` when done.
>
> **Drift check**: `git diff --stat 00d162cb..HEAD -- host/src ui/src`.
> Prerequisites: plans 021, 024, 025 merged. If the ui monolith still contains
> app routes beyond `_admin`/`_authenticated` app pages, STOP (carve-outs
> incomplete). This plan is HIGH-risk: it is reversible only until plan 028
> lands; execute with operator sign-off at each gate.
>
> **2026-09-21 amendment**: ADR 0008 supersedes grafting — this plan now
> simplifies: the host **constructs** all routes (in-process shell routes from
> source + plugin routes from manifests) — one construction story, no
> "in-process tree + grafted foreign trees" hybrid. The digest cache, plugin
> tree loading, and mount machinery references below are re-interpreted
> through plan 034's construction service; graft-specific steps are dead.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: 024-auth-ui-carve-out.md, 025-landing-carve-out.md
- **Category**: architecture / migration
- **Planned at**: commit `00d162cb`, 2026-09-18

## Why this matters

Today every SSR render loads the *base* ui tree from a remote
(`loadRouterModule` → `remoteEntry.server.js`), paying a network hop, an SRI
check, and a cache layer for code the host trusts unconditionally — and child
repos must either ship or fetch a separate "ui shell" artifact. Moving the
shell (root tree, mount declarations, head injection, public assets, hydrate
bootstrap) into the host process removes the hop, deletes the core-`ui`
remote concept, makes head metadata host-owned (descriptor-driven), and
completes the model: **host + shell = platform core; `ui/` = plugins only.**
The compose pipeline (digest cache, plugin tree loading) is reused unchanged —
only the base tree's origin changes from remote to in-process.

## Current state

- SSR path: `host/src/services/ssr-render.ts` (`createSsrRender`) →
  `loadRouterModule(config)` (`federation.server.ts`: loads
  `${config.ui.ssrUrl}/remoteEntry.server.js`, expose `${ui.name}/Router`,
  SRI-verified, TTL/LRU-cached) → `ssrRouterModule.renderToStream(request,
  { session, basepath, runtimeConfig, apiClient, cspNonce, routeTree:
  composedUi?.routeTree, pluginNav })`.
- Shell content to absorb from `ui/`:
  - `ui/src/routes/__root.tsx` + `_layout.tsx` + mount layouts
    (`_public.tsx`, `_anon.tsx`, `_authenticated.tsx`, `_admin.tsx`,
    `_admin/_dashboard.tsx`, `_authenticated/_dashboard.tsx`) and the
    remaining app routes (admin + authenticated dashboard pages — these move
    into `host/src/shell` as the core tree).
  - `ui/src/router.server.tsx` (`renderToStream`: per-request QueryClient,
    request-scoped auth client with forwarded headers, host-supplied
    `apiClient`, optional `routeTree`/`pluginNav` overrides) — the render
    engine; becomes host-side.
  - `ui/src/router.tsx` + `ui/src/hydrate.tsx` — client bootstrap + client
    compose of plugin trees (`composeClientPluginTrees`, digest check,
    core-only fallback).
  - `ui/src/components/layout/app-shell.tsx`, `nav-items.ts`, and the
    `components/ui` sources the shell imports (copied-source policy; tokens
    stay in the host CSS).
  - `ui/src/tree.ts` (core `./tree` expose) — deleted with the remote.
- Head: `everything-dev/ui/head` (`collectHeadData`) + `__root.tsx` `head()`;
  metadata flows from runtime config (`getAppName()`, active runtime title).
- `host/src/routes/html.ts` — `renderClientShell` (CSR fallback) and script/
  css injection; gains `public/` asset serving (`host/public/`: favicon,
  robots.txt).
- Config: `bos.config.json` `app.ui` entry (name, url, entry, integrity,
  ssrUrl, ssrIntegrity, compose, composeDigest from #121); tenant-`ui`
  override slot exists (AGENTS.md: supported overrides are `ui` and
  `plugins.<id>.ui`).
- Deliberate capability trade (user decision, 2026-09-18): the overridable
  core-`ui` slot is retired — the shell is platform trust, like host code.
  Tenants override plugins, not the shell.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun typecheck` | 8/8 workspaces pass |
| Lint | `bun lint` | exit 0 |
| Host tests | `bun run --cwd host test` | all pass (deploy-gated skips OK) |
| UI tests | `bun run --cwd ui test` | all pass |
| Full suite | `bun run test` | all pass |
| Dev smoke | `bun run dev` | 8 services ready; pages render |

## Scope

**In scope**:
- `host/src/shell/**` (create: routes, mounts, components, bootstrap)
- `host/src/services/{ssr-render,federation.server,ui-compose,config}.ts`
  (base tree in-process; `loadRouterModule` deleted; `loadPluginUiTree` kept)
- `host/src/routes/{ssr,html}.ts` (render wiring; public assets)
- `host/public/**` (create)
- `ui/**` (delete absorbed shell; `ui/` becomes plugin-only: `ui/landing`,
  or `ui/` removal into plugin dirs if 024/025 placed plugins under
  `plugins/*/ui` — final layout per operator confirmation in step 1)
- `packages/everything-dev/src/ui/*` (types/runtime/head adjustments)
- `bos.config.json` (remove `app.ui` core entry)
- `.changeset/` (breaking: core-`ui` remote slot retired)

**Out of scope**:
- `plugins/*/ui` and `ui/landing` contents (grafted plugins unchanged)
- Compose digest/graft semantics (021 owns those fixes)
- `App()` descriptor (028) — head metadata reads runtime config fields that
  exist today

## Git workflow

- Branch: `feat/shell-into-host`. Conventional commits:
  `feat(host)!: absorb ui shell — in-process base tree, remote core-ui retired`.
- This plan changes deployed behavior; the operator merges only after the
  deploy train check (step 5).

## Steps

### Step 1: Freeze the target layout (operator gate)

Confirm final plugin locations: if 024/025 used `plugins/auth/ui` +
`ui/landing`, keep that split (full-stack plugins carry `ui/` subdirs;
standalone web plugins live in `ui/`). Document the layout in AGENTS.md.
No code yet.

### Step 2: Create `host/src/shell`

Move (verbatim where possible, imports adjusted to `everything-dev/ui/*` +
`everything-dev/ui/client`):
- `__root.tsx` + `_layout.tsx` + mount layouts + remaining app routes
  (admin, authenticated dashboard) → `host/src/shell/routes/`
- `router.tsx` + `router.server.tsx` → `host/src/shell/router/` (client
  bootstrap is served by the host; `renderToStream` called in-process)
- `app-shell.tsx`, `nav-items.ts`, needed `components/ui` copies →
  `host/src/shell/components/`
- `hydrate.tsx` compose logic → `host/src/shell/hydrate.ts` (host serves it;
  plugin remote scripts injected as today via `getRemoteScripts`)
- `host/public/`: move favicon/robots from `ui/public/` (verify what exists)

### Step 3: Rewire SSR + config

- `ssr-render.ts`: base tree = in-process shell tree; delete
  `loadRouterModule` usage for the core (keep `loadPluginUiTree`); compose
  plugin trees onto the in-process base via `composePluginTrees` (unchanged).
- `config.ts`/`types.ts`: `app.ui` core entry optional/deprecated; `compose`
  flag/digest computed from plugin entries only.
- `html.ts`: `renderClientShell` serves the host bundle's own assets;
  `host/public/` statics registered.

**Verify**: `bun run --cwd host test` → all pass; update
`ssr-render`/`ui-compose` tests for the in-process base; route-level render
snapshots for `/`, `/login`, `/dashboard`, `/admin`.

### Step 4: Delete the ui monolith shell

Remove absorbed files from `ui/`; `ui/` (or the plugin dirs) must contain
only plugin workspaces. Update `bos.config.json` (remove `app.ui`), AGENTS.md
(tenant capability trade: `ui` slot retired; `plugins.<id>.ui` remains the
override surface), changeset with migration notes (deployed hosts read the
new config shape — deploy train required).

**Verify**: `bun typecheck` 8/8; `grep -rn "ssrUrl" bos.config.json` →
no core-ui entry; `bun run test` green.

### Step 5: Deploy train (operator)

`bos publish --deploy` (host + plugins redeploy together — the config shape
change is protocol-level). Verify production: pages render, `bos mf check`
green, tenant subdomain composition still resolves (`plugins.<id>.ui`
overrides).

**Verify**: `bun run --cwd tests/regression` suites (HTTP + browser) green
against the deployed train.

## Test plan

- Move shell route tests into `host/tests/` (they are host-owned now).
- New: `ssr-render` in-process base test; `html.ts` public-asset test;
  hydrate compose fallback test (unchanged behavior, new home).
- Regression: full HTTP + browser suites; `bos mf check`.

## Done criteria

- [ ] `bun typecheck` 8/8; `bun lint` clean; `bun run test` green
- [ ] `grep -rn "loadRouterModule" host/src` → no matches
- [ ] `ui/` (or post-consolidation location) contains only plugin workspaces
- [ ] `bos.config.json` has no core `app.ui` remote entry
- [ ] Production train deployed; regression suites green
- [ ] Changeset + AGENTS.md updated; README row updated

## STOP conditions

- Client-side composition of plugin trees cannot hydrate against an
  in-process base without script-order changes that break the #121 digest
  guarantees — report; do not weaken the digest check.
- Tenant subdomain composition (`plugins.<id>.ui` overrides) regresses after
  the config shape change — report with reproduction; the deploy train gate
  exists for this.
- Any need to keep `loadRouterModule` "temporarily" for a consumer other than
  the core tree.

## Maintenance notes

- This is the riskiest plan in the set and is reversible until 028 (the
  descriptor absorbing a stable `ui/` shape). After 028, the config shape is
  contractual.
- The core-tree mutation limitation from 021 ends here: the base tree is
  host-owned; consider making `composeApp` fully copy-on-write now that the
  base is in-process.
- Reviewers: CSP nonce flow (host-owned now), `getRemoteScripts` ordering,
  and that no plugin bundle grew (diff the built assets).
