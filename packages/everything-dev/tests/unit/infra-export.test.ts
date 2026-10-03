import { describe, expect, it } from "vitest";
import { buildCiInfraPlan } from "../../src/cli/infra";
import type { RuntimeConfig, RuntimePluginConfig } from "../../src/types";

function buildRuntimeConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    env: "development",
    account: "dev.everything.near",
    networkId: "mainnet",
    domain: "dev.everything.dev",
    host: {
      name: "host",
      url: "http://localhost:4100",
      entry: "/mf-manifest.json",
      port: 4100,
    },
    ui: { name: "ui", url: "http://localhost:3003", entry: "/mf-manifest.json" },
    api: {
      name: "api",
      url: "http://localhost:3001",
      entry: "/mf-manifest.json",
      secrets: ["API_DATABASE_URL"],
    },
    auth: {
      name: "auth",
      url: "http://localhost:3002",
      entry: "/mf-manifest.json",
      secrets: ["AUTH_DATABASE_URL", "BETTER_AUTH_SECRET", "CORS_ORIGIN"],
    },
    plugins: {
      example: {
        name: "example",
        url: "http://localhost:3010",
        entry: "/mf-manifest.json",
        source: "local" as const,
        secrets: ["EXAMPLE_DATABASE_URL"],
      } as RuntimePluginConfig,
    },
    ...overrides,
  } as RuntimeConfig;
}

describe("buildCiInfraPlan", () => {
  it("emits env vars and shared services for api, auth, and plugin secrets", () => {
    const runtime = {
      ...buildRuntimeConfig(),
      env: "production" as const,
    };
    const plan = buildCiInfraPlan(runtime);

    expect(plan.env.API_DATABASE_URL).toBe(
      "postgres://everythingdev:everythingdev@localhost:5432/api_db",
    );
    expect(plan.env.AUTH_DATABASE_URL).toBe(
      "postgres://everythingdev:everythingdev@localhost:5433/auth_db",
    );
    expect(plan.env.EXAMPLE_DATABASE_URL).toBe(
      "postgres://everythingdev:everythingdev@localhost:5432/api_db",
    );
    expect(plan.env.BETTER_AUTH_SECRET).toBe("");
    expect(plan.env.CORS_ORIGIN).toBe("http://127.0.0.1:4100");

    expect(plan.services).toHaveLength(2);
    const serviceKeys = plan.services.map((s) => s.key);
    expect(serviceKeys).toContain("api");
    expect(serviceKeys).toContain("auth");
    expect(serviceKeys).not.toContain("example");

    const apiService = plan.services.find((s) => s.key === "api");
    expect(apiService?.image).toBe("postgres:17-alpine");
    expect(apiService?.ports).toEqual(["5432:5432"]);
    expect(apiService?.database).toEqual({
      user: "everythingdev",
      password: "everythingdev",
      name: "api_db",
    });
  });

  it("honors hostPortOverride and BOS_CI_HOST_PORT env fallback", () => {
    const previous = process.env.BOS_CI_HOST_PORT;
    try {
      process.env.BOS_CI_HOST_PORT = "5173";
      const plan = buildCiInfraPlan(buildRuntimeConfig());
      expect(plan.env.CORS_ORIGIN).toBe("http://127.0.0.1:5173");

      const override = buildCiInfraPlan(buildRuntimeConfig(), { hostPortOverride: 8080 });
      expect(override.env.CORS_ORIGIN).toBe("http://127.0.0.1:8080");
    } finally {
      if (previous === undefined) delete process.env.BOS_CI_HOST_PORT;
      else process.env.BOS_CI_HOST_PORT = previous;
    }
  });

  it("emits stable conventional ports across calls", () => {
    const cfg = buildRuntimeConfig();
    const first = buildCiInfraPlan(cfg);
    const second = buildCiInfraPlan(cfg);

    const firstApi = first.services.find((s) => s.key === "api");
    const secondApi = second.services.find((s) => s.key === "api");
    expect(firstApi?.ports).toEqual(secondApi?.ports);
  });
});
