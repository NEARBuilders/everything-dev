---
"everything-dev": patch
---

Deleting `.bos/logs` mid-run no longer wedges the dev orchestrator in an ENOENT rejection loop. The dev log file sink now recreates the directory on a missing-dir write failure and retries once; when the path still can't be written (e.g. `.bos/logs` replaced by a file), entries degrade to drop-silently with a single warning instead of failing per line, and a later recovery resets the state. The writer's promise chain internalizes failures, so the fire-and-forget `logger.write` call site can never surface an unhandled rejection — which was the loop edge: each failed write rejected, the rejection handler logged through the (console-patched) bridge back into the pipeline, and every ingested line enqueued another failing write. The orchestrator's `unhandledRejection`/`uncaughtException` handlers now use the real console captured at module load, so rejection reporting can never re-enter the pipeline through `patchConsole`.

Fixes #791.
