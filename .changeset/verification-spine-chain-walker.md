---
"everything-dev": minor
---

The chain walker (ADR 0046 ticket 02): `verifyChain(config, { depth })` walks the distribution spine at pointer (pinned manifest documents), entries (+ the pinned remoteEntry/ssr bytes), or files (+ every file in each manifest's files map) depth — one engine call per hop, one report shape (the `bos verify` result, generalized with per-entry legs and an `ok` verdict). Consumers collapse onto it: `bos verify` gains a `--depth` flag (default `files`, report unchanged), the smoke gate walks the booted identity in-image at entries depth as a pre-promotion leg, the SnapshotWatch adopt transaction verifies the full extends-merged candidate composition instead of the ui slot alone, and `verifyRollbackSnapshot` delegates at pointer depth with the canonical report wording.
