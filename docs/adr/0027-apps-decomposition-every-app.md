# ADR 0027: The `/apps` decomposition — verifiable apps, a runtime composer, and the `every-app` seam

Date: 2026-10-12
Status: Accepted
Builds on: [ADR 0020](0020-child-bundle-storage-r2.md) (bundle store + version manifests), [ADR 0021](0021-universal-runtime-image.md) (universal image, tier model), [ADR 0022](0022-two-roots-app-and-workspace.md) (two-roots workspace model)

## Context

The repo's design intent (`packages/everything-dev/NOTE.md`): *the everything-dev package should essentially be a composition of the `/apps` in this repo, using their clients through the CLI — the runtime for the BOS that composes verifiable apps together, accessed via a gateway.*

Today the codebase does not match that intent. The auth experience is smeared across five locations (`plugins/auth`, `plugins/auth/ui`, the core `ui/src` org-admin dashboard, the host's first-class auth slot, and the separately published `better-near-auth` library). The upload service was just extracted from `api/`+`host/` into `plugins/artifact-control` — but nothing deploys it, and the deploy train's storage-origin resolution still defaults to the gateway origin where its route no longer exists (production upload is broken at the time of writing). The `apps/` directory holds only aspirational READMEs (`_` host, `build`, `dev`, `upload`, `auth`, `www`). Starter-ness is implemented as route-exclusion globs inside `bos init` rather than as a reference app. And the repo's package README documents subpaths that do not exist while missing ~16 that do.

## Decision

**The repo decomposes into a set of standalone, verifiable apps plus a runtime that composes them.** The composer consumes apps **only through their typed clients**; the host boots apps from one app-facing contract; and the "app" abstraction lives in a new workspace package, `every-app`, sitting between `every-plugin` and `everything-dev`.

### 1. The module map

```
packages/every-plugin      module seam — unchanged (createPlugin, build, dev-host)
packages/every-app         app seam (new — see §3): AppSpec, bootApp, ports
packages/everything-dev    composer: thin CLI, deploy train, resolution engine,
                           everything-dev/app = pure re-export (never a definition site)
packages/better-near-auth  the auth library — unchanged, published separately
apps/upload                absorbs plugins/artifact-control (write/control surface)
apps/auth                  absorbs plugins/auth + auth-ui + the org-admin dashboard
apps/dev                   the development app: per-project sidecar + dashboard
apps/build                 the reference child app — what bos init scaffolds from
apps/www                   the production everything.dev app: ui/ + api/ move here
host/                      the gateway: composed serving adapter + tenant resolution
```

The base runtime's own `ui/`/`api/` are themselves an app on the platform (`apps/www`) — the decomposition is honest only if the framework's own app obeys the same rules as any child.

### 2. The three seams

- **Seam A — app ↔ host (the AppSpec).** The repo has two "serve an app" implementations (the full Hono host; `every-plugin`'s `startDirectModuleHost`) with no shared contract. `bootApp(spec)` becomes the single boot function; the full host and the direct standalone server are **two serving adapters at one seam**. Their differing failure semantics are preserved by design (standalone fails-and-exits; composed degrades-and-serves). The implementations are deliberately not merged.
- **Seam B — composer ↔ app (the client).** Every app ships a typed client export; the deploy train and the thin CLI never import app internals. `@everything-dev/artifact-control-plugin/client` is the exemplar; this becomes structural.
- **Seam C — ports.** The app seam carries three real ports (see §3). Ports with a single adapter are cut (seam discipline).

### 3. `every-app` — and why not `everything-dev/app`

`bootApp` **never resolves config and never reads `BOS_*` env for structure.** Config arrives as a pre-resolved, schema-validated subtree (`ResolvedAppConfig`, versioned zod schema) handed across a process boundary by the spawner — generalizing the proven `BOS_RUNTIME_CONFIG` pattern. `selectAppSubtree(resolved, key)` is a pure function owned by `every-app` so the CLI, the host, and spawned servers cannot drift. Single-app mode (`BOS_APP`) therefore **selects a subtree of the resolved config; it never bypasses resolution** — children that `extends` the base and override remotes through FastKV keep working unchanged on the same image.

Why a package and not an `everything-dev/app` subpath: `everything-dev` depends on the upload app's package for the deploy-train client (`workspace:^`), and the upload app is publishable (not private, changesets-versioned). If the app booted via an export of `everything-dev`, the two published packages would depend on each other — a cycle pnpm install tolerates but npm publish and changesets do not (bootstrap impossible, lockstep `updateInternalDependencies` bumps). `every-app` gives both sides a downward dependency. Extending `every-plugin` is rejected for the mirror reason: it would drag the resolution vocabulary into the interface of every plugin author, for a concern only apps have — a plugin is a module; an app is a boot composition.

Port inventory (two-adapter rule enforced):

| Port | Adapters | Verdict |
|---|---|---|
| `SessionVerifier` — `verify(headers) → session \| apiKey \| null`, never throws | in-process (host, from the auth plugin's services) + remote-HTTP (absorbing the upload app's `verifyApiKey` call); fixture for tests | **Keep** — two production adapters already exist in the tree with duplicated error taxonomies |
| `StorageClient` — put/get/list, SRI metadata | S3 (R2 via aws4fetch) + in-memory (dev/test) | **Keep** — promoted from the upload app; model port |
| `SidecarTransport` — request/subscribe for the CLI ↔ dev-sidecar seam | stdio NDJSON (production) + in-memory loopback (tests) | **Keep** — makes the thin CLI testable |
| `ConfigSource` at the app boundary | — | **Cut** — one adapter; the real two-adapter seam is `ResolutionIo` inside `everything-dev/resolution` |
| DB, NEAR signing, MCP/OpenAPI | — | **Cut** — no second adapter; projections or CLI-internal |

### 4. `apps/auth` — dual-purpose deployment

Auth runs **twice against one shared database**: in-process in the base runtime, and standalone at `auth.everything.dev` (its own Railway service, same universal image). Consequences, settled deliberately:

- The **standalone deploy is the sole relay / gas-sponsor writer** (NEP-366 relayer, `TransferToGasKey` funding). The in-process instance runs relay-disabled. This defers the cross-process nonce-allocator and DB-enforced funding-cap work until a second writer actually exists — the per-process in-memory `NonceManager` (near-kit) and the read-then-act funding cap are both unsafe under concurrent writers, and the `relayer_key` table needs a unique constraint on `network` before any second writer boots against an empty table.
- Both deployments share an identical `BETTER_AUTH_SECRET` (the relayer key self-destructs and regenerates on a decrypt mismatch — a secret mismatch is destructive, not benign).
- Session sharing across the `everything.dev` family uses `crossSubDomainCookies` + cross-listed `trustedOrigins` + shared passkey `rpID`/`gatewayOrigins` (host-only cookies are the current default; SSO across hostnames is not free). The better-auth **SSO plugin is not the tool** for this — it is the consumer side for enterprise IdPs; it is parked until an organization wants to bring its own Okta/Entra (its provisioning composes with the existing org plugin).
- **Child apps on other domains** that use the shared auth get it via the **OAuth 2.1 Provider plugin** on `apps/auth` (OIDC authorization server; composes with the existing device-authorization grant and MCP). Alternatively a child deploys its own auth from the same remote bundles — both modes are first-class.
- `BOS_STORAGE_AUTH_ORIGIN` (the upload app's key verification) points at the standalone auth deploy.

### 5. `apps/dev` — the sidecar

The stateful half of the CLI-as-plugin (`dev-program`, `orchestrator`, `dev-session`, process/PID registry, port allocation, db bindings, log pipeline) becomes an **app**: a per-project sidecar spawned by the thin CLI, which becomes its client (stdio transport) with the existing TUI attached as a streaming front-end. The sidecar is the **sole** registrant of ports/PIDs and the sole writer of `.bos/` session-lifetime artifacts. Its dashboard is a UI remote composed into the local host via `bos.dev.ts` (dev-only, never published). The sidecar inherits session-parent duties (process-group kill escalation, orphan adoption/reaping) exactly as the CLI process holds them today. Image layering: `apps/dev` ships a canary image built from source on merge (experimental host + packaging) → `dev.everything.dev`; the universal image stays releases-only; children always consume the universal image.

### 6. `apps/build` and `apps/www`

`apps/build` is the reference child app — the thing `bos init` scaffolds from — replacing starter-level route-exclusion globs in the CLI with content: locality moves from CLI code into the reference app's file tree. `apps/www` receives the root `ui/` + `api/` and deploys on the published production image.

## Consequences

- Dependency graph stays acyclic and enforceable by the pnpm workspace: `every-plugin ← every-app ← {everything-dev, host, apps/*}`; apps depend only on `every-app` + `every-plugin` (+ their own clients).
- `host/src/services/plugins.ts` (the 892-line loader) shrinks to a serving adapter over `AppRuntime`; the two-phase DAG loader, singleton dedupe, secret resolution with DB fallback, and `pluginsClient` assembly live once, in `every-app`.
- Every future standalone app is a spec + ~10 lines instead of a hand-rolled `server.ts`.
- The upload app's contract grows its inspection surface (`listBundles`, `listVersions`, integrity reports; `bundles:read`) and byte-identical re-uploads become confirmed no-ops (SRI metadata compare), converging on ADR 0020's "unchanged republishes are pointer no-ops."
- Documented end-state (deliberately deferred): **content-addressed storage keys** — identical bytes stored once, keys referencing content hashes. This is the deeper form of the upload dedup guarantee, but it rewrites the key layout that CDN cache-control and version-manifest pinning depend on; not a first-pass move.
- Sequencing: phase 0 = `apps/upload` absorbed + hardened + deployed (un-breaks production upload); phase 1 = `every-app` extraction + host adapter; phase 2 = services map + `SessionVerifier` wiring; phase 3 = `apps/auth` dual-deploy (∥ phase 4 = `apps/dev` sidecar); phase 5 = `apps/build` + `apps/www`.
- Phase 0 keeps the upload app on its current `every-plugin` footing (`server.ts` stays); the boot seam lands in phase 1 when the host adapter gives it real consumers.
