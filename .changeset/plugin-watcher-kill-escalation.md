---
"every-plugin": patch
---

The plugin dev server's build watchers (`rspack build --watch`, `rsbuild dev`) are now killed with SIGTERM-then-SIGKILL escalation on shutdown — rspack's watch mode ignores SIGTERM, so previously every non-graceful dev session left its watchers orphaned (reparented to PID 1, invisible to `bos kill --all`, squatting CPU and file watchers forever). The dev server also watches its own parent process and tears down (with the same escalation) if the wrapper chain above it dies, matching the orchestrator's orphan-watch behavior.
