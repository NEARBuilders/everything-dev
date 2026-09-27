---
"everything-dev": patch
---

Fix dev process-tree teardown leaking detached service processes.

- Service kill now signals the child's whole process group (SIGTERM, then group SIGKILL after a 3s grace) instead of SIGTERM-ing only the direct child. The old path relied on a group-SIGKILL fallback that only ran if the direct child ignored SIGTERM — wrappers that exited quickly left their detached grandchildren (rspack/tsx) un-signaled and orphaned.
- The 5s force-exit now group-SIGKills every known child before exiting, so a slow graceful shutdown can no longer strand services mid-teardown.
- The PID registry now records child pids per session, and `bos kill` signals each child's process group, so `bos kill --signal SIGKILL` reaps full trees even when the CLI process is already gone.
- Browser regression harness no longer reuses a pre-existing server (`reuseExistingServer: false`) and kills stale port squatters before boot (mirroring the Go HTTP harness), so aborted runs can't poison the next run with a half-dead stack.
