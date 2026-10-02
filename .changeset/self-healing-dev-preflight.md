---
"everything-dev": minor
---

Simplify the contributor getting-started flow to two commands: `bun install && bun run dev`. When the `bos dev` DB preflight finds local Postgres down (and every failure is an unreachable local service, `docker-compose.yml` exists, docker is reachable, and the stack is not test-mode), it now starts the compose services itself (`docker compose up -d --wait`) and re-probes once before failing. `.env` was already auto-created on first run — docs no longer tell you to copy it by hand, and `bos init`'s printed next steps drop the manual docker line.

The dev bootstrap is also quieter: docker compose output is captured instead of drawn over the spinner (its tail is shown only when compose fails), the compose step renders as "Starting local Postgres..." on the spinner, and bootstrap-phase Effect INFO logs (e.g. `[env] ... updated` drift lines) no longer print to the console by default — pass `--log-level info` (or set `BOS_LOG_LEVEL` / `DEBUG=1`) to restore them. Warnings and errors always print.
