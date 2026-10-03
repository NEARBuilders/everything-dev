---
"everything-dev": patch
---

Add staleness-aware quiet build for the workspace `better-near-auth` package. `bos build` and `bos dev` now build `packages/better-near-auth` dist alongside every-plugin/everything-dev so production rspack plugin builds that bundle `better-near-auth` resolve its `dist` output.
