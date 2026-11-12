# Plan 065: Prototype — TanStack Redact on the CSR default path, evidence before any singleton decision

> **Executor instructions**: This is a **prototype spike**: the deliverable is a bundle-size and compatibility measurement under `docs/plans/prototypes/redact-csr/` plus a verdict — NOT an adoption. Prototypes are TS 5-pinned and exempt from the repo's TS 7 rules. Honor STOP conditions. When done, update the status row for this plan in `docs/plans/README.md` unless the dispatching reviewer maintains the index.
>
> **Drift check (run first)**: check the current `@tanstack/redact` version and its documented bundler integrations (docs at https://tanstack.com/redact — as of this plan: "integrations for TanStack Start, Vite, Vinext, and Next.js"). **Note: the platform's ui builds with rsbuild** (`@rsbuild/core`, rspack-based) — a Vite-plugin integration may not apply directly; determining the viable integration route is part of this spike. On a conflict with the facts below, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S-M
- **Risk**: LOW (sandboxed; v0 dependency stays in the prototype)
- **Depends on**: none hard; most meaningful after any bundler consolidation decisions (its integration route depends on the bundler in place)
- **Category**: direction (spike)
- **Planned at**: commit `1e435601`, 2026-10-28
- **Issue**: https://github.com/NEARBuilders/everything-dev/issues/646

## Why this matters

Redact is TanStack's smaller, synchronous React replacement for the browser: same components/hooks/imports, ~43% smaller client bundles than React on Start (110 KB → 60–63 KB gz in TanStack's benchmark), feature-flagged down to a `nano` preset, with a real-browser compatibility matrix (Chromium/Firefox/WebKit journeys over hydration, Suspense, actions, Fast Refresh). For CDN-served apps, browser bytes are boot time — directly relevant to this platform's load path. But adoption here has a platform-shaped cost: **MF remotes share the React singleton** (ADR 0037 exists because of shared singletons) — adopting Redact means every remote must share the *Redact runtime* instead, i.e. a `shared-deps-spec.ts` rewrite and ecosystem verification (sonner — itself a pinned singleton — Radix/shadcn components, TanStack Query/Virtual). This spike measures the actual win and the actual compat surface on this repo's real ui, so the singleton decision is made on evidence, not benchmark marketing.

## Current state (inputs the prototype uses)

- The ui workspace builds with rsbuild (`packages/every-plugin/src/build/ui/rsbuild-config.ts` — dual web/node environments via `@module-federation/rsbuild-plugin`); the CSR default path is what tenants' browsers load.
- Shared singletons today: React, react-dom, TanStack Router/Query, Sonner (ADR 0037 — the Toaster lives in core ui so remotes resolve the same sonner instance).
- Redact's model: server keeps React (SSR), browser runs Redact (hydrates HTML, runs client components); feature flags (`activity`, `fragmentRefs`, `portal`, …) or a `nano` preset.
- Prototype conventions: `docs/plans/prototypes/` (TS 5-pinned, own tooling); reference `manifest-compose/` for structure.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Prototype install/build | `cd docs/plans/prototypes/redact-csr && pnpm install && pnpm build` | exit 0 |
| Bundle measurement | per README (size output of the build) | numbers recorded |
| Repo gates stay green | `pnpm run typecheck && pnpm run lint` (repo root) | exit 0 |

## Scope

**In scope**:
- `docs/plans/prototypes/redact-csr/` (create: a minimal two-remote CSR composition — the prototype's own MF config — running the ui's real component stack subset under Redact; `README.md` measurement + verdict)
- `docs/plans/README.md` prototypes table row

**Out of scope**:
- Any change to `ui/`, `packages/every-plugin` build config, shared-deps spec, or ADR 0037.
- SSR leg (Redact's server-React/browser-Redact split interacts with the host's own SSR — out of scope; note it as the open question it is).

## Git workflow

- Branch: `feat/proto-redact-csr`
- Commit style: conventional commits, e.g. `feat(prototypes): redact CSR measurement evidence`

## Steps

### Step 1: integration route determination (this may be the whole spike)

Determine how Redact integrates with an rsbuild (rspack) build: Vite plugin? runtime-level integration? `tools.rspack` escape hatch? Consult Redact's docs and repo; if no rsbuild story exists, evaluate: (a) prototype-local Vite build (validates Redact itself but not the integration), or (b) stop here and report "integration route does not exist for rsbuild" — that is a legitimate spike outcome. Record the route chosen and why in the README.

**Verify**: route documented; prototype builds (or the documented negative result).

### Step 2: measure the real delta

Compose the prototype host + two remotes sharing the runtime singleton (Redact as the shared dep), rendering a representative slice of the actual ui component stack (the core shell: sidebar + one table-heavy route + a sonner toast). Measure gzipped client JS for: React baseline vs Redact full vs Redact `nano` (and the delta *per remote* — the platform ships N remotes, so per-remote savings compound).

**Verify**: numbers table in README (baseline / redact / nano; per-remote and total).

### Step 3: compatibility sweep

Run the prototype through: TanStack Router client navigation; TanStack Query data rendering; a sonner toast; one Radix-based shadcn component; TanStack Virtual row virtualization. Record pass/fail per item against Redact's own compatibility claims, noting version mismatches.

**Verify**: compat table complete with versions.

### Step 4: verdict

README verdict: (a) measured win (bytes) vs (b) adoption cost (shared-deps-spec rewrite for the Redact runtime across all remotes, sonner/radix compat risk, SSR-split open question, v0 maturity, `minimumReleaseAge` supply-chain policy for a brand-new package). Recommendation: adopt / re-spike-after-v1 / reject.

**Verify**: verdict section present; `docs/plans/README.md` row updated.

## Test plan

- The compat sweep is the test matrix. Prototype-local Playwright optional; keep out of the repo regression suite. Repo gates green.

## Done criteria

- [ ] Integration route determined and documented (or the documented negative result)
- [ ] Bundle numbers table (baseline / redact / nano; per-remote)
- [ ] Compat table (router/query/sonner/radix/virtual, versions)
- [ ] Verdict with adoption-cost accounting
- [ ] Repo typecheck + lint green
- [ ] `docs/plans/README.md` updated

## STOP conditions

Stop and report back (do not improvise) if:

- No rsbuild-compatible integration route exists AND a Vite-side measurement can't isolate the runtime-swap variable — report the negative result; do not hand-patch Redact internals.
- A core compat item (router navigation or query rendering) fails hard — record it; that likely decides the verdict on its own.

## Maintenance notes

- If the verdict is "re-spike after v1", the re-spike trigger is: Redact ships a rsbuild/rspack story OR the bundler consolidation changes the ui's bundler.
- Reviewer scrutiny: the shared-singleton rewrite cost accounting — it is the real price, and the audit's skew machinery history (ADR 0037) is the precedent for what under-costing it looks like.
