---
"everything-dev": patch
---

Fail-loud sweep in the dev session: descriptor env now rides the generated tier (shell-exported values keep outranking it, as documented and test-pinned) instead of silently outranking everything via a post-spawn `Object.assign`; a failed `.env` load propagates into the database-binding error instead of proceeding fire-and-forget; `bos logs --follow` refuses to watch a missing/unknown log file and stops cleanly when the followed file is rotated or deleted (the readFile rejection is handled); warning suppression around runtime-config builds is failure-safe via a release finalizer at both the development and start sites; `DB_LOCK_TIMEOUT_MS`/`DB_IDLE_TX_TIMEOUT_MS`/`DB_STATEMENT_TIMEOUT_MS` parse defensively (explicit `0` disables, garbage fails the boot); and the start path now passes the generated env tier through to the session instead of silently running with an empty one.
