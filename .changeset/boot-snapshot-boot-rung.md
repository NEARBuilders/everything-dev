---
"everything-dev": patch
---

Registry starts gain the approved-snapshot boot rung (ADR 0041): every verified generation is persisted (`.bos/snapshot/<account>/<gateway>.json`, `BOS_SNAPSHOT_DIR` overrides the root) by the host's snapshot coordinator on adopt — and by `bos start` itself when it resolves the registry cold — so a restart during a registry/CDN outage boots from the last verified composition, with a loud warning in the start summary; the pointer watch adopts the published config the moment the registry returns. A definitive "no config published" still fails loud; a corrupt or fingerprint-mismatched snapshot refuses instead of serving; `BOS_SNAPSHOT_BOOT=never` disables the rung. The `everything-dev/snapshot` subpath gains `readBootSnapshot`, `verifiedBootSnapshot`, and `BootSnapshotIntegrityError`.
