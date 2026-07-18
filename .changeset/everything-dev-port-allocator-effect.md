---
"everything-dev": minor
---

Introduce `PortAllocator` Effect service, bind-based port probing, parallel candidate scanning, and async registry pruning.

## PortAllocator service + tagged errors (A+B)

- `app.ts`: `PortAllocator` `Context.Tag` with `pickAvailable(preferred, budget?)` returning `Effect<number, PortAllocationError>`. `PortAllocationError` is a `Data.TaggedError` with `preferred`, `budget?`, and `cause?` fields, replacing the bare `RangeError` throws from the prior implementation.
- `prepareDevelopmentRuntimeConfig` is now an `Effect.gen` that yields `PortAllocator` for each port pick. Returns `PreparedDevRuntime` = `{ runtimeConfig, devPorts }` — the caller no longer re-derives `devPorts` from the runtime config (eliminates duplicated `hasLocalPlugin`/`firstLocalPluginPort` logic in `plugin.ts`).
- `PortAllocatorLive` layer co-located in `app.ts`, seeds `usedPorts` from `claimedPorts()` (flattened from the global PID registry) so concurrent `bos dev` sessions skip ports already claimed by live sessions. Fixes the multi-instance port collision observed with `overmind`.
- `plugin.ts` dev handler wraps the call in `Effect.runPromise(...pipe(Effect.provide(PortAllocatorLive)))` and uses the returned `devPorts` directly in `savePortState`.
- `process-registry.ts`: replaces `claimPorts()` (array of port-maps) with `claimedPorts(): Set<number>` (flattened set for direct `usedPorts` seeding).
- Tests: `app.test.ts` rewritten with a hermetic `PortAllocatorTest` layer — no real TCP probing. Covers Bug C (remote host preserved), Bug A (remote services → undefined devPorts), budget clamping/success, `claimPorts` seeding, and `PortAllocationError` on budget exhaustion (verified via `Effect.runPromiseExit` + `Cause.pretty`).

## Bind-based port probing (smell #2)

- Replaced connect-based `probeTcpOpen` (which only detected "is something already listening") with bind-based `probePortBindable` using `net.createServer().listen(port, "127.0.0.1")`. This catches `EADDRINUSE` for bound-but-not-listening sockets and `EACCES` for privileged ports — cases connect-based probing missed. The server is closed in the `listening` callback before the Effect resolves, narrowing the TOCTOU window between probe and child bind.

## Parallel candidate probing (smell #4)

- `pickAvailablePort` now probes `PARALLEL_PROBE_WINDOW` (8) candidate ports in parallel via `Effect.forEach` with `concurrency: "unbounded"`, taking the first free one. Eliminates the sequential 250ms-per-busy-port walk that could add 1+ seconds to startup on busy hosts.

## Async pruneDead (smell #8)

- `process-registry.ts`: added `pruneDeadEffect(entries): Effect<PidEntry[]>` that uses `fs.promises.access` (async) instead of `existsSync` (sync) for `configDir` checks, with `Effect.forEach` concurrency unbounded. Sync `pruneDead` retained for low-frequency callers (`registerStandalone`, `unregisterPid`, `claimedPorts`).
- `plugin.ts`: `ps` and `kill` handlers now use `pruneDeadEffect` via `Effect.runPromise`, avoiding blocking the main thread on sync filesystem syscalls when the registry grows.
- Test: `process-registry.test.ts` verifies `pruneDeadEffect` filters pid<=1, dead pids, and missing configDirs concurrently.

## Constants hoisted (smell #5)

- `PROBE_TIMEOUT_MS`, `MAX_PORT_SCAN_STEPS`, `PARALLEL_PROBE_WINDOW` are named module-level constants instead of inline magic numbers.

No breaking changes to the published `exports` map. `prepareDevelopmentRuntimeConfig` is internal (not exported via `package.json` `exports`), so the signature change from `Promise<RuntimeConfig>` to `Effect<PreparedDevRuntime, PortAllocationError, PortAllocator>` is safe.