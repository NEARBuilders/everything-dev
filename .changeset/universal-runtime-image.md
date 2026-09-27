---
"everything-dev": minor
"host": minor
---

Universal runtime image (ADR 0021): tier auto-detection — an identity whose namespace is not staged under `BOS_BUNDLE_DIR` drops to registry tier (network fetch + `BOS_BUNDLE_CACHE_DIR` stale-if-error cache) instead of deterministically 404ing own-namespace URLs; the host's `/bundles/*` FS route is namespace-scoped (foreign namespaces fall through to the proxy handler). Dockerfile: the deployable stage is named `runtime` (last, default target); the regression fixture is `regression`. The deploy train pushes the image to GHCR by SHA-tagged digest and Railway deploys the pushed digest.
---
