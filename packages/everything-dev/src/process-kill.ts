import { Effect } from "effect";
import { isPidAlive } from "./process-registry";

export interface KillEscalationOptions {
  terminateMs?: number;
  signal?: NodeJS.Signals;
}

const DEFAULT_TERMINATE_MS = 5000;
const POLL_INTERVAL_MS = 250;

const groupKill = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
};

const waitGone = (pid: number, timeoutMs: number): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;
    while (isPidAlive(pid)) {
      if (Date.now() >= deadline) return false;
      yield* Effect.sleep(POLL_INTERVAL_MS);
    }
    return true;
  });

// killProcessGroupEscalating mirrors the dev session's per-child kill: signal
// the process group (direct-pid fallback), wait for exit, then SIGKILL the
// group if the graceful signal was ignored.
export const killProcessGroupEscalating = (
  pid: number,
  options?: KillEscalationOptions,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const terminateMs = options?.terminateMs ?? DEFAULT_TERMINATE_MS;
    const signal = options?.signal ?? "SIGTERM";
    if (pid <= 1 || pid === process.pid) return;
    if (!isPidAlive(pid)) return;
    groupKill(pid, signal);
    if (signal === "SIGKILL") return;
    const gone = yield* waitGone(pid, terminateMs);
    if (!gone) {
      groupKill(pid, "SIGKILL");
      yield* waitGone(pid, 1000);
    }
  });

// reapGroup hard-kills a process group with direct-pid fallback — the
// post-escalation cleanup for service trees and their watcher grandchildren.
export const reapGroup = (pid: number): void => {
  if (pid <= 1 || pid === process.pid) return;
  groupKill(pid, "SIGKILL");
};
