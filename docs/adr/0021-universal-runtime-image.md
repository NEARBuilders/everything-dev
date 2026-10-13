# ADR 0021: Universal runtime image — one image, identity-selected tiers

Date: 2026-09-26
Status: Accepted
Complements: [ADR 0020](0020-child-bundle-storage-r2.md) (child bundle storage), [ADR 0011](0011-image-native-artifacts.md) (image-native boot)

## Context

ADR 0011 made the image the deployment artifact and noted two tiers derived
from the descriptor: self-contained (dists kept) and registry tier (dists
stripped, boot from FastKV). In practice the runtime image was built for the
root only: its `BOS_BUNDLE_DIR` staging and its boot path assumed the baked
`bos.config.json` identity, and a child running the same image would hit
deterministic 404s (the staged directory holds only the root's namespace).
Children that owned workspaces were effectively pushed toward building their
own images — exactly the maintenance burden the platform exists to remove
(ADR 0020: children never ship images).

Separately, the Dockerfile's stage naming had inverted: the stage named
`runtime` was the ADR 0009 regression fixture (booted from a baked local
config via `container-entrypoint.mjs`), while the actual deployable stage —
`bos start`, identity-driven — was unnamed.

## Decision

**One universal image, published to GHCR; every runtime runs the same bytes;
the identity selects the tier at boot.**

1. **Stage naming:** the deployable stage (`bun run start`, `bos start`) is
   named `runtime` and moved last (default build target = the deployment);
   the regression fixture is named `regression` (built explicitly with
   `--target regression`). The regression harness entry keeps its baked
   local-config boot for deterministic browser suites.
2. **Tier auto-detection:** `installBundleFetchFromEnv` checks whether
   `<BOS_BUNDLE_DIR>/<account>/<gateway>/` exists for the effective identity
   (`BOS_ACCOUNT`/`BOS_GATEWAY` env, else the config's `account`/`domain`).
   Staged → self-contained tier (own-namespace URLs resolve from disk).
   Unstaged → registry tier (network fetch, outbound stale-if-error cache),
   with a one-line notice. No env overrides required; a child can never
   accidentally 404 its own namespace against the root's staged bytes.
3. **Inbound namespace guard (transitional):** until all URLs move to the CDN
   (ADR 0020), the host's `/bundles/*` FS handler serves only the runtime's
   own namespace; foreign namespaces fall through to the proxy+cache handler
   instead of serving stale baked platform bytes. The route chain is deleted
   entirely once ADR 0020's URL migration lands.
4. **Distribution:** the deploy train pushes the `runtime` stage to
   `ghcr.io/nearbuilders/everything-dev:sha-<short>` (`packages: write`).
   Railway deploys the pushed image (pinned to the validated SHA) instead of
   rebuilding the Dockerfile. The existing GHCR package must grant this repo
   push access (one-time package-settings step). Floating tags: `:latest`
   moves on stable releases only (held during prereleases, so `:latest`
   keeps serving the last stable image) and `:rc` moves on every prerelease
   deploy — the floating ref for the prerelease train (npm's `rc` dist-tag
   mirror); it freezes at the last rc-train build once a stable version
   ships. Deployments should pin the digest either way; the floating tags
   are convenience pull targets.
5. **Boot resilience env:** `BOS_BUNDLE_CACHE_DIR` is set in the image —
   registry-tier instances (children) cache foreign-namespace bytes at boot
   and serve last-known-good on upstream outages.

## Consequences

- Every runtime — root, child instances, future sandbox hosts (plan 032's
  "children never ship Dockerfiles") — pulls one image; publishing the image
  is the root's release act, and children consume it without rebuilding.
- Tier is an emergent property of (identity × staged bytes), not config —
  the same image boots self-contained on the root and registry-tier on a
  child with no env tricks.
- The root's boot stays local-first (ADR 0011 amendment 1) in every tier;
  registry-tier cold boots need the CDN reachable, warm boots survive
  outages from the cache.

## Amendment (2026-10-04): unified resolution policy — one layered fallback

The fetch interceptor began with two ad-hoc branches: own-namespace URLs
resolved from the staged directory only (a miss 404'd), foreign-namespace
URLs got the network with the stale-if-error cache. Two namespaces, two
policies — and no way to boot a plugin whose dist the image doesn't carry.

The policy is now uniform behind the same seam: **staged disk → network →
stale-if-error**, with one scoping rule. An own-namespace miss falls through
to the original network fetch (a partially-staged namespace boots over the
wire instead of failing) but never touches the write-through cache — for the
own namespace the staged disk IS the resilience artifact, so disk-present
files always win and network bytes are never cached over them. Foreign
namespaces keep write-through + stale-if-error exactly as before.

Consequence: workspaces whose dists are not staged (the template plugin, and
later any workspace the root stops carrying) boot from the CDN like a child
tier would. The staged layout remains the deployment artifact; staged bytes
remain authoritative over the network for the same URL.

## Amendment (2026-10-13): image-backed Railway deploys — the digest-pin Dockerfile is gone

The Railway deploy leg no longer builds anything. The service's source is a
Docker image ref (connected once in the dashboard — `:rc` during the
prerelease train), and the deploy leg runs `railway redeploy --from-source` —
Railway skips the build for Docker-image sources, so nothing is uploaded,
nothing is built there, and the digest-pin Dockerfile (a thin
`FROM image@digest` shipped via `RAILWAY_DOCKERFILE_PATH`) is gone.

Why the mechanism it replaced stopped working: the Railway CLI v5 dropped
`RAILWAY_DOCKERFILE_PATH` (config-as-code owns the build file now); the CLI's
upload snapshot respects `.gitignore`, so a generated Dockerfile under the
gitignored `.bos/` never shipped and the builder silently fell back to the
repo's root `Dockerfile`; and the Metal builder rejects that Dockerfile's
cache-mount ids. With the build gone, `railway.toml` has nothing left to own.
It is deleted (and dropped from the `bos init` scaffold); the healthcheck
(`/health`, ~300s timeout, restart policy ON_FAILURE ×10) is a dashboard
service setting.

Byte-exactness in practice: `:rc` is written only by the deploy train and
pushed immediately before the redeploy, so the pulled image is what this
train validated. Two divergence moments are accepted: an overlapping train
could pull a newer (still CI-validated) image, and at the stable transition
`:rc` is frozen — the source is repinned to `:latest` once. Rollback is
unaffected: Railway's deployment history pins the exact digest each
deployment pulled. The public GHCR image needs no registry credentials on
Railway.

## Amendment (2026-10-13): the image carries no dists and no config — the CDN is the single distribution source

The `runtime` stage stopped staging the boot namespace and stopped baking the
generated `bos.config.json` as the bare-start fallback. Two problems forced
this:

- **The two builds were not the same bytes.** The deploy train builds the
  workspace dists a second time on the runner and uploads those bytes to the
  CDN, while the image's `dist-builder` stage built its own copy. Both run
  `DEPLOY=true`, but the minifier's variable-name allocation is not stable
  across builds — same code, different content hash. The boot policy preferred
  staged bytes for own-namespace URLs, so the SSR compose rendered the image's
  hashed filenames while the browser loaded the CDN's pins → 404 → broken
  hydration. The publish train already declared "nothing image-native left";
  the image carrying dists was the stale half of ADR 0020's "dual home".
- **A baked build-time config is image-native state.** A universal image
  should boot from identity (`BOS_ACCOUNT`/`BOS_GATEWAY` → FastKV) or a
  mounted config — never from config materialized at image-build time.

Decision 2's tier auto-detection stays as written: with `BOS_BUNDLE_DIR`
unset (the image default), every namespace takes the network fetch +
write-through + stale-if-error cache path — the path every registry-tier
instance already booted through. An operator may still opt into a staged
namespace by mounting one and setting `BOS_BUNDLE_DIR`; `bos mf check`
resolves its config from the registry identity when no local authored config
exists. The `regression` target keeps its staged dists and baked local config
— it is a test fixture, built explicitly with `--target regression`, never
the deployment artifact. A bare `bos start` with no identity and no mounted
config fails with `StartConfigMissing` — loud, by design.
