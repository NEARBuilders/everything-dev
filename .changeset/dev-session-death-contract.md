---
"everything-dev": patch
---

Dev-boot readiness probes no longer wedge: `probeHttpOk` awaited `fetchRaw`'s nested `Effect.runPromise` from inside the probe fiber, which intermittently stalled the boot until the 90s probe deadline. The probe (and the host-manifest fetch) now run Effect-native with the same deadline and fail-loud semantics. Also: the dev session's graceful-shutdown force backstop is a forked `Effect.sleep` fiber (`forkDetach`) instead of a raw `setTimeout`, and a new unit suite (`tests/unit/dev-session-processes.test.ts`) drives the real `runDevSession` against real detached children and watcher grandchildren to lock the process-death contract at unit speed.
