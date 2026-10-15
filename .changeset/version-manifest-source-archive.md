---
"every-plugin": minor
---

Version manifests gain an optional `source` field (`{ file, integrity }`) recording a per-workspace source archive published beside the dists when a deploy opts in via the authored config's `publish.sourcePublish`. Additive: readers predating the field ignore it (zod strips unknown keys). It participates in the version hash, so enabling source publishing changes the workspace's version id on the next deploy.
