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
