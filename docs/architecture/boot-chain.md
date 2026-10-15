# The boot chain — the universal image's provider contract

The production platform boots through one chain: **Docker image → identity → FastKV config → CDN bundles → Module Federation runtime**. The chain contains zero hosting-provider references. Any host that can run a Docker container boots the platform identically; Railway is one instance of that contract, not part of the architecture.

This document is the contract. Changes to the boot path (anything referenced below) must keep it true or update this file in the same PR.

## The chain

```
docker run <image>
  │   CMD: node ./node_modules/everything-dev/dist/cli.mjs start --no-interactive --port ${PORT:-3000}
  │   (Dockerfile:159 — the image carries no config and no staged dists)
  ▼
identity resolution
  │   packages/everything-dev/src/start-config-source.ts:12
  │   precedence: --config-path → BOS_ACCOUNT/BOS_GATEWAY → config found on disk
  ▼
FastKV config fetch
  │   walkExtendsChain (packages/everything-dev/src/resolution/session.ts:469)
  │   GET https://kv.{test,main}.fastnear.com/v0/latest/<namespace>/<account>/apps/<account>/<gateway>/bos.config.json
  │   (packages/everything-dev/src/fastkv.ts:17, :40)
  │   policy: 10s timeout, 3 retries, capped exponential backoff with jitter;
  │   5xx/network retried, 4xx not (packages/everything-dev/src/http-client.ts:38)
  │   failure is loud: StartRemoteConfigMissing / StartFetchFailed → exit 1
  ▼
CDN bundle fetch
  │   installGlobalBundleFetch patches globalThis.fetch — every boot-time byte
  │   (manifest discovery, remoteEntry, SSR composition) crosses one seam
  │   (packages/everything-dev/src/resolver.ts:313; installed in cli.ts:233 and host/server.ts:38)
  │   policy: 30s per-attempt deadline, 4 retries, capped exponential (resolver.ts:215)
  │   no implicit cache: BOS_BUNDLE_CACHE_DIR is an operator opt-in only;
  │   a CDN outage fails loud rather than serving stale bytes (resolver.ts:393)
  ▼
Module Federation host boot (spawnRemoteHost, packages/everything-dev/src/orchestrator.ts:221)
  │   1. fetch host mf-manifest.json from the CDN base URL   — 10s  (orchestrator.ts:103)
  │   2. registerRemote + loadRemoteModule("host/Server")    — 60s  (orchestrator.ts:104)
  │   3. runServer({ config, port, env }); await ready       — 120s (orchestrator.ts:105)
  │   overall boot deadline 180s (orchestrator.ts:106)
  ▼
host program (host/src/program.ts:297 runServer, :56 createStartServer)
  │   boot SSR composition before /health; failed composition in production
  │   exits 1 so the deploy rolls back
  ▼
two-phase plugin composition (host/src/services/plugins.ts:598)
  │   plugins load in-process in dependency-DAG order building pluginsClient;
  │   the API entry receives the finished map (no HTTP roundtrips);
  │   failed plugins degrade instead of crashing the host
  ▼
request handling
      per-request tenant resolution: hostname → TenantBinding via
      GET /api/tenants/bindings (host/src/services/binding-resolver.ts:57,
      30s cache, stale-serve on failure) → tenant config walk, must extend the
      active base runtime; overrides touch only ui and plugins.<id>.ui with
      SRI verification; allowSsr gates tenant SSR
      (host/src/services/tenant-runtime.ts:388)
```

## The hosting-provider contract

A hosting provider is anything that can:

1. **Run the image** — `node` runtime, one process (`CMD` above); the start stack loads host, api, and plugins in-process through Module Federation, so the runtime needs only node.
2. **Provide identity** — `BOS_ACCOUNT` and `BOS_GATEWAY` env vars (or a mounted config: `--config-path`, or `bos.config.json` at `/app`).
3. **Provide secrets via env** — database URLs, `BETTER_AUTH_SECRET`, storage credentials, etc.
4. **Map one TCP port** — `PORT` (default 3000).
5. **Probe `/health`** — HTTP healthcheck reflecting plugin/SSR/self-probe status.

That is the whole surface. Fly Machines, GCP Cloud Run, AWS ECS/Fargate, Kubernetes, a VPS with `docker run`, and Railway all satisfy it unchanged.

## What is deliberately not part of the contract

- **The deploy train's last leg.** `deployImageToRailway` (`packages/everything-dev/src/image-deploy.ts`) is optional and gated on `RAILWAY_TOKEN` + `ci.railway.service`; skipped loudly otherwise. Image push (GHCR), bundle upload (R2), and FastKV publish are provider-independent.
- **Databases.** Postgres arrives via `*_DATABASE_URL` env; the image provisions nothing.
- **Storage cache tiers.** `BOS_BUNDLE_DIR` (staged namespace) and `BOS_BUNDLE_CACHE_DIR` (stale-if-error cache) are operator opt-ins via `docker run -e`; the published image sets neither (CDN-only, fail-loud).

## Future work: infrastructure as Effects

The platform's Cloudflare resources (R2 bucket, `cdn.everything.dev` custom domain, zone/DNS) are managed by hand today. The planned follow-up is an [Alchemy](https://alchemy.run) stack — Infrastructure as Effects, Apache-2.0, Effect-native (the same Effect v4 this repo runs) — under `infra/`, following Alchemy's file layout (`alchemy.run.ts` composition root, one file per Resource, stages). See issue #402. Railway has no Alchemy construct; it stays CLI-managed.
