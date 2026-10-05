---
"everything-dev": minor
---

Sync stops managing every ui source file — the app owns its ui after init (ADR 0023): `router.tsx` (the router policy seam, including the query-timings export), `app.ts` (the `@/app` surface), lib, routes, components, providers, and hooks are scaffolded once and never overwritten. `bos sync`/`bos upgrade` migrate children off the retired bootstrap stubs: unmodified copies are deleted silently, hand-modified copies are backed up first, and the result reports both. Framework behavior flows through package versions from here.
