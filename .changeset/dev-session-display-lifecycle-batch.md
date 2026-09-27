---
"everything-dev": patch
---

Dev-session display/lifecycle defect batch (plan 037 phase 3):

- Piped/non-TTY sessions no longer freeze after the 100th log event — printing is sequence-based, not array-position-based, so CI and `| tee` runs keep streaming for the whole session.
- `--interactive` with a non-TTY stdin now falls back to the incremental (non-alt-screen) renderer instead of crashing on `setRawMode`; interactive mode additionally requires the output side to be a TTY.
- A service child that dies after becoming ready now flips its table row to "failed" (unclean exits only — the polite SIGTERM/SIGINT quit still renders cleanly); previously the row kept showing "running" for a dead service.
- Status detection: ready patterns win over error patterns on overlapping lines, and the host/ui error patterns no longer match benign lines like "compiled successfully (0 errors)" or "build finished: 0 failed" (`\berror\b(?!s)`, `\bfailed to\b`, `\bbuild failed\b`).
- A spawn failure (e.g. ENOENT on the command) surfaces immediately as a "Spawn failed" error log + failed row, instead of a silent 90-second "starting" hang.
- Per-session log filenames (`dev-<ts>-<pid>.log`, `dev-latest-<pid>.log`): two concurrent `bos dev` sessions in one project no longer truncate each other's logs; `bos logs` resolves the newest session's file by mtime.
- The plugin row's UI annotation no longer renders `ui :0` when the ui port is unset.
