---
"everything-dev": patch
---

`bos status`/`bos dev` no longer report false-clean when a check itself fails: the boot composition audit prints what it skipped and why, the deployed-vs-served version check reports an unreachable published config instead of silently vanishing (and is now actually rendered, including the split-brain verdict), and the parent runtime check distinguishes "no published config" from an unreachable registry with the real cause. Device-flow approvals print elapsed-time progress every 30s under a `Delegate key` phase header instead of dead air mid-deploy.
