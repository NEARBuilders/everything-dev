import type { Effect, Scope, Stream } from "effect";
import { Context, Data } from "effect";

/** How a named unit comes to life. The `_tag` variants are the kind axis —
 * no `kind` field, no predicates (ADR 0048). */
export type UnitPayload =
  | {
      readonly _tag: "process";
      readonly command: string;
      readonly args: readonly string[];
      readonly cwd: string;
      readonly port: number;
    }
  | { readonly _tag: "host-module"; readonly remoteUrl: string; readonly port: number }
  | { readonly _tag: "probe"; readonly url: string };

export interface UnitSpec {
  readonly name: string;
  /** Phase 1 starts before phase 2; the host is always phase 2. */
  readonly phase: 1 | 2;
  readonly payload: UnitPayload;
  /** HTTP readiness probe — the only readiness signal (stdout is
   * display-only). Probes tried in order each tick; deadline is the only
   * timeout authority. */
  readonly readiness: {
    readonly urls: readonly string[];
    readonly method?: "GET" | "POST";
    readonly deadlineMs: number;
  };
}

export type UnitEvent =
  | { readonly type: "log"; readonly line: string; readonly stderr: boolean }
  | { readonly type: "exited"; readonly code: number; readonly signal?: string };

export interface UnitHandle {
  readonly pid: number | undefined;
  /** Log lines, then `exited` exactly once (last, for process-bearing
   * units; probe units never emit `exited`). */
  readonly events: Stream.Stream<UnitEvent>;
  /** Idempotent; owns its own escalation (SIGTERM → timeout → SIGKILL for
   * process groups; server shutdown for the in-process host). Safe on a
   * never-started unit. */
  readonly terminate: (mode: "graceful" | "force") => Effect.Effect<void>;
}

export class SupervisorError extends Data.TaggedError("SupervisorError")<{
  readonly unit: string;
  readonly detail: string;
  readonly cause?: unknown;
}> {
  override get message() {
    return `supervisor: ${this.unit}: ${this.detail}`;
  }
}

/** The unit seam: spawn by payload, observe via events, terminate through
 * the handle. adapters.ts (or a scripted test layer) satisfies it; the
 * session core knows nothing about child processes, MF loading, or probing
 * mechanics (ADR 0048). */
export class Supervisor extends Context.Service<
  Supervisor,
  {
    readonly spawn: (unit: UnitSpec) => Effect.Effect<UnitHandle, SupervisorError, Scope.Scope>;
  }
>()("everything-dev/boot/Supervisor") {}

// ── spawned-unit pre-bridge shape + shared supervision types ──

/** A spawned unit, pre-bridge: the adapters assemble the public `UnitHandle`
 * (events stream, terminate) around this. Stdout is display-only — no
 * readiness, no error classification lives here (ADR 0048). */
export interface ProcessHandle {
  name: string;
  pid: number | undefined;
  events: Stream.Stream<UnitEvent>;
  terminate: (mode: "graceful" | "force") => Effect.Effect<void>;
}

export class OrchestratorError extends Data.TaggedError("OrchestratorError")<{
  readonly operation: string;
  readonly detail: string;
  readonly cause?: unknown;
}> {
  override get message() {
    return `${this.operation}: ${this.detail}`;
  }
}

export type ProcessStatus = "pending" | "starting" | "ready" | "error";

export interface ProcessCallbacks {
  onStatus: (name: string, status: ProcessStatus, message?: string) => void;
  onLog: (name: string, line: string, isError?: boolean) => void;
}
