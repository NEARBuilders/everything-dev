---
"everything-dev": patch
---

Release-scoped sync no longer hard-fails on `ref not found (v<version>)`: release tarballs try the canonical `v<version>` tag and then the changesets per-package tag (`everything-dev@<version>`), and child workflow wrappers pin the resolved `v` tag or, failing that, the resolved commit sha. The release train now also publishes the canonical `v<frameworkVersion>` tag (#519).
