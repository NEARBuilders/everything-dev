import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Exit, Layer } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ShellEnvLive } from "../../src/env/project-env";
import type { ProcessCallbacks, ProcessHandle } from "../../src/services/dev/orchestrator";
import { DevRenderer } from "../../src/services/dev/render";
import {
  DevGeneratedEnvLive,
  DevRuntimeConfigLive,
  type ServiceDescriptor,
  ServiceDescriptorMapLive,
} from "../../src/services/dev/service-descriptor";
import type { DevSessionDeps, DevSessionHandle } from "../../src/services/dev/session";
import { runDevSession } from "../../src/services/dev/session";

const mocks = vi.hoisted(() => {
  const state = {
    fakeHandles: [] as Array<{
      name: string;
      pid: number;
      ready: Deferred.Deferred<void> | null;
      kill: () => void;
    }>,
    kills: [] as string[],
    sequence: [] as string[],
    callbacks: {} as Record<string, ProcessCallbacks>,
    view: {
      updateProcess: vi.fn(),
      addLog: vi.fn(),
      unmount: vi.fn(() => {
        state.sequence.push("unmount");
      }),
    },
    tmpRoot: "",
    registryPath: "",
  };
  return state;
});

vi.mock("../../src/services/dev/orchestrator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/dev/orchestrator")>();
  return {
    ...actual,
    makeDevProcess: (pkg: string, callbacks: ProcessCallbacks) => {
      mocks.callbacks[pkg] = callbacks;
      const deferred = Deferred.makeUnsafe<void>();
      const handle = {
        name: pkg,
        pid: 5100 + mocks.fakeHandles.length,
        resolved: false,
        ready: deferred,
        kill: () => {
          mocks.kills.push(pkg);
          mocks.sequence.push(`kill:${pkg}`);
        },
      };
      mocks.fakeHandles.push(handle);
      const processHandle: ProcessHandle = {
        name: pkg,
        pid: handle.pid,
        kill: Effect.sync(() => handle.kill()),
        waitForReady: Deferred.await(deferred),
        waitForExit: Effect.never,
      };
      return Effect.succeed(processHandle);
    },
  };
});

const makeDescriptor = (name: string): ServiceDescriptor => ({
  key: name,
  source: "local",
  url: `http://localhost:300${name.length}`,
  entry: "unused",
  name,
  port: 3000,
  readinessPath: "/",
  defaultPort: 3000,
});

const fakeRuntimeConfig = {
  host: { port: 3000, source: "local" },
  api: { port: 3001, source: "local" },
  ui: { port: 3003, source: "local" },
  auth: undefined,
  plugins: {},
} as never;

const orchestrator = {
  packages: ["api", "host"],
  description: "test session",
  env: {},
  interactive: false,
};

const runSession = (deps: DevSessionDeps = {}) => {
  let handle: DevSessionHandle | null = null;
  const program = Effect.scoped(
    runDevSession(
      mocks.tmpRoot,
      orchestrator as never,
      (h) => {
        handle = h;
      },
      deps,
    ),
  ).pipe(
    Effect.provide(
      Layer.mergeAll(
        ServiceDescriptorMapLive(
          new Map([
            ["host", makeDescriptor("host")],
            ["api", makeDescriptor("api")],
          ]),
        ),
        DevRuntimeConfigLive(fakeRuntimeConfig),
        DevGeneratedEnvLive({}),
        ShellEnvLive({}),
        Layer.succeed(DevRenderer, DevRenderer.of({ create: () => mocks.view })),
      ),
    ),
  );
  return {
    program,
    getHandle: () => handle as unknown as DevSessionHandle,
  };
};

const waitForSpawns = async (count: number) => {
  await vi.waitFor(() => {
    expect(mocks.fakeHandles.length).toBeGreaterThanOrEqual(count);
  });
};

const makeAllReady = async (count: number) => {
  for (let i = 0; i < 100; i++) {
    for (const handle of mocks.fakeHandles) {
      if (!handle.resolved) {
        handle.resolved = true;
        await Effect.runPromise(Deferred.succeed(handle.ready!, undefined));
      }
    }
    if (mocks.fakeHandles.length >= count && mocks.fakeHandles.every((h) => h.resolved)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("handles never became ready");
};

const registryEntries = (): Array<Record<string, unknown>> => {
  try {
    return JSON.parse(readFileSync(mocks.registryPath, "utf-8")) as never;
  } catch {
    return [];
  }
};

describe("runDevSession quit correctness", () => {
  beforeAll(() => {
    mocks.tmpRoot = mkdtempSync(join(tmpdir(), "dev-session-test-"));
    mocks.registryPath = join(mocks.tmpRoot, "pids.json");
    process.env.BO_PID_REGISTRY_PATH = mocks.registryPath;
  });

  beforeEach(() => {
    mocks.fakeHandles = [];
    mocks.kills = [];
    mocks.sequence = [];
    mocks.callbacks = {};
    mocks.view.addLog.mockClear();
    mocks.view.updateProcess.mockClear();
  });

  afterEach(() => {
    try {
      rmSync(mocks.registryPath, { force: true });
    } catch {
      // ignore
    }
  });

  it("kills spawned handles and exits cleanly when graceful shutdown fires during startup", async () => {
    const { program, getHandle } = runSession();
    const exitPromise = Effect.runPromiseExit(program);

    await waitForSpawns(1);
    getHandle().shutdown("graceful");

    const exit = await exitPromise;
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(mocks.kills).toContain("api");
    expect(mocks.kills).not.toContain("host");
    expect(mocks.view.unmount).toHaveBeenCalled();
  });

  it("kills all handles and unregisters after a clean running-phase quit", async () => {
    const { program, getHandle } = runSession();
    const exitPromise = Effect.runPromiseExit(program);

    await makeAllReady(2);
    const entry = registryEntries().find((e) => e.pid === process.pid);
    expect((entry?.childPids as number[])?.length).toBe(2);

    getHandle().shutdown("graceful");

    const exit = await exitPromise;
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(new Set(mocks.kills)).toEqual(new Set(["api", "host"]));
    const killIndexes = mocks.sequence
      .filter((s) => s.startsWith("kill:"))
      .map((s) => mocks.sequence.indexOf(s));
    const unmountIndex = mocks.sequence.indexOf("unmount");
    expect(unmountIndex).toBeGreaterThanOrEqual(0);
    for (const killIndex of killIndexes) {
      expect(killIndex).toBeLessThan(unmountIndex);
    }
    await vi.waitFor(() => {
      expect(registryEntries().filter((e) => e.pid === process.pid).length).toBe(0);
    });
  });

  it("escalates to force — reap, pipeline flush, exit — when a graceful shutdown overruns its timer", async () => {
    const exitSpy = vi.fn();
    const reapSpy = vi.fn();
    const { program, getHandle } = runSession({ exit: exitSpy, reap: reapSpy, forceTimeoutMs: 50 });
    const exitPromise = Effect.runPromiseExit(program);

    await makeAllReady(2);
    getHandle().shutdown("graceful");

    await exitPromise;
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(reapSpy).toHaveBeenCalled();
  });

  it("a second graceful shutdown escalates straight to force", async () => {
    const exitSpy = vi.fn();
    const reapSpy = vi.fn();
    const { program, getHandle } = runSession({ exit: exitSpy, reap: reapSpy });
    const exitPromise = Effect.runPromiseExit(program);

    await makeAllReady(2);
    getHandle().shutdown("graceful");
    getHandle().shutdown("graceful");

    await exitPromise;
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(reapSpy).toHaveBeenCalled();
  });

  it("the orphan watchdog force-exits when the session is reparented", async () => {
    let ppid = 4242;
    const exitSpy = vi.fn();
    const reapSpy = vi.fn();
    const { program } = runSession({ exit: exitSpy, reap: reapSpy, ppid: () => ppid });
    const exitPromise = Effect.runPromiseExit(program);

    await makeAllReady(2);
    ppid = 1;

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
    expect(reapSpy).toHaveBeenCalledWith(5100);
    expect(reapSpy).toHaveBeenCalledWith(5101);
    await exitPromise;
  });

  it("force exit drains the pipeline's pending multi-line buffer through the display sink", async () => {
    const exitSpy = vi.fn();
    const reapSpy = vi.fn();
    const { program, getHandle } = runSession({ exit: exitSpy, reap: reapSpy });
    const exitPromise = Effect.runPromiseExit(program);

    await makeAllReady(2);
    mocks.callbacks.api?.onLog("api", "Error: pending multi-line tail", true);
    expect(mocks.view.addLog).not.toHaveBeenCalled();

    getHandle().shutdown("force");

    await exitPromise;
    expect(mocks.view.addLog).toHaveBeenCalledWith("api", "Error: pending multi-line tail", true);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
