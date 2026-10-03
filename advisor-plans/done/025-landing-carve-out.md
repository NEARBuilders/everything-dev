# Plan 025: Landing carve-out — `ui/landing` from `_public` (multi-plugin graft proof)

> **Executor instructions**: Follow step by step; run every verification
> command; STOP conditions below. Update your status row in
> `advisor-plans/README.md` when done.
>
> **Drift check**: `git diff --stat 00d162cb..HEAD -- ui/src/routes/_layout/_public`.
> Prerequisites: plans 021 and 024 merged. Plan 024 established the carve-out
> recipe — this plan repeats it against a second plugin and verifies
> multi-plugin composition. If `plugins/auth/ui` is not merged, STOP.
>
> **2026-09-21 amendment**: plan 024's graft-based recipe was superseded by
> ADR 0008 (manifest composition) after PR #134's composed-SSR failure chain.
> This plan now executes **manifest-first**: it is the second consumer of
> plan 034's machinery (generator emission + host construction, mount registry
> v2 with `_public` as a gates-only mount shared by login/landing/docs), gated
> on 034 landing. The grafting steps below are historical; do not execute them
> — the carve-out structure (routes, config slot, tests) still applies.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: 024-auth-ui-carve-out.md
- **Category**: architecture / migration
- **Planned at**: commit `00d162cb`, 2026-09-18

## Why this matters

A second grafted plugin proves the protocol composes *multiple* remotes with
deterministic ordering and digest-based recomposition — the property tenant
composition depends on. It also shrinks the core monolith toward plan 026's
shell-only end state and gives child repos the concrete `ui/landing` example
they will copy (`bos init` minimal scaffold, advisor plan 020).

## Current state

- Routes to move (verified at `00d162cb`):
  `ui/src/routes/_layout/_public.tsx` (mount layout — stays in core) and
  `ui/src/routes/_layout/_public/`:
  `index.tsx`, `about.tsx`, `explore.tsx`, `skill.tsx`, `$accountId/index.tsx`,
  `activity/$activityId.tsx`, `n/$slug.tsx` (+ `n/-node-page.test.tsx`).
  These are the public, unauthenticated pages of the site.
- `_public` is a mount layout (pathless, id `_public`) — the landing plugin
  declares `_public` as its mount; the core keeps `_public.tsx`.
- Graft machinery (post-021): `composeApp` grafts in ascending plugin-name
  order; digest covers core + per-plugin urls/integrities; local dev bypasses
  the compose cache (hot reload). `defineUiPlugin` (plan 023) is the typed
  export; clients come from `everything-dev/ui/client` (plan 022).
- Component policy: copied `components/ui` sources into the plugin; zero
  token CSS in the bundle (tokens are host CSS, document-shared).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun typecheck` | 8/8 workspaces pass |
| Lint | `bun lint` | exit 0 |
| New ws tests | `bun run --cwd ui/landing test` | all pass |
| UI tests | `bun run --cwd ui test` | all pass |
| Host tests | `bun run --cwd host test` | pass, deploy-gated skips OK |

## Scope

**In scope**:
- `ui/landing/**` (create: new workspace, rsbuild dual-target, routes,
  copied components, `src/tree.ts`)
- `ui/src/routes/_layout/_public/**` (removed; `_public.tsx` stays)
- `bos.config.json` (add `ui.landing` plugin entry or `plugins.landing.ui` —
  use the same registration shape plan 024 used for `plugins.auth.ui`;
  landing is UI-only, so a `plugins.landing.ui` entry with no backend plugin
  is the expected shape — confirm against `plugins.<id>.ui` plumbing in
  `packages/everything-dev/src/config.ts`)

**Out of scope**:
- `_admin`/`_authenticated`/`_dashboard` routes (026)
- Compose pipeline changes
- Content/copy changes to the landing pages (pure move)

## Git workflow

- Branch: `feat/landing-ui-plugin`. Conventional commits:
  `feat(landing): carve _public pages into ui/landing grafted plugin`.

## Steps

### Step 1: Scaffold `ui/landing` (mirror plan 024's step 1)

```
ui/landing/
├── package.json
├── rsbuild.config.ts        # createUiSharedDeps; client + ssr targets
└── src/
    ├── routes/
    │   ├── __root.tsx
    │   ├── _public.tsx       # mount declaration root (id `_public`)
    │   └── _public/{index,about,explore,skill,$accountId,activity,n}/...
    └── tree.ts               # defineUiPlugin({ name: "landing", mounts: ["public"], tree })
```

Move route files verbatim; adjust imports to `everything-dev/ui/client` and
copy the `components/ui` sources these pages import. Public pages that fetch
data use `useApiClient`/`usePluginClients` exactly as the monolith did.

**Verify**: `bun run --cwd ui/landing build` → client + ssr artifacts;
`bun typecheck` → 0 errors.

### Step 2: Register + delete monolith routes

Config entry (`plugins.landing.ui`), `bos types gen`, then delete
`ui/src/routes/_layout/_public/**` (keep `_public.tsx`). Regenerate
`ui/routeTree.gen.ts`.

**Verify**: `bun typecheck` → 0 errors; `bun run --cwd ui test` → pass;
`bos mf check` → green in dev.

### Step 3: Multi-plugin composition verification

With both `auth` (024) and `landing` registered:
- `composeApp(coreTree, [authTree, landingTree])` — verify ascending-name
  order (`auth` before `landing`), both mounts grafted (`_anon`,
  `_dashboard`, `_public`), no id collisions.
- Digest: change `plugins.landing.ui` integrity (rebuild) → compose digest
  changes → recompose; unchanged digest → cached compose reused (host log
  evidence or compose-cache test).
- SSR + client + fallbacks as in plan 024 step 4, now for `/` (landing
  index), `/about`, `/explore`, `/login`.

**Verify**: `BOS_UI_COMPOSE=1 bun run dev`; `bun run --cwd host test`
including an extended `ui-compose.test.ts` fixture with two plugin trees.

## Test plan

- Port `n/-node-page.test.tsx` → `ui/landing/src/routes/_public/n/`.
- New: host compose fixture with two plugins (order + digest recompose).
- Browser regression: public pages render, links into `/login` and
  `/dashboard` work.

## Done criteria

- [ ] `bun typecheck` 8/8; `bun lint` clean; `bun run test` green
- [ ] `grep -rn "explore\|about" ui/src/routes` → no `_public/` leaves remain
- [ ] `ui/landing` builds both artifacts; two-plugin compose verified
- [ ] Changeset written; README row updated

## STOP conditions

- Landing pages import server-only modules that do not travel to a plugin
  bundle (e.g. deep `@/lib` server helpers) — report; do not inline-copy
  server code into the plugin.
- A second plugin's graft breaks the first (compose ordering/collision) —
  this is a compose-pipeline bug; report with reproduction.

## Maintenance notes

- After this plan the core monolith holds only: mounts, `_admin`,
  `_authenticated/_dashboard` app pages, shared components for those, and the
  hydrate bootstrap — the exact scope plan 026 absorbs into `host/`.
- `ui/landing` is the reference child-repo plugin; keep it dependency-minimal.
