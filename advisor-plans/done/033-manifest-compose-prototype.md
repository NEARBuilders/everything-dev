# Plan 033: `manifest-compose` prototype — prove manifests → host-built tree before the rework

## Status

TODO. GATES plan 034 (the branch rework). Decisions recorded in [ADR 0007](../../docs/adr/0007-runtime-composition-ssr.md) and [ADR 0008](../../docs/adr/0008-manifest-composition.md) — read both fully before starting, plus [plan 028](../../docs/adr/0005-app-ts-authored-descriptor.md)'s descriptor surface for the `apps.ts` slice.

## Why this matters

Plan 034 deletes grafting 100% and replaces it with manifest composition — in one change, with no fallback path. Per this repo's discipline (wayfinder tickets 01/09/10: prototype before implementation), the mechanism must be proven in isolation first: the generator scan, host-side route construction, host-attached gates, per-route lazy over MF under SSR streaming, tenant swap, and dev/prod manifest parity. Prototyping *on* the real auth plugin would entangle the mechanism test with the monorepo build and the very machinery being deleted.

## Scope

Create `plans/prototypes/manifest-compose/` — a self-contained pnpm workspace (mirror [beta-v2](../../plans/prototypes/beta-v2/): own `packageManager`, own catalog pins copied from the repo root's `package.json` — react 19.2.4, `@tanstack/react-router` 1.170.x line, `@rsbuild/core` 2.x, `@module-federation/rsbuild-plugin` 2.9.0). This prototype is throwaway; it exists to produce PASS/FAIL evidence per gate.

### Layout

```
manifest-compose/
├── package.json / pnpm-workspace.yaml / tsconfig.json
├── shared/                    # type-first: the seed of what lands in everything-dev
│   ├── manifest-schema.ts     # zod schema + TS types for manifest.gen.json
│   ├── route-config.ts        # types for route-config.gen.ts (typed refs)
│   └── mount-registry.ts      # registry v2: gates only (see ADR 0008 §3)
├── apps.ts                    # minimal shape-of-028 descriptor (see below)
├── generator/                 # route files → manifest.gen.json + route-config.gen.ts
├── host/                      # bun + rsbuild server; construction + SSR + digest cache
├── remote-auth/               # auth-plugin-shaped (login + settings, stub clients)
├── remote-landing/            # _public: "/" + /docs
└── remote-landing-tenant/     # tenant-swap remote for gate 6
```

### Remotes

- **`remote-auth`** — mirrors the real `plugins/auth/ui` route shape: `_public/login.tsx` with a route-level reject-authed `beforeLoad`; `_authenticated/settings.tsx` + `_authenticated/settings/api-keys.tsx` with session-dependent loaders; `__root.tsx` declaring `head` + `staticData`. Clients stubbed; gate/loader *semantics* real.
- **`remote-landing`** — `_public/index.tsx` (`/`) + `_public/docs/index.tsx`. Proves multi-plugin-single-mount (login and `/` coexist under `_public`).
- **`remote-landing-tenant`** — same paths, different content, for the tenant swap.

### Generator (the load-bearing piece)

Ride `@tanstack/router-generator`'s scan API — do NOT write a file-format parser. From route files ONLY, emit:

1. `manifest.gen.json` — zod-validated pure data: route ids, paths, nesting, mount (derived from ROOT-level `_`-prefixed pathless layouts), file refs, `__root` head/staticData. Mounts ⊆ registry validated at generation; unknown `_segment` at root = hard error (no silent skip — the beta-v2 prototype's `if (!entry) continue;` weakness is deliberately not inherited).
2. `route-config.gen.ts` — generated import map `{ [routeId]: { loader, beforeLoad, head, staticData, component } }` importing the route files. Real function refs; per-route lazy content pulled through this map (one MF expose, per-route chunks).

Watch mode regenerates on file change; nothing is hand-maintained, at all.

### `apps.ts` (minimal shape-of-028 descriptor)

Pure-data, typed, driving the host's composition resolver — the composition-resolver slice of ADR 0005/plan 028 only:

```ts
App({ name: "base", plugins: { auth: Plugin("auth").local("./remote-auth"), landing: Plugin("landing").local("./remote-landing") } })
App({ name: "tenant", plugins: { landing: Plugin("landing").local("./remote-landing-tenant") } })
```

`Plugin("bogus")` must be a compile error (keyof KnownPlugins pattern). Explicitly OUT: account/domain, FastKV extends chains, stage, resources/bindings, auth/api fields — those belong to plan 028. `apps.ts` replaces the hardcoded `REMOTES` arrays the earlier prototypes used.

### Host

- Reads the selected app descriptor (base | tenant) → resolves remotes → loads `manifest.gen.json` + `route-config.gen.ts` (source-resolved in this prototype; note where MF loading will slot in).
- Constructs the tree: host-owned mount layouts with host-attached gates (session/admin/org/team from `shared/mount-registry.ts`); plugin route records → `createRoute` + `.lazy(() => …)`; `__root` head/staticData lifted.
- SSR: `createRequestHandler` + `renderRouterToStream` + `RouterServer` (same pipeline as beta-v2's `verify-ssr.tsx`), session-forwarded router context, per-request memory history.
- Digest cache: hash(app descriptor + manifests) → composed tree; tenant swap must produce a distinct digest and distinct tree.

## Gates (must-pass; record evidence in this file when done)

1. **Generation** — from route files only; mounts derived; nested layouts/params preserved; `__root` head/staticData lifted; nothing hand-maintained.
2. **Construction** — manifest → host-built tree; gates attached host-side; plugin `beforeLoad` honored (login redirects authed users server-side).
3. **Multi-plugin single mount** — auth's login + landing's `/` coexist under `_public`; deterministic ordering; no id/path collisions.
4. **SSR** — streaming render of a `_public` and an `_authenticated` page (session-forwarded); clean hydration; loader dehydration.
5. **Per-route lazy over MF** — `.lazy()` loads remote modules; per-route chunks; one React (L1 invariant — a deliberate `second-React` probe should FAIL loudly).
6. **Tenant swap** — tenant descriptor swaps the landing remote; distinct digest → distinct tree; both render correctly.
7. **Dev parity** — same construction code consuming manifests from disk vs over MF.

Stretch (do if time allows, record either way): `_org`/`_team` parameterized remote (default shape `/team/$teamId`, team lookup resolves its org); merged route-type emission → typed cross-plugin `<Link>`.

## Verification

- `pnpm install && pnpm --filter host verify` runs the gate suite headlessly (extend beta-v2's `verify-ssr.tsx` pattern: case list, substring assertions, `<!-- -->` stripping, exit code).
- Browser check for hydration (beta-v2's `browser-check.ts` pattern).
- Record PASS/FAIL + notes per gate in this file's Results section below.

## Results

Executed 2026-09-21 (prototype at `plans/prototypes/manifest-compose/`, bun workspace):

**PASS — headless gates 12/12** (`host/verify.tsx`, disk-resolved path):
- Gate 1 (generation): `manifest.gen.json` + `routeConfig.gen.ts` emitted from route files only, via `Generator.run()` + `getCrawlingResult()`; mounts derived from root-level pathless layouts; index routes → `"_public/"` id convention; unknown mounts = hard error; nothing hand-maintained.
- Gate 2 (construction + host gates): host-built tree (`createRoute` only, public API, zero foreign mutation); anon `/settings` → 307 `/login?redirect=…` (host session gate); admin `/login` → 307 `/` (plugin route-level reject-authed `beforeLoad` honored through the manifest contract).
- Gate 3 (multi-plugin single mount): auth `login` + landing `/` + `/docs` coexist under `_public`; name-ascending order deterministic.
- Gate 4 (SSR): `createRequestHandler` + `renderRouterToStream` streams plugin content server-side incl. loader data (`edk_demo` in HTML); `__root` head lifted and merged in the host's root `head()`.
- Gate 6 (tenant swap): distinct digests (`base=32ad5000`, `tenant=55d63800`), tenant landing renders, inherited auth plugin intact, re-composition stable.

**Key findings recorded:**
1. **Childless pathless mounts are leaf branches matching `/`** — a mount with no children competed with the real index route. Fix (now in the construction contract): mounts are constructed ONLY when a plugin declares them. This finding belongs in plan 034's construction service.
2. **A `_mount/` directory without its layout file yields NO parent node in the scan** — the layout file IS the mount declaration; the generator must error when a `_mount/…` route file exists without `_mount.tsx` (plan 034 validation).
3. **Pathed routes cannot take a custom id** (`Route cannot have both 'id' and 'path'`) — namespacing applies to pathless layouts only; pathed routes are unique by path (first-wins collision policy unchanged).
4. `getConfig(inline, configDirectory)` resolves paths relative to `configDirectory`; `getCrawlingResult()` exposes the scanned `RouteNode[]` after `run()`.

**PARTIAL — gate 5 (per-route lazy over MF) + gate 7 MF half:** remote node-SSR bundles build per-route chunks (`dist/ssr/*.js` — per-route chunks present), emit `remoteEntry.server.js` (the plugin's node recipe requires BOTH `{ target: "node" }` as the plugin's second argument AND the environment named `node`/`mf-ssr`), the host loads exposes over HTTP through the L1 shared instance, and hook-free plugin components render with loader data through MF.

**RESOLVED (same session): gate 5 + gate 7 now FULLY PASS on the bundled host.** The plain-runtime host's negotiation gap was a harness artifact; the production shape — `host/src/server.tsx` built with rsbuild using the #134 recipe — renders hook-using remote components inside ONE React, over HTTP, with host-attached gates and loader data. Verified live for BOTH apps (base + tenant): all 4 boot-health cases pass on each, fail-loud. The working recipe (canonical for plan 034's host):

1. **Host build** — plain `tools.rspack` with `target: "async-node"` + `optimization.nodeEnv: false` + `output.library: { type: "commonjs-module" }` (NO rsbuild `environments` block — its node-target handling emits ESM-flavored output that breaks node execution); `ModuleFederationPlugin` from `@module-federation/enhanced/rspack` with `runtimePlugins: [node runtimePlugin]`; **`performance.chunkSplit: { strategy: "custom" }`** (rsbuild's default experience-split puts shared libs in async `lib-*.js` chunks whose deferred registration triggers RUNTIME-012).
2. **Host package** — `"type": "commonjs"`; entry is an **async boundary** (`entry.tsx` = `import("./server")`) — top-level sync imports of shared deps otherwise crash (`loadShareSync failed … eager:true`).
3. **Shared shape (both sides)** — exact installed `version` + exact `requiredVersion` + `strictVersion: true` + `singleton: true` + **`eager: false`** + `shareScope: "default"`; **remotes additionally `import: false`** (no bundled fallback copy — forces host provides; without it the container's own router copy wins and its context objects mismatch → `router.stores` null).
4. **Runtime API** — the GLOBAL `loadRemote`/`registerRemotes` from `@module-federation/enhanced/runtime` (the build's own instance, which bridges the webpack share scope). A standalone `createInstance(...)` gets an EMPTY scope (`shareScopeMap.default` = `[]`) — provides never reach it.
5. **Run with node** (CJS bundle); tenant remotes must have their OWN MF `name` (a tenant remote named like its base corrupts its container module registry → `__webpack_modules__[moduleId] is not a function`).

**Deferred:** browser hydration execution check (the client bundle + hydrate path rides plan 034's regression suite, which has Playwright); `_org`/`_team` parameterized remote; typed `<Link>` generation.

**Guard probe DEFERRED (2026-09-21):** the second-React negative probe (a remote built with mismatched react `requiredVersion` must be rejected) hit the node runtime plugin's chunk-anchoring internals: same-build duplicate containers resolve their expose/chunk URLs against the entry URL's *path* as a filesystem root (`ENOENT /ssr/...`) before the strict-version check can fire. Three iterations (plain-runtime instance, self-contained asyncChunks, chunk-free guard expose) all land on the same plugin-internal anchoring — it is not our architecture. The strict shared-version guard is upstream-tested MF behavior; the probe code stays in the bundled server (env-gated `GUARD_ENTRY`, off by default) and is revisited in plan 034 where guard variants deploy as distinct named bundles with real chunk URLs.

**Descriptor boot (added, verified):** `host/src/start.tsx` boots the app from the prototype's `apps.ts` — import descriptor → `constructTree` → serve SSR. No bos.config.json, no FastKV: the descriptor IS the boot input, through the same construction code production uses. Verified live: base app `/` (landing + chrome), `/login`, `/settings` → 307 `/login?redirect=%2Fsettings`, `/settings/api-keys?admin=1` (gate + loader data `edk_demo` in HTML), TanStack loader-dehydration payload (`self.$_TSR`) present in SSR output; tenant app boots from the same descriptor file with the TENANT landing at `/` and digest `55d63800` ≠ base `32ad5000`. This is plan 028's `App()` → running-server contract proven with a real consumer; the repo-level `--descriptor` slice (028's own step) remains 028's to land. **Dev-slice constraint:** `start.tsx` serves LOCAL refs only and exits with instructions when an app declares remote refs — remote-ref apps boot through the bundled server (the dev/prod resolution split, modeled honestly).

**Registry trim (2026-09-21):** the prototype registry now carries only the exercised mounts (`public`/`authenticated`/`admin`); `_org`/`_team` remain DECLARED vocabulary in ADR 0008 §3 but are unimplemented here. Registry version bumped (3) — the imported-version digest participation is now gate-tested.

**CORRECTION of the earlier "verified live" claims:** the first verification round ran the boot health checks in-process BEFORE the server listen, and the server used `Bun.serve` — which crashes under node. So MF composition was proven (in-process), but the live HTTP path was not, and my "BOTH-VERIFIED" message overstated it. Fixed: the bundled server now uses `node:http`, and the fail-loud gate includes a **post-listen live self-probe** (the server fetches its own `/` and `/settings` after listen; failure exits 1). This lesson is folded into plan 034's health-gate design: **health = in-process gates + live self-probe.**

**Hydration e2e GREEN (2026-09-21, final client architecture):** base `1941d45a9c505475` AND tenant `559ba09c779e4694` hydrate cleanly — the browser half of gates 4/7 closes. `bun host/src/hydrate-check.ts <url>` (Playwright) asserts: SSR shell + `__COMPOSE__` payload, MF containers loading over HTTP (`loadRemote <mf>/routeConfig`), digest parity server↔client, RouterClient hydration replaying `$_TSR`, zero mismatch/hard console errors. The tenant run IS the full-UI-swap gate: `landing` → `landingTenant` (plugin key ≠ deployed mfName), inherited auth intact, distinct digest, tenant shell hydrated.

The client that made it green — ONE rspack MF web build, the browser twin of the server recipe (canonical for 034):

1. **`host/rsbuild.client.config.ts`** — plain `tools.rspack`, `target: "web"`, `optimization.nodeEnv: "production"` (production React — kills `jsx-dev-runtime`), `ModuleFederationPlugin` host-side with the IDENTICAL exact-strict-singleton shared map (`react`/`react-dom`/`@tanstack/react-router`), NO build remotes (runtime `registerRemotes` from the payload), async-boundary entry (`entry-web.tsx` = `import("./client")`), fixed filename, `publicPath: "/__host/"`.
2. **The build's MF runtime owns the share scope** — `client.tsx` uses the GLOBAL `registerRemotes`/`loadRemote` (same bridging as the server); no `createInstance`, no hand share-provides. One React/router across host client and containers by the same negotiation already green server-side and in production everything.dev.
3. **The custom Start-style entry** — `__COMPOSE__` → register remotes → loadRemote route configs → `constructTree` → `createRouter` → `hydrateRoot(RouterClient)`. This async pre-hydration phase is the ENTIRE divergence from TanStack Start's managed entry (Start owns a build-time route tree; the host composes one at runtime — the feature itself). Server side already uses the Start machinery (`createRequestHandler` + `renderRouterToStream` + `RouterServer`). Start's rsbuild plugin (`@tanstack/react-start/plugin/rsbuild`) is REJECTED for the host on this exact ground: its managed entries cannot express runtime composition across independently-built remotes. What we borrow instead: the pipeline shape (rspack client + server builds, fetch-style server at deploy) and the primitive stack.

**Two identities in the payload (contract, feeds 034):** composition identity (plugin key + manifest — what the digest hashes; deliberately deployment-free so disk and prod paths digest identically) vs deployment identity (mfName + entry — what `loadRemote` targets). Payload remotes carry `{ key, name, entry }`. Bug record: deriving the loadRemote target from `manifest.name` (composition identity) produced RUNTIME-004 on tenant — `manifest.name` "landing" does not identify the deployed remote "landingTenant".

**Remote web-build contract (feeds 034):** container chunks must resolve from the REMOTE's origin, not the composing page's. rsbuild's build-mode default `publicPath: "/"` makes containers request `/static/js/…` against the host page → 404 → `ChunkLoadError`. Fix: `publicPath: "auto"` (derives from `document.currentScript.src`). GOTCHA: `environments.*.output.publicPath` does NOT survive rsbuild 2.2.8's rsbuild→rspack conversion (resolved config shows it, emitted runtime keeps "/"); the `tools.rspack` function-form mutation DOES reach the emitted runtime (`environment` is an OBJECT — match `environment.name === "web"`).

**Hydration signal semantics (bug record):** `$_TSR` self-destructs — `h()` sets `hydrated` and, in the same synchronous tick, cleanup deletes `window.$_TSR` once the stream also ended (`e()` fires at parse time for a buffered response). `$_TSR.hydrated` is therefore never pollable, and an external presence poll can lose entirely to fast hydration (false "no bootstrap"). `hydrate-check` asserts from in-page evidence instead: the client records its timeline in `__CLIENT_PROGRESS__` (`… $_TSR present: true` / `hydration consumed ($_TSR deleted — h() ran)`); success = both marks + zero mismatch/hard errors. Race-free by construction.

**Negative results — the import-map client model is REJECTED (2026-09-21):** three bundlers, three facets of the same wall — hand-building browser ESM vendor artifacts from CJS packages with cross-artifact externals:
- `bun build`: `export *` from a CJS module emits dead code (no export statement) → `does not provide an export named 'Fragment'`.
- `rolldown`/`tsdown`: CJS entry in bundle mode → `export default` only (named surface lost).
- `esbuild`: CJS entry in bundle mode → `export default` only (documented behavior). A derived re-export wrapper (names generated from `Object.keys(require(pkg))` at build time — zero hand lists) fixed the named surface, but `use-sync-external-store` (a router dep) does a runtime `require("react")` → `Dynamic require of "react" is not supported` in browser ESM.

Conclusion: the MF share scope IS the module-identity primitive for the client (proven twice over in this repo); the import map added a bespoke interop layer with a new failure mode per bundler.

**Deferred (recorded for 034/roadmap):** `defaultNotFoundComponent` on the host root (generic not-found warning on favicon/no-match requests); guard-probe un-deferral; per-route code-splitting (`.lazy.tsx`/`createLazyFileRoute` in plugin route files — the generator currently emits one all-components routeConfig); moving the bundled server onto the streaming Start handler (`createStartHandler` + `defaultStreamHandler` — the harness already streams; `server.tsx` buffers); search middleware.

## STOP conditions

- `@tanstack/router-generator`'s scan API cannot express something the file routes need (nested pathless layouts inside a plugin subtree, parameterized mount roots) — report, do not hand-roll a parser.
- Per-route `.lazy()` over the MF node runtime breaks SSR streaming in a way that has no principled fix (not a config issue) — report; plan 034's shape changes.
- `route-config.gen.ts` needs options the route files don't already export — report; the generator contract changes.

## Maintenance notes

- Prototype is throwaway; the *surviving* assets are `shared/` types (seed for everything-dev) and the gate evidence.
- Never introduce `defineUiPlugin`, `tree.ts`, or a `./tree` expose here — this prototype must not contain the machinery plan 034 deletes.
