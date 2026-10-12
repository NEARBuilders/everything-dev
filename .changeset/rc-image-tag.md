---
"everything-dev": minor
---

Push a floating `:rc` image tag on every prerelease deploy (npm's `rc` dist-tag mirror for the Docker image — `:latest` keeps being held so stable deployments are untouched), and make the outdated-packages check dist-tag-aware: prerelease installs now compare against the `rc` dist-tag instead of stale `latest`, so the banner no longer shows misleading "downgrade" arrows while the workspace is on the rc train.
