---
"everything-dev": minor
"host": minor
---

Per-remote failure isolation in composition (ADR 0024 §5): a plugin source that cannot produce a usable manifest — fetch failure with no last-good snapshot, unparsable content, or an identity mismatch with its config key — now drops itself with a warning and the healthy subset composes, instead of the whole composition failing (SSR 500) or all remotes degrading to the core-only tree. The digest and the client payload are computed over the healthy set in canonical (sorted) order, so server-side drops hydrate cleanly; a client-side drop degrades to client-render. The core source failing stays a loud failure.
