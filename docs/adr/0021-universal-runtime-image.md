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
   push access (one-time package-settings step).
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
