---
"everything-dev": patch
---

SSR compose integrity and deploy-gate hardening: the host compose verifies the pinned compose manifest's SRI on every fetch (a resolved config older than the deployed bundles now fails the compose loud instead of rendering a mixed tree), the deploy smoke's SSR check fails when the host serves the client-shell fallback, platform-manifest cache reads honor a 24h resolvedAt TTL, and remote preload hints are emitted server-side only.
