# Plan: the boot seam — one supervision core for `bos dev` and `bos start`

Status: Draft — awaiting challenge on the two flagged risks (see §7)
Origin: the 2026-11-20 rc.46 incident post-mortem; designs A–D of the
design-it-twice exercise (minimal-interface / service-kind / common-caller /
ports-and-adapters), hybridized.

## 1. Problem

The dev/start process model grew without a decision record. Today:

- `dev/session.ts` + `dev/orchestrator.ts` (~1,500 lines) serve **two
  topologies**: dev supervises N child processes; start boots an in-process
  MF host with remote probes. Mode-conditional behavior is accreting (the
  strict-boot branch was the first).
- `ProcessHandle`'s dummy shape conflates three meanings (remote /
  dev-tolerated failure / production failed start).
- `waitForExit` has no consumer; there is no restart policy; readiness is a
  hybrid of HTTP probes and stdout regex (`readyPatterns`/`errorPatterns`),
  and error classification flips on any line containing "error".
- Two SIGTERM escalation ladders (session `armForce`; `bos kill`), two
  readiness loops, a log pipeline whose readiness carve-out institutionalizes
  string-matching (ADR 0016's "readiness keeps matching raw lines").

## 2. Target

One module — `packages/everything-dev/src/services/boot/` — one seam:

```ts
// public surface (the only things a caller knows)
export type BootMode = "dev" | "start";

export interface BootSpec {
  readonly mode: BootMode;
  readonly config: RuntimeConfig;       // verified composition — control-plane output (ADR 0043)
  readonly env: Record<string, string>; // precedence: shell > generated > .env-file
  readonly dir: string;                 // session root: registry, logs, snapshot state
}

export interface BootSession {
  readonly url: string;                 // valid only after acquisition succeeds
  readonly events: Stream.Stream<BootEvent>; // { unit, status, message? } — the supervision surface
}

export class BootFailure extends Data.TaggedError("BootFailure")<{
  readonly failed: readonly string[];
}> {}

export const bootRuntime: (
  spec: BootSpec,
) => Effect.Effect<BootSession, BootFailure, Scope | Supervisor>;

export const sessionTable: (dir: string) => Effect.Effect<SessionTable>; // bos ps / bos kill only
```

### Invariants (the contract that killed the bug class)

- Every unit reaches `ready`, `failed`, or `down`. **No fourth silent state** —
  a failed start never yields a handle.
- Scope close **is** teardown: one escalation ladder (graceful →
  `forceTimeoutMs` → group kill → registry unregister → log flush), the ppid
  backstop inside.
- `dev` tolerates a partial start (a failed unit is renderer state, then an
  automatic restart — bounded); `start` fails with `BootFailure` — non-zero
  exit is the boot verdict the smoke consumes.
- The boot never resolves config from the registry — it consumes a verified
  composition. Byte-level verification (SRI, chain walk) stays inside the
  boot's host adapter; registry resolution stays in the control plane
  (`startBootstrap`). ADR 0043 becomes literal.
- Readiness is **HTTP-only** (`readinessPath`/URL + deadline). Stdout regex
  is display classification only.

### The internal seam: `Supervisor` (Effect `Context.Service`)

```ts
export type UnitPayload =
  | { readonly _tag: "process"; command: string; args: readonly string[]; cwd: string; port: number }
  | { readonly _tag: "host-module"; remoteUrl: string; port: number }  // the MF sequence lives here
  | { readonly _tag: "probe"; url: string };                           // readiness only, nothing spawns

export interface UnitSpec {
  readonly name: string;
  readonly phase: 1 | 2;            // host last — replaces STARTUP_ORDER string sorting
  readonly payload: UnitPayload;
  readonly readiness: { url: string; deadlineMs: number };
}

export interface UnitHandle {
  readonly pid?: number;
  readonly events: Stream.Stream<UnitEvent>; // log events, then `exited` exactly once, last
  readonly terminate: (mode: "graceful" | "force") => Effect<void>; // owns its escalation
}

export class Supervisor extends Context.Service<Supervisor, {
  readonly spawn: (unit: UnitSpec) => Effect.Effect<UnitHandle, SupervisorError, Scope>;
}>()("everything-dev/boot/Supervisor") {}
```

Adapters (each a `Layer`): `SupervisorChildProcessLive` (spawn group, stdio →
stream, env tiering composed inside), `SupervisorInProcessHostLive` (the MF
pin-resolve → manifest → `loadRemoteModule` → `runServer` sequence with its
stage deadlines and retry schedules; console patching moved *inside* —
third-party libs inside the loaded module keep logging), and
`SupervisorScriptedLive` (tests — emit fake events, no processes, no ports).
Three real adapters: the two-adapter rule holds.

**No `kind` field, no `applies()` predicates.** The `_tag` union is the
kind axis; exhaustive switches stay compiler-checked. ("Slot" was considered
and rejected — retired vocabulary per GLOSSARY.md; collides with descriptor
attachment slots and infra-planner port slots.)

### Policy as data — restart is a `Schedule`

```ts
interface BootPolicy {
  readonly restart: Schedule.Schedule<any, unknown> | null; // dev: exponential×3 jittered; start: null
  readonly onUnitFailure: "tolerate" | "fail";
}
```

A dev crash-loop is `Effect.retry` with a bounded schedule — the same house
pattern as the deploy boot-retry — surfacing `starting`/"restarting (attempt
n)" events, then a loud `failed`. Production: `restart: null`, failure
accumulates into `BootFailure`.

### Effect idioms (house patterns, applied)

- `Context.Service` tag + `Layer` adapters (the `HttpFetch` precedent).
- Tagged errors yieldable directly: `return yield* new BootFailure(...)`;
  every rewrap forwards `cause` (coding-standards rule).
- Events as a `Stream` from an unbounded `Queue` — backpressure-free
  broadcast; ADR 0016's pipeline and the renderer are both consumers.
- Readiness: `HttpFetch` + `Effect.retry(Schedule.spaced(200ms))` +
  `Effect.timeoutOrElse(deadline)` — no new polling loops.
- Scope close is teardown: `Effect.scoped` + `addFinalizer`; the `Deferred`
  shutdown signal and the ppid backstop move inside the module.

## 3. Deletion list (the elimination)

`ProcessHandle`, `ProcessCallbacks`, `waitForExit` (zero consumers), the
`orElseSucceed` dummy handle, `DevSessionHandle.shutdown` + `runApp`'s signal
duplication, `DevSessionDeps` (ad-hoc `exit`/`reap`/`ppid`), `AppOrchestrator`
(`interactive`/`noLogs` become env-tier), `DevSessionData`, `StartSummary`,
`buildDescription` (ternary tree → data), `getProcessStates`,
`buildServiceDescriptorMapFromPlan` (passthrough), `detectStatus` +
`readyPatterns`/`errorPatterns`/`PLUGIN_READY_PATTERNS`/`PLUGIN_ERROR_PATTERNS`
/`SERVICE_CONFIGS` regex fields, `markForceExitInFlight`, the
`force()`/`armForce`/`disarmForce` trio, `spawnRemoteProbe`'s backoff fork,
`STARTUP_ORDER`/`sortByOrder`, `_runWithProgress` (dead), `noLogs`, the
`ServiceStartFailure` string contract — already deleted in #918.

Rough shape: `orchestrator.ts` 950 → ~400 (the MF sequence survives inside
the host-module adapter), `session.ts` 538 → ~250, `service-descriptor.ts`
loses its regex fields — net ~700+ lines deleted, two ladders → one, both
readiness loops → one poller.

## 4. ADR disposition

- **0004** (dev-serve entry resolution) — stays; orthogonal (bin dispatch).
- **0016** (unified log pipeline) — **amend**: pipeline intake becomes the
  Supervisor event stream; the three-sink broadcast is untouched; *delete the
  "readiness detection keeps matching raw lines" carve-out* — readiness is
  HTTP-only.
- **0021** (universal runtime image) — **amend**: PID 1 boots exactly one
  `host-module` unit; "container exit = boot verdict" is guaranteed by the
  interface (`BootFailure` → exit 1), no longer by convention.
- **0043** (two-plane boot) — **amend**: the runtime plane's only input is
  `BootSpec` (a verified composition); registry resolution is control-plane
  only. Precedence order untouched.
- **NEW — 0048 "the boot seam"** (this document's §2 promoted): the process
  model's first decision record — unit invariants, policy table, HTTP-only
  readiness, one ladder, the two-topologies-in-one-core resolution.

## 5. Migration stages (each green and shippable, stacked)

1. **Formalize the policy** — largely shipped (#918: `DevStartFailure`,
   tolerant dev). Remaining: name the policy as data, not branches.
2. **Introduce `services/boot` as a wrapper** — `bootRuntime` delegates to
   the existing session; callers (`runDev`, `runStart`) switch to the new
   surface. Zero behavior change.
3. **Move the MF host into `SupervisorInProcessHostLive`**, switch readiness
   to HTTP-only, delete the regex machinery and the second ladder.
4. **Dev restart policy** — bounded retry schedule per unit.
5. **Delete the dead interfaces** — the rest of the deletion list; retire
   the amended ADR lines.

## 6. What this buys

- The string-contract bug class (log-text-as-interface) is extinct by
  construction — third instance in one week was two too many.
- The whole boot model is unit-testable with zero processes
  (`SupervisorScriptedLive`).
- `bos dev` gains industry-expected crash recovery; `bos start` gains a
  guaranteed exit contract.
- The session module stops serving two masters; future mode divergences land
  in policy data, not branches.

## 7. Decisions (challenged 2026-11-23)

1. **HTTP-only readiness** — *downgraded from risk to formalization*: every
   descriptor already carries `readinessPath` (+ `readinessUrl`/
   `readinessMethod` overrides for POST-ping entries); HTTP readiness is the
   de-facto contract today. The target deletes the redundant regex signal;
   the service-authoring docs note "expose a pollable URL".
2. **Dev resolution upstream** — *dissolved*: seeding already runs in the dev
   bootstrap before services spawn (`runSeedPhase` in `boot/dev/boot.ts`);
   the boundary is formalization, not a move.
3. **`logTail` dropped** — `BootFailure{failed}` only. The failure lines
   already stream live to stdout through the display sink, and the smoke
   captures container stdout itself; add a tail later only if the TUI hides
   lines.
4. **Option creep** — `interactive` is already TTY-derived in the renderer
   (`dev-render.ts` checks `isTTY`); `noLogs` becomes mode-derived (file sink
   on in dev per ADR 0016, off in start where stdout is captured). Zero new
   fields; two deleted.
5. **The start banner is bootstrap-owned** — the config source + modules
   table prints from the bootstrap result (`result.summary`) before
   `bootRuntime`, exactly as today; the session owns no summary struct.
6. **Restart ×3 confirmed** for dev (bounded, loud failure after);
   production never restarts.
7. **Migration sequencing** — the #913/#918/#919 stack merged to main; the
   migration proceeds as ordinary PRs on main (tickets 04 → 05 → 06).
