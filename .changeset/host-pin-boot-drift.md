---
"everything-dev": patch
---

Boot the pinned host, not the parent's newest bytes (#874): the orchestrator
resolves the host slot's `digest` and registers the manifest from the pin's
immutable coordinates — a root publish can no longer move the host bytes a
pinned child boots. `mf check` probes the same pin. When a pinned host's
shared singletons still cannot resolve in the image, the boot fails with the
skew named — image version, pin, and `bos upgrade && bos deploy` — instead of
a bare package error.
