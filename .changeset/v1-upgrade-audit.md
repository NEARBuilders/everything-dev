---
"everything-dev": minor
---

`bos upgrade --from v1`: adopt the v2-upgrade audit tooling upstream (fixes #455). Audits a v1 child app for upgrade readiness (hardline mount-conformance gate, config surface, legacy imports) and applies the deterministic v2 transforms (authored descriptor, bun→pnpm catalog migration, consumerized refs, import rewrites, obsolete-file deletion, plugin dep declarations). State-aware: a tree with an authored `bos.app.ts` exits "already upgraded · v2" instead of reporting the v1-state blocker. Adds re-runnable post-upgrade maintenance steps via `--maintain port-route-guards|db-topology|i18n-seam|compose-seam`, bundles the `v1-to-v2-upgrade` intent skill, and emits `.bos/v2-upgrade-manifest.json` on audit.
