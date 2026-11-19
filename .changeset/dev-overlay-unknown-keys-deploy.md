---
"everything-dev": patch
---

Stop failing `bos deploy` when `bos.dev.ts` uses descriptor-form keys (`api`, `ui`, `auth`, `host`). The unknown-authored-keys walker consulted the dev overlay against the resolved-config schema, where those keys only exist under `app` — so any child whose overlay legitimately overrides, say, `api.variables` (citynode.app) was refused at deploy with "unknown keys: api". The overlay is never published and is already gated by the strict descriptor parse (`DevOverlayError` names the file for a truly unknown key); the deploy gate now reads the authored leaf only.
