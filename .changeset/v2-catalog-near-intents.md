---
"everything-dev": patch
---

Keep the v2 catalog baseline in lockstep with the parent workspace catalog: add the `@near-intents-agent-api/sdk` row to `V2_CATALOG` so v1→v2 child migrations no longer strip it, and point the lockstep drift error at the exact parent rows to copy or delete in `migrate-pnpm.ts`.
