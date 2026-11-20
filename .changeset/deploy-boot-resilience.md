---
"everything-dev": patch
---

Deploy boot resilience: the orchestrator's remote boot fetches (host pin resolve, manifest fetch, module load) retry transient undici socket failures with a bounded schedule instead of dying on the first `fetch failed` blip (the 2026-11-20 rc.46 train lost its smoke gate to one). The post-publish smoke fails fast when the container logs a `Failed to start:` line instead of burning the full 240s probe deadline, and surfaces undici's hidden `error.cause` in poller failures. The publish gas-prepayment check classifies a non-integer RPC response as an unexpected format instead of misreporting the RPC as unreachable.
