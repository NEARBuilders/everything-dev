---
"everything-dev": patch
---

CI economy overhaul: the `main` ruleset now routes every merge through the GitHub merge queue (one full-suite run per batch against the real merged tree, required check `CI gate`), CI no longer re-runs on push to `main`, and the changesets version PR fast-paths to an all-skipped green run instead of paying the full regression matrix over a package.json-only diff. Deploy and Release trigger directly on push and gate themselves (tip guard, runtime-relevance diff, merge-queue provenance with a `workflow_dispatch --force` escape hatch), and the never-run `test:regression:backcompat` tier runs on a nightly schedule (`backcompat-nightly.yml`).
