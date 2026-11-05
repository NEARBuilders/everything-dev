---
"everything-dev": patch
---

`bos dev` no longer registers ports it never owned. The teardown port registry is populated from the resolved runtime config, so remote extends-chain entries (auth/ui/plugins served from `https://` URLs) contributed their derived implicit ports (443/80) — every shutdown then probed them, reporting a false "Port N still bound after teardown" attributed via lsof to an unrelated process (Chrome's network service on 443). Registration now mirrors the planner's allocation gating: only `source: "local"` services are registered, which also stops `bos kill` from refusing to unregister with "ports still bound after kill: 443" and keeps `claimedPorts()` clean.

Fixes #790.
