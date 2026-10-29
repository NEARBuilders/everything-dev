---
"everything-dev": minor
---

Release-scoped extends inheritance + deploy-time composition gate — a platform-pinned child can no longer be skewed or degraded by the parent publishing a newer framework release. The release manifest records its own slot-pin map (`slots`, additive), and the deploy train re-points every inherited slot (e.g. `app.auth`) the child does not author at its pinned release's bytes instead of the parent's live config pointer; the same train now cross-checks the extends-merged shape on shared singletons (the boot guard's mirror) and runs the platform compat check against the child's own pin, failing the publish with the `bos upgrade` remediation named instead of shipping a broken composition.
