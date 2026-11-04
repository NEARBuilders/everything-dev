---
"everything-dev": patch
---

The host's /health carries composition provenance for the approved-snapshot boot rung (ADR 0041): a `snapshot` block reports whether the process booted from the persisted snapshot, whether the pointer watch has adopted a published generation since boot, and whether the boot is still degraded (snapshot-sourced, not yet adopted). The overall status stays "ready" — degradation is provenance, not readiness — and the marker clears the moment the watch adopts. `bos start` stamps the host process with the marker env only when it actually served the snapshot.
