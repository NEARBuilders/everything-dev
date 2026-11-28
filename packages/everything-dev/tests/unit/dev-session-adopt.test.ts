import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Exit, Layer } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ShellEnvLive } from "../../src/env/project-env";
import { SupervisorLive } from "../../src/services/boot/adapters";
import { DevRenderer } from "../../src/services/dev/render";
import {
  DevGeneratedEnvLive,
  DevRuntimeConfigLive,
  type ServiceDescriptor,
  ServiceDescriptorMapLive,
} from "../../src/services/dev/service-descriptor";
import { type DevSessionHandle, runDevSession } from "../../src/services/dev/session";
import { reapGroup } from "../../src/services/processes/kill";
import type { RuntimeConfig } from "../../src/types";

const fixturePath = fileURLToPath(new URL("../fixtures/fake-plugin-service.mjs", import.meta.url));
// The plugin workspace is materialized at runtime — the sampler reads a BUILT
// dist and dist/ is gitignored, so a committed fixture dist would never
// survive a cold checkout.
const workspaceRoot = mkdtempSync(join(tmpdir(), "dev-adopt-workspace-"));
const pluginWorkspace = workspaceRoot;

const grabPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => resolve(port));
    });
  });

const pidOf = async (port: number): Promise<number> => {
  const res = await fetch(`http://127.0.0.1:${port}/pid`);
  return Number(await res.text());
};

const describeRuntimeConfig = (port: number): RuntimeConfig =>
  ({
    env: "development",
    account: "test.near",
    networkId: "mainnet",
    host: {
      name: "host",
      url: `http://localhost:${port + 1}`,
      entry: "unused",
      source: "local",
      port: port + 1,
    },
    ui: {
      name: "ui",
      url: `http://localhost:${port + 2}`,
      entry: "unused",
      source: "local",
      port: port + 2,
    },
    api: {
      name: "api",
      url: `http://localhost:${port + 3}`,
      entry: "unused",
      source: "local",
      port: port + 3,
    },
    plugins: {},
  }) as unknown as RuntimeConfig;

const reaped: number[] = [];
const record = (pid: number) => {
  if (pid > 1) reaped.push(pid);
};

describe("dev backend adopt — child replacement on a plugin rebuild", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dev-adopt-session-"));
  beforeAll(() => {
    mkdirSync(join(workspaceRoot, "dist"), { recursive: true });
    writeFileSync(join(workspaceRoot, "dist", "remoteEntry.js"), 'console.log("boot generation");');
  });
  let session: DevSessionHandle | null = null;
  let port: number | undefined;

  afterEach(() => {
    for (const pid of reaped.splice(0)) {
      try {
        reapGroup(pid);
      } catch {
        // already gone
      }
    }
  });

  afterAll(() => {
    session?.shutdown("force");
    writeFileSync(
      join(pluginWorkspace, "dist", "remoteEntry.js"),
      'console.log("boot generation");',
    );
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("replaces the plugin child and logs one line per generation move", {
    timeout: 40_000,
  }, async () => {
    port = await grabPort();
    const logs: string[] = [];

    const descriptor: ServiceDescriptor = {
      key: "plugin:votes",
      source: "local",
      url: `http://localhost:${port}`,
      entry: "unused",
      name: "plugin:votes",
      localPath: pluginWorkspace,
      command: process.execPath,
      args: [fixturePath, String(port)],
      port,
      readinessPath: "/health",
      defaultPort: port,
    };
    const runtimeConfig = describeRuntimeConfig(port);

    const program = Effect.scoped(
      runDevSession(
        tempDir,
        { packages: ["plugin:votes"], description: "adopt contract", env: {} },
        (handle) => {
          session = handle;
        },
        {
          exit: () => {},
        },
      ),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          ServiceDescriptorMapLive(new Map([["plugin:votes", descriptor]])),
          DevRuntimeConfigLive(runtimeConfig),
          DevGeneratedEnvLive({}),
          ShellEnvLive({}),
          Layer.succeed(
            DevRenderer,
            DevRenderer.of({
              create: () => ({
                updateProcess: () => {},
                addLog: (source, line) => logs.push(`${source}:${line}`),
                unmount: () => {},
              }),
            }),
          ),
          SupervisorLive({ generatedEnv: {}, shellTier: {}, runtimeConfig }),
        ),
      ),
    );
    const done = Effect.runPromiseExit(program);

    const bootPid = await vi.waitFor(() => pidOf(port), { timeout: 15_000, interval: 100 });
    record(bootPid);

    // The adopt loop must observe the boot generation first — a churn landing
    // before the first sample would be recorded as generation 0.
    await new Promise((resolve) => setTimeout(resolve, 2_500));

    // Churn the plugin's built dist — the dev-adopt trigger. The content
    // changes; the settle machine adopts once the write is stable.
    writeFileSync(
      join(pluginWorkspace, "dist", "remoteEntry.js"),
      'console.log("rebuild generation");',
    );

    await vi.waitFor(
      async () => {
        expect(await pidOf(port)).not.toBe(bootPid);
      },
      { timeout: 25_000, interval: 250 },
    );

    await vi.waitFor(
      () => {
        expect(logs).toContainEqual(
          expect.stringContaining(`${basename(pluginWorkspace)} moved to generation 1`),
        );
      },
      { timeout: 10_000, interval: 100 },
    );

    session?.shutdown("graceful");
    const exit = await done;
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});
