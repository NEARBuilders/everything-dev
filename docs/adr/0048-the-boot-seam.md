# 0048 — The boot seam: one supervision core, policy as data

Date: 2026-11-23
Status: Accepted (2026-11-27 — the boot-seam migration, tickets 04–06 of `.scratch/deploy-hardening/`; plan: docs/plans/boot-seam.md)

## Context

The dev/start process model has no decision record. Two boot flows (`bos dev`,
`bos start`) share one session module that serves two topologies: dev
supervises N child processes; start boots an in-process Module-Federation host
inside the container's PID 1 and probes remote URLs. Behavior accumulated
without ever being decision-recorded: failed starts were swallowed into a
dummy `ProcessHandle` (`waitForExit: Effect.never`), readiness was a hybrid of
HTTP probes and stdout regex (`readyPatterns`/`errorPatterns` — any line
containing "error" flipped a service's status), `waitForExit` had no consumer,
there was no restart policy, and SIGTERM escalation existed twice (the
session's `armForce` ladder and `bos kill`'s). The 2026-11-20 rc.46 incident
made the cost visible: a host that died in the first second kept the container
alive for the smoke's full 240s deadline, and the fix (#918) added the first
mode-conditional branch to a module already serving two masters.

A design-it-twice exercise (four independent target designs) converged on one
skeleton: a single supervision core with a tolerant/strict policy and thin
adapters, dummy handles eliminated, one escalation ladder, readiness by HTTP.

## Decision

**1. One module, one seam.** `services/boot` exposes `bootRuntime(spec) →
BootSession` and `sessionTable(dir)` (the `bos ps`/`bos kill` contract).
Everything else — spawners, readiness, escalation, rendering, the MF host
sequence — is implementation.

**2. Unit invariants.** Every unit reaches `ready`, `failed`, or `down` — no
fourth silent state. A failed start never yields a handle. Scope close is
teardown (one escalation ladder, registry unregister, log flush).

**3. Policy as data, per mode.**

- `dev` — tolerant: a failed unit is renderer state, then an automatic
  restart bounded by a retry `Schedule` (exponential ×3, jittered), then a
  loud `failed`.
- `start` — strict: any start failure or readiness deadline fails the session
  with `BootFailure` (names the units); `runApp` maps it to exit 1. **The
  container's exit code is the boot verdict** — the deploy smoke's exit watch
  is the consumer. Production never restarts.
- Production never restarts. Restarts exist to keep development flow, not to
  mask failures.

**4. Readiness is HTTP-only.** Each unit's readiness is an HTTP probe against
its `readinessPath`/URL with a deadline. Stdout regex is display
classification only, never boot-blocking. Service authors must expose a
pollable URL — fail-loud replaces string-matching (the "log text as
interface" bug class: the service-start string contract, the cause-chain
severance, the regex readiness — three instances in one week).

**5. The unit seam.** `Supervisor` (a `Context.Service`) spawns units by
`_tag`-discriminated payload — `process` (child `pnpm run dev`), `host-module`
(the MF sequence, console patching inside), `probe` (readiness-only) — and
returns a `UnitHandle` (`events` stream, self-escalating `terminate`). Three
real adapters (child, in-process, scripted-test): the two-adapter rule holds.
The word "kind" is retired from this domain: the `_tag` variants are the
names. "Slot" is rejected — retired vocabulary per GLOSSARY.md.

**6. The boot consumes a verified composition.** `BootSpec.config` is already
resolved by the control plane (`startBootstrap`); the boot never resolves from
the registry (ADR 0043 becomes literal). Byte-level verification (SRI, chain
walk) stays inside the host-module adapter — the runtime still verifies what
it serves.

## Consequences

- ~700+ lines deleted: `ProcessHandle`, `ProcessCallbacks`, `waitForExit`,
  dummy handles, `AppOrchestrator`, `DevSessionData`, `StartSummary`,
  `detectStatus` and every regex pattern list, the `force`/`armForce`/
  `disarmForce` trio, `STARTUP_ORDER`, `DevSessionDeps`, the second SIGTERM
  ladder, both duplicated readiness loops.
- The boot model becomes unit-testable without spawning anything
  (`SupervisorScriptedLive`).
- Development gains industry-expected crash recovery; production gains a
  guaranteed exit contract.
- ADR 0016 amended: pipeline intake is the Supervisor event stream; the
  "readiness keeps matching raw lines" carve-out is deleted. ADR 0021
  amended: PID 1 boots exactly one `host-module` unit; exit-verdict is
  interface-guaranteed. ADR 0043 amended: `BootSpec` is the runtime plane's
  only input.
- Accepted costs: every service must expose a pollable readiness URL
  (fail-loud contract on service authors); third-party logging inside the
  MF-loaded module stays routed through the in-process adapter's console
  patch (locality fix, same behavior); mode knobs (`interactive`, `noLogs`)
  stay env-tier, never `BootSpec` fields.
