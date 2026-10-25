---
"everything-dev": minor
---

Slot-first platform-pin resolution — old pins resolvable forever (#574)

An exact `platform` pin resolves the immutable `platform-versions/<pin>.json` slot, scanning the extends chain; the moving `platform.json` pointer serves only unpinned ("latest") resolution. A root release never strands a child pin — slots are immutable and the pointer only moves forward, so the #546 stale-pin class is dead and the "pin not found, publish the release or clear the pin" dead path is deleted:

- a clean slot miss produces the actionable error ("the release's manifest leg never published it; re-run the release deploy") — the #568 npm-published/manifest-skipped race
- a slot read *failure* (offline dev) may fall back to the fresh cache — the `.bos/platform-manifest.json` cache is now an offline-dev aid only, never stale-pin grace; TTL docs updated
- `bos platform manifest --check`, `bos mf check`, and the upgrade report surface pin provenance (resolved from slot vs pointer)
