# ADR 0011: Image-native artifacts — the runtime image is the deployment, the namespace is the topology

Date: 2026-09-24
Status: Accepted (amended 2026-09-26 — outbound local-first; amended 2026-09-26 — foreign-namespace proxy + stale-if-error cache; amended 2026-09-26 — [ADR 0020](0020-child-bundle-storage-r2.md) narrows image-native to the root's *boot* role and moves all bundle *distribution* to R2; [ADR 0021](0021-universal-runtime-image.md) makes the image universal across runtimes)

## Context

The platform's bundle artifacts (MF remotes: host, ui, api, auth, plugins) need
a home. Plan 029 shipped DB-backed storage (Postgres `bundle_objects`) with a
CLI upload path — immediately stuck in a bootstrap loop: the ui bundle could
not deploy (Zephyr's dual-env Module Federation conflict), the deploy workflow
aborted on it, the storage routes never went live, and the credential needed to
upload anything required a login page that only existed in the undeployed ui.

Separately, the fork's posture changed: this repo hosts the everything.dev
runtime until it merges upstream, after which citynode.app breaks off as a
thin child extending the published base.

## Decision

1. **The runtime image is the deployment artifact.** Each runtime's Docker
   image stages its own workspace dists (the regression stage's builds, laid
   out under `bundles/<account>/<gateway>/<workspace>/…`) and serves them
   same-origin from its own filesystem (`BOS_BUNDLE_DIR`). Deploying = building
   the image + publishing the config. No CDN provider, no upload credentials,
   no bundle database.
2. **Namespace-as-topology.** `bundles/<account>/<gateway>/<workspace>/…` is
   ownership: the runtime whose image stages that namespace serves it. The
   published config (FastKV) maps each workspace to the origin owning it — a
   child extends the base's published config and overrides only the workspaces
   it owns.
3. **Two tiers, derived from the descriptor.** All core slots local and no
   `extends` → self-contained (dists kept, `--config-path`-capable boot).
   Partial or `extends` → registry tier (dists stripped, boot from FastKV,
   remotes from URLs — unchanged for children).
4. **Bundle bytes stay off-chain.** FastKV/FastFS economics (~100 NEAR/MB,
   JSON-API serving, per-chunk transactions) make on-chain artifacts
   non-viable at MB scale; the published config carries the URLs (integrity
   fields as a later, deterministic-build follow-up).
5. **The DB bundle flow is deleted pre-release** (nothing shipped to npm since
   2026-08-18): `bundle_objects`, the upload route, the uploader, and the
   session/credential requirements. App-data Postgres is unaffected.

## Consequences

- CI's Deploy workflow un-breaks: platform-mode builds (no Zephyr attach),
  credential-free config publish, `railway up` ships the whole train in one
  image — release-train skew between the host and its remotes becomes
  structurally impossible for image-native runtimes.
- The `bos publish` platform branch writes deterministic URLs instead of
  uploading; `mf check` gates after the redeploy (it can only pass against the
  live image).
- Tenant bundles: a child's own image serves its own namespace; shared-host
  and sandbox tenants get dists staged into their host instance (plan 032).
  The former upload path's use cases are absorbed by the image model.
- Image size grows by the staged dists (~50 MB) — accepted; content-addressed
  staging keeps rebuilds incremental.

## Amendment (2026-09-26): the image consumes what it stages

Production citynode.app 502'd in a permanent crash loop: the boot fetched its
own plugin manifests from `https://<domain>/bundles/…` — through the public
gateway, back into the container that had not started listening yet. The
namespace principle (decision 2) was implemented inbound-only (the `/bundles/*`
FS route); every outbound fetch still used the absolute config URLs. A central
CDN was considered and rejected: it reintroduces the upload-credential
bootstrap loop this ADR deleted (plan 029) plus a shared failure point for
every tenant, while a disk read of already-staged bytes has strictly better
uptime than any network hop.

Decision (extends 1–2, does not change the tiers):

1. **Outbound local-first for the own namespace.** A self-contained runtime
   (`BOS_BUNDLE_DIR` set) resolves any own-namespace
   `<scheme>://<host>/bundles/<account>/<gateway>/<rest>` URL from its staged
   directory before touching the network (`BundleResolver`,
   `packages/everything-dev/src/bundle-fs-resolve.ts`, installed as a global
   fetch adapter at CLI boot — the one seam every boot-time consumer shares:
   config manifest discovery, contract-type fetches, orchestrator host
   loading, MF remoteEntry probes).
2. **The guard is namespace-scoped.** Only URLs matching the runtime's own
   `account`/`gateway` resolve locally; a foreign namespace falls through to
   the network fetch. The registry tier (children, `BOS_BUNDLE_DIR` unset) is
   behaviorally unchanged — fetching remotes from published URLs remains the
   platform default for every app sharing the base image. Containment is
   enforced against the namespace directory (not the bundle root), so
   traversal can never read a sibling namespace.
3. **Missing bytes are deterministic 404s.** The staged namespace is owned
   entirely (mirroring the FS route): a file absent on disk does not fall
   through to the network, where it would race a stale or foreign origin.
4. **Committed `bos.config.json` carries the deterministic post-publish
   bundle URLs.** `bos publish` already rewrites them on the deploy runner;
   the committed state matching the published state keeps local image builds
   self-consistent and makes the local-first path exercisable everywhere.

Consequences: a cold boot performs zero network round-trips through its own
origin — gateway, DNS, and ingress hiccups can no longer wedge a boot.
Foreign-namespace resilience for the child tier (proxy + stale-if-error
cache) is a separate amendment (Phase C direction).

## Amendment (2026-09-26): foreign-namespace bundle resilience — proxy + stale-if-error cache

The child tier's "separate amendment" landed: the host's `/bundles/*` route
(`host/src/routes/bundles-proxy.ts`) falls through to a proxy + stale-if-error
disk cache for namespaces mapped from the runtime config's slot URLs — a
base-origin outage now degrades to serving last-known-good bytes
(`x-bundle-cache: stale`) instead of a hard 502. The CLI fetch adapter gains
the same cache for boot-time outbound fetches
(`packages/everything-dev/src/bundle-cache.ts`, one cache root, two
entrances, `BOS_BUNDLE_CACHE_DIR`, default `.bos/bundle-cache` — deliberately
separate from `BOS_BUNDLE_DIR`: cached bytes are a resilience artifact, never
a deployment). Never enabled for plain dev sessions; cached bytes serve only
when the origin fails, so normal operation keeps serving fresh.
