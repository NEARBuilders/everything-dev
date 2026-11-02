---
"everything-dev": patch
---

Surface the upgrade path at child dev boot: when the resolved chain head is a newer release than the runtime's authored `platform` pin, `bos dev` prints the lag with the `bos upgrade` repair — instead of waiting for a load-time skew to explain it. FastKV's pointer only advances when a release leg completes, so the notice never fires mid-train; a lagging pin always means the new chain is already servable.
