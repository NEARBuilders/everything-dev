---
"everything-dev": minor
---

Deploy train publishes source archives: `publish.sourcePublish: true` opts each workspace's version manifest into a `source` field (content-addressed `source/<name>.tar.gz` of the workspace subtree, server-computed SRI, deduped against the previous pin), and every pinned manifest now records the repo `gitSha` when the project dir is a git worktree.
