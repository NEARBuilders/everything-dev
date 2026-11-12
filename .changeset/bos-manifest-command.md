---
"everything-dev": patch
---

`bos platform manifest` is removed — the command is **`bos manifest`** (no alias; `--check` semantics unchanged). The mf-check compat section and its result field are labeled `manifest`, and the local manifest cache moved from `.bos/platform-manifest.json` to `.bos/manifest.json` (the stale file is deleted on the next `bos upgrade`).
