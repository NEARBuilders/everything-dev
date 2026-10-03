---
"everything-dev": minor
---

`bos rollback`: republish an earlier config snapshot from the registry's publish history. `fetchConfigHistory` reads the FastData exact-key history (newest-first, limit 1–200). Before republishing, every pinned slot's version manifest must still serve and match its SRI — a gone or mismatched byte refuses with a per-slot report and `--force` cannot override it (force only admits pre-Phase-A snapshots with no verifiable pins, which are warned loudly). The target is stamped `rolledBackFrom` (additive config field) so publish dedup treats the rollback as distinct state, and an identical-to-live target short-circuits. No flags → interactive selection over the history listing; `--previous` and `--version <block-height>` for scripts.
