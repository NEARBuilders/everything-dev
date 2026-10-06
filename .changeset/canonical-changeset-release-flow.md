---
"everything-dev": minor
---

Release workflow adopts the canonical changesets flow: `release.yml` now runs on every push to `main` — pending changesets open or update the `chore: version packages` PR automatically, and merging it publishes the packages to npm (under the `rc` dist-tag while `.changeset/pre.json` pre mode is active) and creates GitHub Releases. The manual `workflow_dispatch` trigger remains for retries; the `force_release` and `ref` inputs are gone. Publishing moved from inline workflow steps into `scripts/publish-release-packages.ts` (`pnpm run release`), porting the build → stage → publish → release logic verbatim, including the already-published/existing-release skip guards.
