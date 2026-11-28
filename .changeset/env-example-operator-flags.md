---
"everything-dev": patch
---

The generated `.env.example` ends with an "Operator flags" block documenting `BOS_HOLD_ON_BACKEND_CHANGE`, `BOS_RECONCILE_HELD_GENERATIONS`, `BOS_SNAPSHOT_DIR` and `BOS_LOG_LEVEL` — each with an empty default, which is the current behavior. The block comes from the renderer (`renderEnvFile`), not a hand edit, so it survives regeneration and reaches every child on upgrade.

