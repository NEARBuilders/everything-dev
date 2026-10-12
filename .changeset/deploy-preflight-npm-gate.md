---
"everything-dev": minor
---

`bos deploy` (and any publish that uploads bundles) now fails fast in preflight when the workspace's framework packages (`everything-dev`, `every-plugin`, `better-near-auth` — when present as workspace sources) are not published to npm: the deploy train must not ship bundles ahead of the registry, since child scaffolds and the update check read those versions. A 404 from npm blocks the deploy with the exact unpublished versions and the re-run-Release instruction; an unreachable or erroring registry only warns and continues.
