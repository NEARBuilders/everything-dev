---
"everything-dev": patch
---

Fix `bos upgrade --check` permanently exiting 1 on v2-layout children: the current catalog now reads from `pnpm-workspace.yaml` (via `readWorkspaceCatalog`, package.json fallback for v1) instead of package.json-only, and purely-additive chain-catalog entries no longer trip the drift alarm — only a pinned version that actually differs counts as drift (#524).
