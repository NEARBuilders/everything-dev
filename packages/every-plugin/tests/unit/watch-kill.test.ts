import { describe, expect, it, vi } from "vitest";
import { killChildEscalating, watchParentDeath } from "../../src/dev/watch-kill";

interface FakeChildOptions {
  exitsOnSignal?: NodeJS.Signals | null;
  terminateMs?: number;
}

const makeFakeChild = (opts: FakeChildOptions = {}) => {
  const { exitsOnSignal = "SIGTERM", terminateMs = 0 } = opts;
  const killCalls: Array<NodeJS.Signals | undefined> = [];
  const exitListeners: Array<() => void> = [];
  const child = {
    pid: 4242 as number | undefined,
    exitCode: null as number | null,
    killed: false,
    kill: (signal?: NodeJS.Signals) => {
      killCalls.push(signal);
      child.killed = true;
      if (exitsOnSignal === signal) {
        child.exitCode = 0;
        for (const listener of [...exitListeners]) listener();
      }
    },
    addListener: (_event: "exit", listener: () => void) => {
      exitListeners.push(listener);
      return child;
    },
    removeListener: (_event: "exit", listener: () => void) => {
      const idx = exitListeners.indexOf(listener);
      if (idx >= 0) exitListeners.splice(idx, 1);
      return child;
    },
  };
  const pause = () => new Promise((r) => setTimeout(r, terminateMs));
  return { child, killCalls, pause };
};

describe("killChildEscalating", () => {
  it("sends only SIGTERM when the child exits on SIGTERM", async () => {
    const { child, killCalls } = makeFakeChild({ exitsOnSignal: "SIGTERM" });
    await killChildEscalating(child as never, 500);
    expect(killCalls).toEqual(["SIGTERM"]);
  });

  it("escalates to SIGKILL when the child ignores SIGTERM", async () => {
    const { child, killCalls } = makeFakeChild({ exitsOnSignal: "SIGKILL" });
    await killChildEscalating(child as never, 50);
    expect(killCalls).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("does nothing for an already-exited child", async () => {
    const { child, killCalls } = makeFakeChild();
    child.exitCode = 0;
    await killChildEscalating(child as never, 50);
    expect(killCalls).toEqual([]);
  });
}, 10000);

describe("watchParentDeath", () => {
  it("fires once and stops when the ppid changes", async () => {
    vi.useFakeTimers();
    let ppid = 100;
    const onDeath = vi.fn();
    const watch = watchParentDeath(onDeath, { intervalMs: 10, getPpid: () => ppid });
    ppid = 1;
    await vi.advanceTimersByTimeAsync(50);
    expect(onDeath).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(onDeath).toHaveBeenCalledTimes(1);
    watch.stop();
    vi.useRealTimers();
  });

  it("does not fire while the ppid is stable", async () => {
    vi.useFakeTimers();
    const onDeath = vi.fn();
    const watch = watchParentDeath(onDeath, { intervalMs: 10, getPpid: () => 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(onDeath).not.toHaveBeenCalled();
    watch.stop();
    vi.useRealTimers();
  });
}, 10000);
