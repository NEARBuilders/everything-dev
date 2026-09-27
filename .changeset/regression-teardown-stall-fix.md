---
"everything-dev": patch
---

Fix the browser regression teardown stall. Playwright's webServer shutdown hung ~2 minutes after the last test (the stall watchdog hard-exited, failure output never printed) and left the stack alive as port squatters. Two changes in `start-stack.mjs`:

- Stack output is written to `.bos/logs/regression-<mode>.log` instead of inheriting the webServer's piped stdio — the service tree held playwright's stdout/stderr fds open, so teardown's EOF wait never resolved until the watchdog killed the run. The log rides the existing `.bos/logs/**` failure artifact.
- SIGTERM/SIGINT now escalate: the signal is forwarded to the child's process group and, if the stack hasn't exited within 5s, the group is SIGKILLed and the runner exits — a wedged graceful shutdown can no longer hold the webServer open (mirrors the dev orchestrator's own force-exit).
- The dev/start orchestrator gains an orphan watch: when its parent chain is SIGKILLed out from under it (playwright tree-kills the webServer — no signal handler runs), the orchestrator detects the reparenting within 200ms and force-exits, reaping the whole service tree. This also covers shell aborts leaving zombie stacks that poison the next run's ports.

The stall watchdog's runner snapshot also works on macOS (`free` and GNU `ps --sort` are Linux-only; BSD `ps -axo` fallback).
