# ADR 0005: `app.ts` is the authored surface — build configs and infra absorb into the app descriptor

Date: 2026-09-18
Status: Accepted (phase 1) — the config loader reads `bos.app.ts` alongside `bos.config.json` (import-extends and bos:// extends), publish/sync canonicalize the resolved config to JSON for FastKV, and `bos init` scaffolds children with the TS config form. Phase 2 (absorbing railway.toml/build configs into the descriptor) remains planned.

## Context

This repo now has one config *generator* per concern and several config *surfaces* to keep in sync:

| Surface | Owner today | Sits in |
|---|---|---|
| app composition (account, domain, plugins, secrets) | human-authored | `bos.config.json` (sync-owned shape) |
| deploy/infra (healthcheck, restart policy) | human-authored | `railway.toml` |
| plugin builds | framework | `rspack.config.js` × N (reduced by ADR 0002) |
| script surface | human-authored | per-workspace `package.json` (reduced by ADR 0003) |
| production URLs/integrity | pipeline-written | `bos.config.json` (written back by `reportDeployResult`) |

`plans/beta-v2/composable.md` already commits to the destination: `App()` returns a pure typed descriptor, `bos dev` / `bos publish` import it, published JSON is auto-generated, alchemy owns deploy. This ADR extends that plan to absorb the **build-tooling** surfaces it did not yet cover, so that what remains human-authored is a single `app.ts` per repo.

## Target

Root `app.ts` — the one file developers write per repo:

```ts
export default App({
  account: "v1.citynode.near",
  domain: "citynode.app",
  workspaces: {
    ui: path("ui"),
    api: path("api", {
      variables: { platformAccount: "v1.citynode.near" },
      secrets: ["API_DATABASE_URL", "LUMA_CALENDAR_API_KEYS"],
    }),
    auth: path("plugins/auth"),
  },
  infra: Railway({           // absorbs railway.toml
    healthCheckPath: "/health",
    healthCheckTimeout: 300,
    restartPolicy: { type: "ON_FAILURE", maxRetries: 10 },
  }),
});
```

Derived-or-absorbed by the pipeline:

- `rspack.config.js` deleted entirely in the common case: every item it listed (ADR 0002) is either derived from the plugin's own declarations or is a framework standard; per-workspace overrides move into a typed partial `build.config.ts`.
- integrity/production URLs are pipeline state (FastKV write through `withPluginDeploy` → later the deploy pipeline itself), never source. Today's write-back to `bos.config.json` disappears alongside the file.
- Script surface: `bos` CLI reads descriptors directly (no per-workspace `dev`/`build` scripts needed), though scripts may remain as thin aliases for direct invocations.

Effect pipeline (in `packages/everything-dev/src/build/pipeline.ts`):

```ts
const deployWorkspace = (ref: WorkspaceRef) => Effect.gen(function* () {
  const plan = yield* buildPlan(ref);            // app.ts descriptor → build plan
  yield* spawn(plan);                            // every-plugin CLI / rsbuild
  const url = yield* zephyrDeploy(plan);         // scoped acquireRelease-style
  yield* integrity.write(ref, url);              // field path derived from app.ts
}).pipe(Effect.provide(AppConfig.Live));          // app.ts loaded once as a Layer
```

`App()` as a Layer + descriptors as data + spawn as Effects is the honest Effect.TS idiom: lifecycle and async resource ownership (deploy, scoped resources) get Effect's semantics; the rspack internals stay plain data passed to rspack's API.

## Consequences

- Sync-owned files shrink to `app.ts` (+ per-workspace package.json basics); `bos sync` concentrates on one authored shape.
- Large orchestrator work is required in `everything-dev/src/cli` (init/sync/upgrade/publish/types-gen must read+generate from `app.ts`) — this is beta-v2 trunk work, tracked in the wayfinder ticket referenced from `plans/beta-v2/overview.md`, not bundled with ADRs 0002-0004.
- The UI grafting plan (route grafting, mount points) composes *at runtime* and is orthogonal to the build surface; it is unaffected except that plugin web bundles will adopt the same composed stack when their build config is added (per `plans/beta-v2/ui.md`).
