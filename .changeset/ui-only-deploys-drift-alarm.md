---
"everything-dev": minor
---

Right-sized deploys: ui-only trains skip Railway, drift alarm (`bos verify`), restart advisory

- **Ui-only deploys stop restarting the host** (#826 follow-up): the train diffs the published config against the live one, and when the change touches only SnapshotWatch-adopted surfaces (the ui slot, plugin ui overrides) the Railway leg skips — the soft-refresh banner carries the adoption instead of a restart. `--force-railway` overrides; any backend/host/config change keeps the full train; uncertainty reads cold.
- **`bos verify`** — the drift alarm: for every published pin, SRI-verify the version manifest and hash every file it names against the served bytes (the manual curl+sha384 sweep, automated). Rot fails the command naming the file; being behind the parent's live release is advisory. Child deploys run it post-publish, non-blocking, with the report on the job summary.
- **Restart advisory**: when a snapshot adopt moves a boot-frozen slot's pin (api/auth/plugin backends — the swap cannot adopt them), the host surfaces `restartRequired` at `/.well-known/version` and `/health` instead of silently serving the previous generation.
- **Ui-only CI runs the smoke spec**: a diff confined to `ui/` replaces the full sharded browser regression matrix with the app-load spec (boot + hydration + runtime-config shape).
