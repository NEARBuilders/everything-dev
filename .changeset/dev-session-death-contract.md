---
"everything-dev": patch
---

Dev-boot readiness probes no longer wedge: `probeHttpOk` awaited `fetchRaw`'s nested `Effect.runPromise` from inside the probe fiber, which intermittently stalled the boot until the 90s probe deadline. The probe (and the host-manifest fetch) now run Effect-native with the same deadline and fail-loud semantics. Also: the dev session's graceful-shutdown force backstop is a forked `Effect.sleep` fiber (`forkDetach`) instead of a raw `setTimeout`, and a new unit suite (`tests/unit/dev-session-processes.test.ts`) drives the real `runDevSession` against real detached children and watcher grandchildren to lock the process-death contract at unit speed.

The Go framework regression suite boots the confined death-contract fixture (`tests/regression/fixtures/death-contract` — a minimal authored config whose five services are fake node servers) for every test but one, cutting the suite's boots from 60–120s of full-stack webpack each to ~4s (the orphan test went 213s → 4.6s); the remaining full-stack boot (`sigterm`) keeps proving the real rspack/rsbuild watcher shape dies. CI runs the suite with two stack slots instead of serial and a 12-minute timeout instead of 35 — the RAM-saturation failure class is gone.
