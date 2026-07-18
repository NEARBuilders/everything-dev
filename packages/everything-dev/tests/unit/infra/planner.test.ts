import { describe, expect, it } from "vitest";
import {
  buildComposeModel,
  buildEnvGenerated,
  buildLaunchSpec,
  buildServiceDescriptors,
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
    postgres: {},
    redis: {},
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

describe("buildComposeModel", () => {
  it("returns databases and redis arrays", () => {
    const model = buildComposeModel(
      [
        {
          secret: "API_DATABASE_URL",
          slug: "api",
          port: 5432,
          dbName: "api",
          containerName: "api-postgres",
          volumeName: "api-pgdata",
          url: "postgres://user:pass@localhost:5432/api",
        },
      ],
      [],
    );
    expect(model.databases).toHaveLength(1);
    expect(model.redis).toHaveLength(0);
    expect(model.databases[0].port).toBe(5432);
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
          containerName: "api-postgres",
          volumeName: "api-pgdata",
          url: "postgres://u:p@localhost:5432/api",
        },
      ],
      [
        {
          secret: "REDIS_URL",
          slug: "cache",
          port: 6379,
          containerName: "cache-redis",
          volumeName: "cache-redisdata",
          url: "redis://localhost:6379/0",
        },
      ],
    );
    expect(env.CORS_ORIGIN).toBe("http://localhost:8080");
    expect(env.API_DATABASE_URL).toBe("postgres://u:p@localhost:5432/api");
    expect(env.REDIS_URL).toBe("redis://localhost:6379/0");
  });
});
