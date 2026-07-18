import { Cause, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  PortAllocationError,
  PortAllocator,
  type PortBudget,
  prepareDevelopmentRuntimeConfig,
} from "../../src/app";
import type { RuntimeConfig } from "../../src/types";

function buildLocalRuntimeConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    env: "development",
    account: "dev.everything.near",
    networkId: "mainnet",
    host: {
      name: "host",
      url: "http://localhost:3000",
      entry: "/mf-manifest.json",
      source: "local",
      localPath: "/tmp/host",
    },
    ui: {
      name: "ui",
      url: "http://localhost:3003",
      entry: "/mf-manifest.json",
      source: "local",
      localPath: "/tmp/ui",
    },
    api: {
      name: "api",
      url: "http://localhost:3001",
      entry: "/mf-manifest.json",
      source: "local",
      localPath: "/tmp/api",
    },
    auth: {
      name: "auth",
      url: "http://localhost:3002",
      entry: "/mf-manifest.json",
      source: "local",
      localPath: "/tmp/auth",
    },
    ...overrides,
  } as RuntimeConfig;
}

function makeTestAllocator(options?: {
  initiallyUsed?: number[];
  busyPorts?: number[];
}): Layer.Layer<PortAllocator> {
  const initiallyUsed = new Set(options?.initiallyUsed ?? []);
  const busyPorts = new Set(options?.busyPorts ?? []);
  return Layer.succeed(PortAllocator, {
    pickAvailable: (preferred, budget) =>
      Effect.gen(function* () {
        const within = (p: number) => !budget || (p >= budget.min && p <= budget.max);
        let port = preferred;
        if (!within(port)) port = budget ? budget.min : port;
        const ceiling = budget ? budget.max + 1 : Number.MAX_SAFE_INTEGER;
        let steps = 0;
        while (true) {
          if (port >= ceiling || steps > 1000) {
            yield* Effect.fail(new PortAllocationError({ preferred, budget }));
          }
          if (!initiallyUsed.has(port) && !busyPorts.has(port)) {
            initiallyUsed.add(port);
            return port;
          }
          port += 1;
          steps += 1;
        }
      }),
  });
}

async function runPrepare(
  runtimeConfig: RuntimeConfig,
  options?: Parameters<typeof prepareDevelopmentRuntimeConfig>[1],
  allocatorOptions?: Parameters<typeof makeTestAllocator>[0],
) {
  return Effect.runPromise(
    prepareDevelopmentRuntimeConfig(runtimeConfig, options).pipe(
      Effect.provide(makeTestAllocator(allocatorOptions)),
    ),
  );
}

describe("prepareDevelopmentRuntimeConfig", () => {
  it("does not clobber remote host url/port (Bug C)", async () => {
    const remoteHostUrl = "https://example.zephyrcloud.app/mf-manifest.json";
    const runtimeConfig = buildLocalRuntimeConfig({
      host: {
        name: "host",
        url: remoteHostUrl,
        entry: remoteHostUrl,
        source: "remote",
        remoteUrl: "https://example.zephyrcloud.app",
      },
    });

    const { runtimeConfig: result } = await runPrepare(runtimeConfig, {
      hostPort: 3100,
    });

    expect(result.host.url).toBe(remoteHostUrl);
    expect(result.host.port).toBeUndefined();
  });

  it("overrides local host url/port with picked localhost value", async () => {
    const runtimeConfig = buildLocalRuntimeConfig();
    const { runtimeConfig: result } = await runPrepare(runtimeConfig, {
      hostPort: 4096,
    });

    expect(result.host.url).toBe("http://localhost:4096");
    expect(result.host.port).toBe(4096);
  });

  it("does not assign a port for remote api service", async () => {
    const remoteApiUrl = "https://api.example.com/mf-manifest.json";
    const runtimeConfig = buildLocalRuntimeConfig({
      api: {
        name: "api",
        url: remoteApiUrl,
        entry: remoteApiUrl,
        source: "remote",
      },
    });

    const { runtimeConfig: result, devPorts } = await runPrepare(runtimeConfig, {
      hostPort: 3000,
    });

    expect(result.api.url).toBe(remoteApiUrl);
    expect(result.api.port).toBeUndefined();
    expect(devPorts.api).toBeUndefined();
  });

  it("respects explicit apiPort flag for local api", async () => {
    const runtimeConfig = buildLocalRuntimeConfig();
    const { runtimeConfig: result, devPorts } = await runPrepare(runtimeConfig, {
      hostPort: 3000,
      apiPort: 4101,
    });

    expect(result.api.url).toBe("http://localhost:4101");
    expect(result.api.port).toBe(4101);
    expect(devPorts.api).toBe(4101);
  });

  it("portBudget clamps out-of-range preferred to budget.min", async () => {
    const runtimeConfig = buildLocalRuntimeConfig();
    const { runtimeConfig: result } = await runPrepare(runtimeConfig, {
      hostPort: 4000,
      portBudget: { min: 5000, max: 5010 } as PortBudget,
    });

    expect(result.host.port).toBe(5000);
  });

  it("portBudget succeeds when preferred port is within budget", async () => {
    const runtimeConfig = buildLocalRuntimeConfig();
    const { runtimeConfig: result, devPorts } = await runPrepare(runtimeConfig, {
      hostPort: 5000,
      apiPort: 5001,
      uiPort: 5002,
      authPort: 5003,
      portBudget: { min: 5000, max: 5100 } as PortBudget,
    });

    expect(result.host.port).toBe(5000);
    expect(result.api.port).toBe(5001);
    expect(result.ui.port).toBe(5002);
    expect(result.auth?.port).toBe(5003);
    expect(devPorts).toEqual({
      host: 5000,
      api: 5001,
      ui: 5002,
      auth: 5003,
      pluginPortStart: undefined,
    });
  });

  it("seeds usedPorts from claimedPorts — skips ports already claimed by other sessions", async () => {
    const runtimeConfig = buildLocalRuntimeConfig();
    const { runtimeConfig: result } = await runPrepare(
      runtimeConfig,
      { hostPort: 3000 },
      { initiallyUsed: [3000] },
    );

    expect(result.host.port).toBe(3001);
  });

  it("returns devPorts with undefined for remote services (Bug A)", async () => {
    const runtimeConfig = buildLocalRuntimeConfig({
      api: {
        name: "api",
        url: "https://api.example.com/mf-manifest.json",
        entry: "https://api.example.com/mf-manifest.json",
        source: "remote",
      },
      auth: {
        name: "auth",
        url: "https://auth.example.com/mf-manifest.json",
        entry: "https://auth.example.com/mf-manifest.json",
        source: "remote",
      },
    });

    const { devPorts } = await runPrepare(runtimeConfig, { hostPort: 3000 });

    expect(devPorts.host).toBe(3000);
    expect(devPorts.api).toBeUndefined();
    expect(devPorts.auth).toBeUndefined();
  });

  it("fails with PortAllocationError when budget is exhausted", async () => {
    const runtimeConfig = buildLocalRuntimeConfig();
    const budget: PortBudget = { min: 5000, max: 5001 };
    const exit = await Effect.runPromiseExit(
      prepareDevelopmentRuntimeConfig(runtimeConfig, {
        hostPort: 5000,
        apiPort: 5000,
        uiPort: 5000,
        authPort: 5000,
        portBudget: budget,
      }).pipe(Effect.provide(makeTestAllocator({ busyPorts: [5000, 5001] }))),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.pretty(exit.cause)).toContain("PortAllocationError");
    }
  });
});
