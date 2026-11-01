# Plan 063: Prototype — an import-map browser composition plane with the map published on-chain

> **Executor instructions**: This is a **prototype spike**: the deliverable is a runnable prototype under `docs/plans/prototypes/import-map-plane/` plus an evidence report — NOT production code. Prototypes are TS 5-pinned and exempt from the repo's TS 7 rules (per AGENTS.md: "docs/plans/prototypes/* pin their own TypeScript 5 and are exempt"). Honor STOP conditions. When done, update the status row for this plan in `docs/plans/README.md` unless the dispatching reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 1e435601..HEAD -- docs/plans/prototypes/ pnpm-workspace.yaml`
> Conflicts with the pinned versions below → STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (sandboxed prototype)
- **Depends on**: none
- **Category**: direction (spike)
- **Planned at**: commit `1e435601`, 2026-10-28
- **Issue**: https://github.com/NEARBuilders/everything-dev/issues/644

## Why this matters

The platform's version-skew machinery (ADR 0037 share-scope negotiation, `SharedSingletonSkewError`, `bos mf check`, ~2.5K LOC) exists because Module Federation *negotiates* shared singletons at runtime. Native ESM import maps make the singleton **by construction**: one import-map entry → one URL → one module instance; there is no way to load React twice. The repo's own `shared-deps-spec.ts` already enforces exact pinned versions with fail-loud resolution — it has arrived at the import-map model via configuration instead of construction. Because an import map is declarative JSON, it can be published as part of the runtime config (FastKV, ADR 0001) — making the **browser module graph an on-chain-verifiable artifact**, which is the natural end-state of the three-pin-planes thesis (ADR 0036). This prototype answers, with evidence: can the browser plane compose two independently-built remotes sharing one React via import maps alone — no MF runtime in the browser — with the map published as a config well-known slot? MF stays the server-side substrate (decided); this tests the future seam recorded beside ADR 0024.

## Current state (inputs the prototype uses)

- Prototypes live in `docs/plans/prototypes/` — see `docs/plans/prototypes/manifest-compose/` (the live reference prototype for ADR 0007/0008) for the directory/README conventions. New prototype: `docs/plans/prototypes/import-map-plane/`.
- Pinned versions to use (from `pnpm-workspace.yaml`): `react: 19.2.9`, `react-dom: 19.2.9`. For the prototype, load React from `esm.sh` (e.g. `https://esm.sh/react@19.2.9`, `https://esm.sh/react-dom@19.2.9/client`) OR from locally-built ESM — pick whichever makes singleton identity provable; esm.sh is fine for a spike.
- The runtime map (`ui/src/lib/runtime-map.gen.ts` / `.bos/generated/runtime-map.json`) describes ui sources per slot — the production analog of "which remotes compose". The prototype should mirror its *shape* (two remotes + core), not consume the generator.
- MF stays untouched: do not modify `packages/every-plugin`, `host/`, or the ui workspace.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Prototype dev server (any static server, e.g.) | `cd docs/plans/prototypes/import-map-plane && pnpm exec sirv . --dev --port 4410` | index loads at http://localhost:4410 |
| Typecheck (prototype-local, TS 5) | `pnpm exec tsc --noEmit -p tsconfig.json` (inside the prototype dir) | exit 0 |
| Repo-wide gates must stay green | `pnpm run typecheck && pnpm run lint` from repo root | exit 0 (prototype ignored per AGENTS.md exemption — if lint trips on prototype files, check the exemption paths rather than editing repo config) |

## Scope

**In scope**:
- `docs/plans/prototypes/import-map-plane/` (create: `index.html`, two tiny remotes (`remote-a/`, `remote-b/`) as pre-built ESM files, `importmap.json` (the published artifact), `README.md` with the evidence report, minimal `tsconfig.json` + `package.json` pinning TS 5)
- `docs/plans/README.md` prototypes table row

**Out of scope**:
- Any change to `host/`, `packages/*`, `ui/`, MF config, or the publish pipeline.
- Server-side import-map loading (knitkit's Node SSR story is Phase-2 elsewhere; the prototype is browser-plane only).
- Semver negotiation, dynamic import-map updates (multi-map support is uneven across browsers — the prototype pins a static map).

## Git workflow

- Branch: `feat/proto-import-map-plane`
- Commit style: conventional commits, e.g. `feat(prototypes): import-map composition plane evidence`

## Steps

### Step 1: build two remotes as standard ESM

Two directories, each exporting a small React component (a counter, a list) built to a single ESM file whose *bare* imports (`react`, `react-dom/client`) are left unresolved (no bundler-inlined React). Any build path that emits ESM with bare specifiers preserved is fine (esbuild/rollup by hand in the prototype's own tooling).

**Verify**: `grep -c "from\"react\"\|from 'react'" docs/plans/prototypes/import-map-plane/remote-a/index.js` ≥ 1 — bare specifier present in the emitted module.

### Step 2: compose the import map and prove singleton identity

`importmap.json` maps: `react` → one URL, `react-dom/client` → one URL, `remote-a` → its file, `remote-b` → its file. `index.html` loads `<script type="importmap">` (inlined or fetched) then dynamically imports both remotes and mounts them.

The singleton proof: both remotes call a React hook that is stateful across instances if (and only if) React is one instance — simplest: remotes register themselves via `React.createElement` and the page asserts `remote-a's React === remote-b's React` (pass the module namespace through a shared accessor, or compare `Symbol`-keyed registry entries React sets on itself). Put the assertion in the page and render PASS/FAIL.

**Verify**: open the page → both remotes render AND the singleton assertion renders `PASS`. Cross-check in DevTools → Network: exactly ONE fetch of the react URL.

### Step 3: the on-chain-map thought experiment, made concrete

Add `published-map.example.json` — the map exactly as it would ride the runtime config (a config well-known slot like ADR 0034's `platform.json` beside the config) — and have `index.html` fetch `?map=importmap.json|published-map.example.json` to demonstrate the map is swappable data, not build output. In the README, write the verification chain: on-chain config → map JSON → per-URL SRI pins (map entries gain `integrity` fields — import maps support `integrity` per mapping) → browser fetches. Note honestly what import maps do NOT verify (subresource integrity coverage for dynamic imports varies; document what the prototype actually demonstrates vs assumes).

**Verify**: page loads under both `?map=` values; README documents the chain with the SRI-caveat stated.

### Step 4: evidence report (`README.md`)

Sections: what was proven (singleton by construction, one React fetch, map-as-data); what was NOT proven (server-side composition, hot reload, CSS co-loading, chunked app bundles, browser-support matrix — note evergreen-browser support and `es-module-shims` as the fallback); the LOC delta estimate (what `SharedSingletonSkewError` machinery this substrate would obsolete server-side vs what it can't — MF node in-process loading stays); recommendation (adopt as the ADR-0024-adjacent seam now, revisit server-side when native-federation/knitkit Node loaders mature).

**Verify**: README complete; `docs/plans/README.md` prototypes table gains the row with a one-line verdict.

## Test plan

- The page's PASS/FAIL singleton assertion is the test. Optionally a Playwright check mirroring `tests/regression/browser/` conventions — but keep it inside the prototype dir (prototype-local `package.json`), NOT the repo's regression suite.
- Repo gates stay green: `pnpm run typecheck && pnpm run lint` from root.

## Done criteria

- [ ] Prototype dir exists with two ESM remotes, import map, swappable `?map=` loading
- [ ] Singleton assertion renders PASS; exactly one React network fetch (documented screenshot or manual note in README)
- [ ] `published-map.example.json` demonstrates the map-as-config-artifact shape with SRI fields
- [ ] Evidence report complete (proven / not proven / LOC-delta estimate / recommendation)
- [ ] Repo typecheck + lint green
- [ ] `docs/plans/README.md` updated

## STOP conditions

Stop and report back (do not improvise) if:

- Bare-specifier ESM remotes can't be produced with the prototype-local tooling (bundler insists on inlining React) — report the tooling used and the blocker.
- The singleton assertion can't be made (React 19.2.9 doesn't expose a stable self-identity check) — use an alternative proof (double-fetch observation via Network tab + module-namespace identity through a broker module) and document it.
- Repo lint/typecheck trips on the prototype despite the documented exemption — report; do not edit repo lint config.

## Maintenance notes

- If ratified as a seam, the successor design work keys off: map generation from the runtime map, per-URL SRI pinning, and the FastKV publish slot — none of which this prototype builds.
- Reviewer scrutiny: the honesty of the "not proven" section — import-map enthusiasm routinely overstates server-side readiness; this repo's server composition is the blocker and stays MF.
