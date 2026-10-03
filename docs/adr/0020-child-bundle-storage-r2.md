# ADR 0020: Child bundle storage — R2-backed CDN distribution for all namespaces

Date: 2026-09-26
Status: Accepted
Amends: [ADR 0011](0011-image-native-artifacts.md) (image-native stays for the root's *boot*, not its *distribution*)
Un-supersedes: the child-storage half of [ADR 0015](0015-platform-bundle-storage-orpc-file-transport.md) (the oRPC storage route design returns, with an object-store backend replacing the deleted Postgres flow)

## Context

ADR 0011 made the runtime image the deployment artifact: each runtime stages
its own workspace dists under `bundles/<account>/<gateway>/<workspace>/…` and
serves them same-origin. That closed the platform's own bootstrap loop — but
it left every *child* runtime with workspace bytes and nowhere to put them.

The mechanics of the gap: `bos publish` writes deterministic bundle URLs and
uploads nothing. A child that overrides a workspace (its own UI, its own
plugins) publishes URLs that resolve only against the image that stages its
namespace — which does not exist unless the child builds its own image. A
`*.everything.dev` shared-host tenant's UI override URL dangles at the base
origin (not staged → not proxied → 404). ADR 0011's own consequence noted
"shared-host and sandbox tenants get dists staged into their host instance
(plan 032)" — but plan 032 declared a dependency on plan 029's storage, which
ADR 0011 deleted. The child-tier bytes home was removed by the same decision
that made the root self-sufficient.

## Decision

**All bundle distribution moves to an R2 bucket behind a Cloudflare custom
domain (`cdn.everything.dev`); the root's image keeps only the boot role.**

1. **One URL contract for every namespace.** All bundle URLs — the root's own
   included — point at `https://cdn.everything.dev/bundles/<account>/<gateway>/<workspace>/…`.
   The path layout stays the ownership contract (ADR 0011 decision 2); the
   serving tier no longer distinguishes owners from consumers at the URL level.
2. **Dual home for the root's own bytes.** The image continues to stage the
   root's namespace (`BOS_BUNDLE_DIR`) as the **boot** source — the outbound
   fetch interceptor (`bundle-fs-resolve.ts`) matches own-namespace URLs by
   *path*, not origin, so local-first cold boot is preserved even with CDN
   URLs. The same deploy train (`bos publish --deploy`) uploads the root's
   dists to R2 and rebuilds the image, so the two homes never skew.
3. **Children never ship images.** A child publish builds locally, uploads
   each workspace's `dist/` to the base's storage, writes URLs at the CDN
   origin, and publishes the config to FastKV. Children run the universal
   image (ADR 0021) with `BOS_ACCOUNT`/`BOS_GATEWAY` env — or no instance at
   all (shared host). Sovereignty is preserved by competition: any fork can
   provision its own bucket + domain and become a base.
4. **The host carries zero bundle-serving code.** The `/bundles/*` route chain
   (`createBundleFsHandler`, `createBundleProxyCacheHandler`,
   `deriveNamespaceOrigins`) is deleted once URLs are CDN-based. The host
   keeps only the authenticated upload route under `/api/*`. ADR 0015's second
   `OpenAPIHandler` mount at `/bundles/*` is not needed — public GETs go to
   the CDN domain, never through the host.
5. **Storage: R2 first, behind a `BundleStorage` Effect service.** Platform
   credentials only, never tenant-visible. Provisioned via alchemy as
   Infrastructure-as-Effects (sovereign tenants can swap providers and
   self-host the same stack). Dev/test uses a local S3-compatible emulator.
6. **Upload rule (from `.scratch/cloudflare-cdn/issues/02`):** R2 writes go
   through the **S3-compatible API** (`aws4fetch`), which stores `Content-Type`
   and `Cache-Control` as first-class headers. The `@distilled.cloud` REST PUT
   path stomps content-type to `application/octet-stream` and silently drops
   cache-control — never used. Entrypoint files (`remoteEntry.js`,
   `mf-manifest.json`) get `public, max-age=0, must-revalidate`; content-hashed
   chunks get `public, max-age=31536000, immutable`.
7. **CDN response policy:** `Access-Control-Allow-Origin: *` (bundle bytes are
   public; cross-origin `fetch()` of `mf-manifest.json` is required by MF
   loading from every app origin), `Cross-Origin-Resource-Policy: cross-origin`
   (mirroring the host's static-asset policy), correct cache-control per (6).

## Why ADR 0011's CDN rejection does not reapply

ADR 0011 rejected a central CDN for two reasons, both re-examined:

- **The upload-credential bootstrap loop**: that objection applied to the
  *root's own boot* depending on storage that must be populated before the
  stack exists. Here the root boots from its image (2); the CDN is
  browser-facing and child-facing only. A cold root deploy with an empty
  bucket boots fine and populates it at publish time.
- **The shared failure point**: accepted consciously. Children already depend
  on the base for host code the moment they `extends`; the CDN moves that
  dependency from the base's host process to Cloudflare's edge (higher
  uptime, not lower). Outbound stale-if-error caches
  (`BOS_BUNDLE_CACHE_DIR`) cover outages with last-known-good bytes.
  Decentralization is provided by competing bases, not by every child
  carrying its own bytes.

## Consequences

- The host process serves only app traffic (HTML/SSR/API/auth) — bundle
  bandwidth moves to the edge entirely; the base cannot be overwhelmed by
  child reads (zero-egress object store, immutable caching).
- `bundles/<account>/<gateway>/<workspace>/…` remains the single key layout
  across image staging, bucket keys, and the deleted routes' replacement.
- Server-computed SRI at upload time feeds `app.ui.integrity` /
  `plugins.<id>.ui.integrity`, making tenant-runtime's existing integrity
  verification meaningful for child publishes.
- CSRF/CORS/rate-limiting for the upload route are inherited from the
  existing `/api/*` middleware (the CLI uploads server-to-server; the
  route-scoped `bodyLimit` from ADR 0015's design is kept).
- Plan 032's declared storage dependency is restored: sandbox tenants stage
  dists from the same store.
- Deleted: `host/src/routes/bundles.ts`, `host/src/routes/bundles-proxy.ts`
  (with the wiring in `host/src/routes/api.ts`). Kept: `bundle-fs-resolve.ts`
  and `bundle-cache.ts` (outbound boot roles). The regression fixture mounts
  the `/bundles/…` path shape on its own static servers.
- ADR 0015's route design (auth trust family, path allowlist, traversal
  rejection, size ceiling, server-side SRI) is adopted as written; only the
  serving mount and storage backend differ.

## Amendment (2026-09-30): authored `cdn.origin` — deploy origins are never derived from dev-resolved slots

The zero-config CDN-origin derivation (`env BOS_BUNDLE_CDN_ORIGIN` → the
resolved runtime config's `host.url`) promoted a dev listening URL to the
published CDN origin whenever a deploy ran outside production resolution:
the host slot resolves in development mode (`development: "local:host"`
beating the committed `production` URL), so `host.url` became
`http://localhost:<port>` and a local deploy wrote localhost bundle URLs
into `bos.config.json` and published them to FastKV. This shipped once
on-chain (a `localhost:3000` config at registry height 217486764, later
overwritten by CI deploys) and repeatedly wasted local deploy trains.

Replaced with an explicit authored field, `cdn: { origin }` in
`bos.config.json` (a `BosConfigInput`/`BosConfig` schema field, surviving
descriptor roundtrips and extending child-wins like `ci` — children inherit
the base's CDN with zero config, which is what ADR 0020's zero-config path
always meant). Deploy resolution is now:

1. `BOS_BUNDLE_CDN_ORIGIN` env — wins; a local URL is a deliberate local
   deploy and only warns.
2. Authored `cdn.origin` (extends-inherited); a local URL here is a hard
   error, not a silent promotion.
3. Neither set with uploads planned — hard error. The silent image-native
   fallback (gateway URLs the host can no longer serve) is gone; a
   config-only `bos publish` (`build: false`) uploads nothing and requires
   no origins.

Guards in the same amendment: a `bos login` session pinned to a local
`siteUrl` is a hard error for uploads (the session site can only ever be a
squatter's port — the same-account guard cannot catch it); and the upload
origin is probed (`GET /.well-known/mcp.json`) in preflight before the build
train, so a wrong-port target fails in seconds with a named remedy instead
of a foreign 413 after a full build.

## Amendment (2026-09-30): hashed artifacts + version manifests — the deploy unit is additive

The overwrite-in-place serving model (fixed-name entrypoints) has a
non-atomic window in every deploy: uploaded bytes go live at fixed URLs
(`max-age=0, must-revalidate`) minutes before the publish transaction swaps
the pinned SRI — and an aborted train (a 2026-09-30 `auth-ui` socket failure)
made the window permanent: new bytes on the CDN, old pins in the published
config, browsers SRI-blocked.

Replaced with immutable, content-addressed artifacts and manifest pointers:

1. **Hashed artifacts.** Entrypoints build as `remoteEntry.[contenthash].js`
   / `remoteEntry.server.[contenthash].js`; the build additively emits hashed
   copies of the fixed-name browser artifacts (`mf-manifest.json`,
   `static/css/style.css`) and a per-dist `build-report.json` naming the
   hashed entry for the deploy leg — fixed-name entry aliases are fully
   retired (hard break; dev servers keep the fixed dev names as the dev
   serving contract). rspack plugin dists (api/auth) hash the entry; their
   `mf-manifest.json` stays toolchain-consumed (never browser-loaded).
2. **Version manifests.** Each deploy composes an immutable
   `WorkspaceVersionManifest` (`every-plugin/version-manifest`) — entry +
   per-file SRI, ssr entry + SRI, browser-manifest reference, shared-dep
   versions — from the **server-computed SRI map** of the upload response,
   and uploads it at `bundles/<account>/<gateway>/<workspace>/versions/<id>.json`.
   The version id is content-derived (key-order stable, build time excluded):
   unchanged bytes keep one id, so republishing unchanged content is a
   pointer no-op.
3. **Config slots become pointers.** Slots carry an explicit
   `pin: { manifest, integrity }` — the versioned manifest filename
   (relative to `production`) and that *manifest document's* SRI. The
   top-level `integrity` is unambiguous: a direct entry SRI, only for
   slots without a pin (fixed-name slots — a development-only shape).
   The resolved internal `RuntimeConfig` derives the flattened fields
   (`ui.entryUrl`, `ui.integrity`, `ui.ssrEntryUrl`, …) so consumers change
   once, not per artifact kind. Outside development every remote slot MUST
   pin — an unpinned remote slot fails resolution loudly (pre-pin configs
   are pre-atomic-deploy and not servable). Extends inheritance: `app.*`
   slots inherit the parent's fields; the `pin` merges atomically (a child
   pin replaces the parent's whole, never half-mixed); child `plugins.*`
   entries replace parent entries wholesale (existing semantics — a child
   publishes its own manifests for every slot it ships).
4. **Cache classification flipped.** A content-hash segment in the object
   name now *wins*: hashed names (including hashed entrypoints) serve
   `immutable, max-age=31536500`; fixed-name and non-hashed files serve
   `max-age=0, must-revalidate` (`every-plugin/build/artifact-names`
   `cacheControlOf`, shared by the storage route and the local bundle
   resolver).

Deploy ordering is unchanged (upload everything → publish pointer), but with
additive artifacts an aborted train is now a no-op: the previously published
version stays fully live and consistent, and completing the train switches
atomically at publish.

## Amendment — `bos plugin publish` joins the train (2026-10-01)

`bos plugin publish <key>` was the last ADR-0011 command: it built the plugin
locally, wrote a deterministic URL at the hardcoded `https://<gateway>` origin,
uploaded nothing, pinned nothing, and didn't publish the config — its bytes
went live only when the next image rebuild staged them, and the URL dangled
for every non-root runtime. Superseded: `bos plugin publish` now runs the
same per-workspace train as `bos deploy` scoped to one plugin — preflight
(storage/CDN credentials + signing, before any build) → build → upload to the
R2-backed storage → compose + pin the workspace's version manifest →
config write-back → FastKV publish + read-back confirmation. The
image-native `applyPluginPublishUrl` path is deleted.
