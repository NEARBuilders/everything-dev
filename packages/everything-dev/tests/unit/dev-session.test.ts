import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Exit } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runDevSession } from "../../src/dev-session";
import { ShellEnvLive } from "../../src/env/project-env";
import type { ProcessHandle } from "../../src/orchestrator";
import {
  DevGeneratedEnvLive,
  DevRuntimeConfigLive,
  type ServiceDescriptor,
  ServiceDescriptorMapLive,
} from "../../src/service-descriptor";

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

vi.mock("../../src/config", () => ({
  getProjectRoot: () => mocks.tmpRoot,
}));

vi.mock("../../src/components/dev-render", () => ({
  createDevRenderer: () => mocks.view,
}));

vi.mock("../../src/orchestrator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/orchestrator")>();
  return {
    ...actual,
    makeDevProcess: (pkg: string) => {
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

const runSession = () => {
  let controls: Record<string, () => void> | null = null;
  const program = Effect.scoped(
    runDevSession(orchestrator as never, (c) => {
      controls = c as never;
    }),
  ).pipe(
    Effect.provide(
      ServiceDescriptorMapLive(
        new Map([
          ["host", makeDescriptor("host")],
          ["api", makeDescriptor("api")],
        ]),
      ),
    ),
    Effect.provide(DevRuntimeConfigLive(fakeRuntimeConfig)),
    Effect.provide(DevGeneratedEnvLive({})),
    Effect.provide(ShellEnvLive({})),
  );
  return {
    program,
    getControls: () => controls as unknown as Record<string, () => void>,
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
  });

  afterEach(() => {
    try {
      rmSync(mocks.registryPath, { force: true });
    } catch {
      // ignore
    }
  });

  it("kills spawned handles and exits cleanly when shutdown fires during startup", async () => {
    const { program, getControls } = runSession();
    const exitPromise = Effect.runPromiseExit(program);

    await waitForSpawns(1);
    getControls().requestShutdown();

    const exit = await exitPromise;
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(mocks.kills).toContain("api");
    expect(mocks.kills).not.toContain("host");
    expect(mocks.view.unmount).toHaveBeenCalled();
  });

  it("kills all handles and unregisters after a clean running-phase quit", async () => {
    const { program, getControls } = runSession();
    const exitPromise = Effect.runPromiseExit(program);

    await makeAllReady(2);
    const entry = registryEntries().find((e) => e.pid === process.pid);
    expect((entry?.childPids as number[])?.length).toBe(2);

    getControls().requestShutdown();

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

  it("re-arms the force exit timer when the finalizer starts", async () => {
    const { program, getControls } = runSession();
    const exitPromise = Effect.runPromiseExit(program);

    await makeAllReady(2);
    const controls = getControls();
    const suspendSpy = vi.spyOn(controls, "rearmForceExitTimer");
    controls.requestShutdown();

    await exitPromise;
    expect(suspendSpy).toHaveBeenCalled();
  });
});
