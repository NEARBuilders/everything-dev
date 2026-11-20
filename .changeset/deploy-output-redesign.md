---
"everything-dev": patch
---

Redesigned deploy output into a phased, scannable structure: `▶` phase headers (Preflight → Build → Release → Publish → Verify → Promote) with a consistent ✓/…/✗ line grammar, nearblocks explorer links for every transaction hash, boot-gate polls reporting elapsed time instead of attempt counts, and deploy failures rendered as structured what-happened / why-it-matters / what-to-do blocks keyed off the failed leg. The gas prepayment and signing-key preflight checks now read from the FastNEAR free RPC (`NEAR_READ_RPC_URL` overrides) instead of the signing stack's pinned RPC, and their skip warnings name the endpoint and the real error.
