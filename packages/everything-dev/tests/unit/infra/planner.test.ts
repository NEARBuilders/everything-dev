import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PortAllocatorLive } from "../../../src/app";
import {
  buildEnvGenerated,
  buildLaunchSpec,
  buildServiceDescriptors,
  planInfra,
  workspaceKey,
} from "../../../src/infra/planner";
import type { ResolvedPorts } from "../../../src/infra/types";
import type { RuntimeConfig } from "../../src/types";

function stubRuntimeConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
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

function stubResolvedPorts(overrides?: Partial<ResolvedPorts>): ResolvedPorts {
  return {
    host: 3000,
    api: 3001,
    auth: 3002,
    ui: 3003,
    uiSsr: 3004,
    plugins: {},
    ...overrides,
  };
}

describe("workspaceKey", () => {
  it("returns a deterministic 12-char hash", () => {
    const key1 = workspaceKey("/tmp/project-a");
    const key2 = workspaceKey("/tmp/project-a");
    const key3 = workspaceKey("/tmp/project-b");
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key1).toHaveLength(12);
  });
});

describe("buildServiceDescriptors", () => {
  it("creates a descriptor for each service with correct ports", () => {
    const rc = stubRuntimeConfig();
    const ports = stubResolvedPorts({ host: 3100, api: 3101 });
    const descs = buildServiceDescriptors(rc, ports);
    const host = descs.find((d) => d.key === "host");
    const api = descs.find((d) => d.key === "api");
    expect(host?.port).toBe(3100);
    expect(host?.url).toBe("http://localhost:3100");
    expect(api?.port).toBe(3101);
    expect(api?.url).toBe("http://localhost:3101");
  });

  it("uses remote URL for remote services", () => {
    const rc = stubRuntimeConfig({
      api: {
        name: "api",
        url: "https://api.example.com/mf-manifest.json",
        entry: "https://api.example.com/mf-manifest.json",
        source: "remote",
      },
    });
    const ports = stubResolvedPorts({ host: 3100 });
    const descs = buildServiceDescriptors(rc, ports);
    const api = descs.find((d) => d.key === "api");
    expect(api?.url).toBe("https://api.example.com/mf-manifest.json");
    expect(api?.port).toBeUndefined();
  });

  it("skips a local plugins.auth mirror (the auth slot owns the backend)", () => {
    const rc = stubRuntimeConfig({
      plugins: {
        auth: {
          name: "auth",
          url: "",
          entry: "",
          source: "local",
          localPath: "/tmp/auth",
          ui: {
            name: "auth-ui",
            url: "http://localhost:3011",
            entry: "",
            source: "local",
            localPath: "/tmp/auth-ui",
            port: 3011,
          },
        },
      },
    } as Partial<RuntimeConfig>);
    const ports = stubResolvedPorts({
      plugins: { auth: { api: 3010, ui: 3011 } },
    });
    const descs = buildServiceDescriptors(rc, ports);
    expect(descs.find((d) => d.key === "plugin:auth")).toBeUndefined();
    expect(descs.find((d) => d.key === "plugin-ui:auth")?.port).toBe(3011);
  });

  it("skips a remote plugins.auth mirror", () => {
    const rc = stubRuntimeConfig({
      auth: {
        name: "auth",
        url: "https://auth.example.com",
        entry: "",
        source: "remote",
      },
      plugins: {
        auth: {
          name: "auth",
          url: "https://auth.example.com",
          entry: "",
          source: "remote",
        },
      },
    } as Partial<RuntimeConfig>);
    const ports = stubResolvedPorts();
    const descs = buildServiceDescriptors(rc, ports);
    expect(descs.find((d) => d.key === "plugin:auth")).toBeUndefined();
  });

  it("keeps plugins.auth as its own descriptor when it is not a mirror", () => {
    const rc = stubRuntimeConfig({
      plugins: {
        auth: {
          name: "auth",
          url: "",
          entry: "",
          source: "local",
          localPath: "/tmp/other-auth",
        },
      },
    } as Partial<RuntimeConfig>);
    const ports = stubResolvedPorts({
      plugins: { auth: { api: 3010, ui: undefined } },
    });
    const descs = buildServiceDescriptors(rc, ports);
    expect(descs.find((d) => d.key === "plugin:auth")?.port).toBe(3010);
  });
});

describe("buildLaunchSpec", () => {
  it("includes CORS_ORIGIN from host port", () => {
    const rc = stubRuntimeConfig();
    const ports = stubResolvedPorts({ host: 4096 });
    const spec = buildLaunchSpec(rc, ports);
    expect(spec.corsOrigin).toBe("http://localhost:4096");
    expect(spec.port).toBe(4096);
    expect(spec.env.PORT).toBe("4096");
  });
});

describe("buildEnvGenerated", () => {
  it("populates CORS_ORIGIN and DB URLs", () => {
    const env = buildEnvGenerated(
      stubResolvedPorts({ host: 8080 }),
      [
        {
          secret: "API_DATABASE_URL",
          slug: "api",
          port: 5432,
          dbName: "api",
          url: "postgres://u:p@localhost:5432/api",
        },
      ],
      [
        {
          secret: "REDIS_URL",
          slug: "cache",
          port: 6379,
          url: "redis://localhost:6379/0",
        },
      ],
    );
    expect(env.CORS_ORIGIN).toBe("http://localhost:8080");
    expect(env.API_DATABASE_URL).toBe("postgres://u:p@localhost:5432/api");
    expect(env.REDIS_URL).toBe("redis://localhost:6379/0");
  });
});

describe("planInfra", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "plan-infra-"));
    process.env.BO_PID_REGISTRY_PATH = join(tempDir, "pids.json");
    process.env.BOS_NO_PERSIST_PORTS = "1";
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("allocates the auth mirror's ui port and patches its runtime ui url", async () => {
    const bosConfig = stubRuntimeConfig({
      auth: {
        name: "auth",
        url: "",
        entry: "",
        source: "local",
        localPath: "/tmp/auth",
      },
      plugins: {
        auth: {
          name: "auth",
          url: "",
          entry: "",
          source: "local",
          localPath: "/tmp/auth",
          ui: {
            name: "auth-ui",
            url: "",
            entry: "",
            source: "local",
            localPath: "/tmp/auth-ui",
          },
        },
        template: {
          name: "template",
          url: "",
          entry: "",
          source: "local",
          localPath: "/tmp/template",
        },
      },
    } as Partial<RuntimeConfig>);

    const plan = await Effect.runPromise(
      planInfra({
        configDir: tempDir,
        bosConfig,
        cli: {
          port: 25300,
          apiPort: 25301,
          authPort: 25302,
          uiPort: 25303,
          pluginPortStart: 25310,
        },
      }).pipe(Effect.provide(Layer.mergeAll(PortAllocatorLive))),
    );

    expect(plan.resolvedPorts.plugins.auth).toEqual({ api: undefined, ui: 25310 });
    expect(plan.resolvedPorts.plugins.template).toEqual({ api: 25311, ui: undefined });

    const mirror = plan.runtimeConfig.plugins?.auth;
    expect(mirror?.ui?.port).toBe(25310);
    expect(mirror?.ui?.url).toBe("http://localhost:25310");

    const descriptorKeys = [...plan.serviceDescriptors.keys()];
    expect(descriptorKeys).not.toContain("plugin:auth");
    expect(plan.serviceDescriptors.get("plugin-ui:auth")?.port).toBe(25310);

    expect(plan.claims[0]?.ports["plugin-ui:auth"]).toBe(25310);
    expect(plan.claims[0]?.ports["plugin:auth"]).toBeUndefined();
  });
});
