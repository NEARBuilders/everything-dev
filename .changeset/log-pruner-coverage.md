---
"everything-dev": patch
---

The `.bos/logs` pruner sees every writer's names; sync backups are bounded (part of #844)

- `pruneDatedLogs` now matches the pre-#476 PID-less `dev-<ts>.log` legacy format, the PID-less `dev-latest.log`, and the regression stack's `framework-<port>.log` / `regression-<mode>.log` wrappers — on a long-lived checkout 192 of 205 log files were invisible to the pruner. The <24h live-session guard, the newest-20 keep, and the 7-day age cap are unchanged and now apply uniformly across all classes.
- `bos sync`/`bos upgrade` prune `.bos/sync-backup/` to the newest 10 timestamped dirs after each backup — upgrade sediment no longer accumulates forever.
- `docs/agents/how-it-fits.md` stops claiming logs have no rotation (it landed in #596/#603) and documents the pruner's actual coverage.
