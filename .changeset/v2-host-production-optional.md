---
"everything-dev": patch
---

Make `app.host.production` optional in the resolved-config schema (ADR 0005 — deploy state, absent until the first publish writes it). This unblocks runtimes authored via `bos.app.ts` without a committed `bos.config.json`: the descriptor-to-config conversion fills `development` only, and deploy legs materialize `production` on first publish.
