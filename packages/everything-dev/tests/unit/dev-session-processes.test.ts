import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Exit, Layer } from "effect";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ShellEnvLive } from "../../src/env/project-env";
import { DevRenderer } from "../../src/services/dev/render";
import {
  DevGeneratedEnvLive,
  DevRuntimeConfigLive,
  type ServiceDescriptor,
  ServiceDescriptorMapLive,
} from "../../src/services/dev/service-descriptor";
import {
  type DevSessionDeps,
  type DevSessionHandle,
  runDevSession,
} from "../../src/services/dev/session";
import { reapGroup } from "../../src/services/processes/kill";
import {
  isPidAlive,
  type PidEntry,
  readRegistry,
  writeRegistry,
} from "../../src/services/processes/registry";
import type { RuntimeConfig } from "../../src/types";
import { groupMembersOf } from "../helpers/group-members";

const fixtureDir = fileURLToPath(new URL("../fixtures/", import.meta.url));
const fixturePath = fileURLToPath(new URL("../fixtures/fake-service.mjs", import.meta.url));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const grabPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => resolve(port));
    });
  });

const grabPorts = async (): Promise<[number, number, number]> => {
  const a = await grabPort();
  const b = await grabPort();
  const c = await grabPort();
  return [a, b, c];
};

const fakeDescriptor = (key: string, port: number, ignoreTerm: boolean): ServiceDescriptor => ({
  key,
  source: "local",
  url: `http://localhost:${port}`,
  entry: "unused",
  name: key,
  localPath: fixtureDir,
  command: process.execPath,
  args: [fixturePath, String(port), ...(ignoreTerm ? ["--ignore-term"] : [])],
  port,
  readinessPath: "/health",
  defaultPort: port,
});

const makeRuntimeConfig = (hostPort: number, apiPort: number, uiPort: number): RuntimeConfig => ({
  env: "development",
  account: "test.near",
  networkId: "mainnet",
  host: {
    name: "host",
    url: `http://localhost:${hostPort}`,
    entry: "unused",
    source: "local",
    port: hostPort,
  },
  ui: {
    name: "ui",
    url: `http://localhost:${uiPort}`,
    entry: "unused",
    source: "local",
    port: uiPort,
  },
  api: {
    name: "api",
    url: `http://localhost:${apiPort}`,
    entry: "unused",
    source: "local",
    port: apiPort,
  },
  plugins: {},
});

const noopHandle = () => ({
  updateProcess: () => {},
  addLog: () => {},
  unmount: () => {},
});

const startSession = (
  configDir: string,
  ports: [number, number, number],
  deps: DevSessionDeps = {},
  descriptorOpts: { ignoreTerm?: boolean } = {},
) => {
  const ignoreTerm = descriptorOpts.ignoreTerm ?? false;
  const descriptors = new Map<string, ServiceDescriptor>([
    ["service-a", fakeDescriptor("service-a", ports[0], ignoreTerm)],
    ["service-b", fakeDescriptor("service-b", ports[1], ignoreTerm)],
  ]);
  const orchestrator = {
    packages: ["service-a", "service-b"],
    description: "process-death contract",
    env: {},
    noLogs: true,
  };
  let handle: DevSessionHandle | null = null;
  const program = Effect.scoped(
    runDevSession(
      configDir,
      orchestrator,
      (sessionHandle) => {
        handle = sessionHandle;
      },
      deps,
    ),
  ).pipe(
    Effect.provide(
      Layer.mergeAll(
        ServiceDescriptorMapLive(descriptors),
        DevRuntimeConfigLive(makeRuntimeConfig(ports[0], ports[1], ports[2])),
        DevGeneratedEnvLive({}),
        ShellEnvLive({}),
        Layer.succeed(DevRenderer, DevRenderer.of({ create: () => noopHandle() })),
      ),
    ),
  );
  return {
    handle: () => {
      if (!handle) throw new Error("session handle never became ready");
      return handle;
    },
    done: Effect.runPromiseExit(program),
  };
};

// The suite's single readiness definition, mirroring the Go harness's
// awaitRegistryEntry: the session writes childPids only after every spawned
// service has reached ready.
const awaitRegistryEntry = async (): Promise<PidEntry> =>
  vi.waitFor(
    async () => {
      const entry = readRegistry().find((e) => e.pid === process.pid);
      expect(entry).toBeDefined();
      expect(entry?.childPids?.length).toBe(2);
      return entry as PidEntry;
    },
    { timeout: 20_000, interval: 100 },
  );

const expectAllDead = async (pids: number[], windowMs = 8_000) => {
  const deadline = Date.now() + windowMs;
  for (;;) {
    const alive = pids.filter((pid) => isPidAlive(pid));
    if (alive.length === 0) return;
    if (Date.now() > deadline) {
      throw new Error(`process(es) survived teardown: ${alive.join(", ")}`);
    }
    await sleep(100);
  }
};

const expectPortsBindable = async (ports: number[]) => {
  for (const port of ports) {
    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve());
      });
    });
  }
};

const spawnSleeper = () => {
  const child = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
  const pid = child.pid;
  if (pid === undefined) throw new Error("sleeper pid missing");
  const wait = new Promise<void>((resolve) => child.once("exit", resolve));
  record(pid);
  return { pid, wait };
};

const spawnDeadSessionPid = async (): Promise<number> => {
  const { pid, wait } = spawnSleeper();
  reapGroup(pid);
  await wait;
  return pid;
};

const killTargets = new Set<number>();
const record = (pid: number) => {
  if (pid > 1) killTargets.add(pid);
};
const recordAll = (pids: number[]) => {
  for (const pid of pids) record(pid);
};

const tmpDirs: string[] = [];
const makeTmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-session-death-"));
  tmpDirs.push(dir);
  return dir;
};

describe("runDevSession process-death contract (real children)", () => {
  afterEach(() => {
    delete process.env.BO_PID_REGISTRY_PATH;
    const targets = [...killTargets];
    killTargets.clear();
    for (const pid of targets) {
      try {
        reapGroup(pid);
      } catch {
        // already gone
      }
    }
  });

  afterAll(() => {
    // The session's log sink writes fire-and-forget; dir removal must wait
    // until every pending write settled.
    for (const dir of tmpDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("graceful shutdown kills children and watcher grandchildren, frees ports, and cleans the registry", async () => {
    const tmp = makeTmp();
    process.env.BO_PID_REGISTRY_PATH = join(tmp, "pids.json");
    const ports = await grabPorts();
    const { handle, done } = startSession(tmp, ports, {
      exit: (code) => exitCodes.push(code),
    });

    const entry = await awaitRegistryEntry();
    const childPids = entry.childPids ?? [];
    recordAll(childPids);
    expect(childPids.length).toBe(2);

    const watchers = await vi.waitFor(async () => {
      const members: number[] = [];
      for (const childPid of childPids) {
        members.push(...(await groupMembersOf(childPid)).filter((pid) => pid !== childPid));
      }
      expect(members.length).toBeGreaterThanOrEqual(childPids.length);
      return members;
    });
    recordAll(watchers);

    handle().shutdown("graceful");

    const exit = await done;
    expect(Exit.isSuccess(exit)).toBe(true);
    await expectAllDead([...childPids, ...watchers]);
    await expectPortsBindable(ports);
    expect(readRegistry().some((e) => e.pid === process.pid)).toBe(false);
  });

  it("a child that ignores SIGTERM is escalated to SIGKILL by graceful teardown", async () => {
    const tmp = makeTmp();
    process.env.BO_PID_REGISTRY_PATH = join(tmp, "pids.json");
    const ports = await grabPorts();
    const exitCodes: number[] = [];
    const { handle, done } = startSession(
      tmp,
      ports,
      {
        exit: (code) => exitCodes.push(code),
        // Teardown must escalate through handle.kill's own SIGTERM→SIGKILL
        // window (~3s for the ignoring child); keep the session force timer
        // out of the race.
        forceTimeoutMs: 10_000,
      },
      { ignoreTerm: true },
    );
    const entry = await awaitRegistryEntry();
    const childPids = entry.childPids ?? [];
    recordAll(childPids);
    const watchers = await vi.waitFor(async () => {
      const members: number[] = [];
      for (const childPid of childPids) {
        members.push(...(await groupMembersOf(childPid)).filter((pid) => pid !== childPid));
      }
      expect(members.length).toBeGreaterThanOrEqual(childPids.length);
      return members;
    });
    recordAll(watchers);

    handle().shutdown("graceful");

    const exit = await done;
    expect(Exit.isSuccess(exit)).toBe(true);
    await expectAllDead([...childPids, ...watchers]);
    await expectPortsBindable(ports);
    expect(readRegistry().some((e) => e.pid === process.pid)).toBe(false);
  }, 20_000);

  it("a second graceful shutdown escalates straight to force and SIGKILLs the tree", async () => {
    const tmp = makeTmp();
    process.env.BO_PID_REGISTRY_PATH = join(tmp, "pids.json");
    const ports = await grabPorts();
    const exitCodes: number[] = [];
    const { handle, done } = startSession(tmp, ports, {
      exit: (code) => exitCodes.push(code),
    });

    const entry = await awaitRegistryEntry();
    const childPids = entry.childPids ?? [];
    recordAll(childPids);

    handle().shutdown("graceful");
    handle().shutdown("graceful");

    await vi.waitFor(() => {
      expect(exitCodes).toContain(0);
    });
    await expectAllDead(childPids);
    await done;
    expect(readRegistry().some((e) => e.pid === process.pid)).toBe(false);
  }, 20_000);

  it("the orphan watchdog force-exits the real tree when the session is reparented", async () => {
    const tmp = makeTmp();
    process.env.BO_PID_REGISTRY_PATH = join(tmp, "pids.json");
    const ports = await grabPorts();
    const realPpid = process.ppid;
    let fakePpid = realPpid;
    const exitCodes: number[] = [];
    const { done } = startSession(tmp, ports, {
      exit: (code) => exitCodes.push(code),
      ppid: () => fakePpid,
    });

    const entry = await awaitRegistryEntry();
    const childPids = entry.childPids ?? [];
    recordAll(childPids);

    fakePpid = 1;

    await vi.waitFor(() => {
      expect(exitCodes).toContain(0);
    });
    await expectAllDead(childPids);
    await done;
    expect(readRegistry().some((e) => e.pid === process.pid)).toBe(false);
  }, 20_000);

  it("startup adopts a dead session's registry entry and reaps its live orphaned children", async () => {
    const tmp = makeTmp();
    const registryPath = join(tmp, "pids.json");
    process.env.BO_PID_REGISTRY_PATH = registryPath;

    const orphan = spawnSleeper();
    const deadPid = await spawnDeadSessionPid();
    const seed: PidEntry = {
      pid: deadPid,
      configDir: tmp,
      role: "standalone",
      ports: {},
      childPids: [orphan.pid],
      startedAt: Date.now(),
      description: "dead session",
    };
    writeRegistry([seed]);

    const ports = await grabPorts();
    const { handle, done } = startSession(tmp, ports, {
      exit: (code) => exitCodes.push(code),
    });

    await awaitRegistryEntry();

    await vi.waitFor(() => {
      expect(isPidAlive(orphan.pid)).toBe(false);
    });
    expect(readRegistry().some((e) => e.pid === deadPid)).toBe(false);

    handle().shutdown("graceful");
    const exit = await done;
    expect(Exit.isSuccess(exit)).toBe(true);
  }, 20_000);
});
