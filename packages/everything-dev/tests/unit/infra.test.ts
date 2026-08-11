import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDatabaseConfigs,
  ensureEnvFile,
  loadPortState,
  loadProjectEnv,
  savePortState,
  syncGeneratedInfra,
  writeGeneratedInfra,
} from "../../src/cli/infra";
import type { RuntimeConfig } from "../../src/types";

function buildRuntimeConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    env: "development",
    account: "dev.everything.near",
    networkId: "mainnet",
    host: { name: "host", url: "http://localhost:3000", entry: "/mf-manifest.json" },
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
        secrets: ["EXAMPLE_DATABASE_URL", "PAYMENT_API_URL"],
      },
    },
    ...overrides,
  } as RuntimeConfig;
}

describe("generated infra", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes env example and docker compose from runtime secrets", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-infra-"));
    tempDirs.push(dir);

    const secrets = writeGeneratedInfra(dir, buildRuntimeConfig());
    const envExample = readFileSync(join(dir, ".env.example"), "utf-8");
    const dockerCompose = readFileSync(join(dir, "docker-compose.yml"), "utf-8");

    expect(secrets).toContain("API_DATABASE_URL");
    expect(secrets).toContain("AUTH_DATABASE_URL");
    expect(secrets).toContain("EXAMPLE_DATABASE_URL");
    expect(secrets).toContain("PAYMENT_API_URL");

    expect(envExample).toContain("# app.host");
    expect(envExample).toContain("CORS_ORIGIN=http://localhost:3000");
    expect(envExample).toContain("# app.api");
    expect(envExample).toContain(
      "API_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5432/api_db",
    );
    expect(envExample).toContain("# app.auth");
    expect(envExample).toContain(
      "AUTH_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5433/auth_db",
    );
    expect(envExample).toContain("BETTER_AUTH_SECRET=");
    expect(envExample).toContain("# plugins.example");
    expect(envExample).toContain(
      "EXAMPLE_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5434/example_db",
    );
    expect(envExample).toContain("PAYMENT_API_URL=");

    expect(dockerCompose).toContain("name: dev.everything.near");
    expect(dockerCompose).toContain("postgres-api:");
    expect(dockerCompose).toContain("container_name: dev.everything.near-postgres-api");
    expect(dockerCompose).toContain("POSTGRES_DB: api_db");
    expect(dockerCompose).toContain('"5432:5432"');
    expect(dockerCompose).toContain("postgres-auth:");
    expect(dockerCompose).toContain("container_name: dev.everything.near-postgres-auth");
    expect(dockerCompose).toContain("POSTGRES_DB: auth_db");
    expect(dockerCompose).toContain('"5433:5432"');
    expect(dockerCompose).toContain("postgres-example:");
    expect(dockerCompose).toContain("container_name: dev.everything.near-postgres-example");
    expect(dockerCompose).toContain("POSTGRES_DB: example_db");
    expect(dockerCompose).toContain('"5434:5432"');
    expect(dockerCompose).toContain("name: dev_everything_near_postgres_api_data");
    expect(dockerCompose).toContain("name: dev_everything_near_postgres_auth_data");
    expect(dockerCompose).toContain("name: dev_everything_near_postgres_example_data");
    expect(dockerCompose).not.toContain("payment");
  });

  it("generates Redis docker compose and env for _REDIS_URL secrets", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-redis-"));
    tempDirs.push(dir);

    const secrets = writeGeneratedInfra(
      dir,
      buildRuntimeConfig({
        plugins: {
          cache: {
            name: "cache",
            url: "http://localhost:3020",
            entry: "/mf-manifest.json",
            source: "local" as const,
            secrets: ["CACHE_REDIS_URL"],
          },
        },
      }),
    );
    const envExample = readFileSync(join(dir, ".env.example"), "utf-8");
    const dockerCompose = readFileSync(join(dir, "docker-compose.yml"), "utf-8");

    expect(secrets).toContain("CACHE_REDIS_URL");

    expect(envExample).toContain("# plugins.cache");
    expect(envExample).toContain("CACHE_REDIS_URL=redis://localhost:6379");

    expect(dockerCompose).toContain("x-redis-common: &redis-common");
    expect(dockerCompose).toContain("image: redis:7-alpine");
    expect(dockerCompose).toContain("command: redis-server --appendonly yes");
    expect(dockerCompose).toContain('test: ["CMD", "redis-cli", "ping"]');
    expect(dockerCompose).toContain("redis-cache:");
    expect(dockerCompose).toContain("container_name: dev.everything.near-redis-cache");
    expect(dockerCompose).toContain('"6379:6379"');
    expect(dockerCompose).toContain("dev_everything_near_redis_cache_data:/data");
    expect(dockerCompose).toContain("name: dev_everything_near_redis_cache_data");
  });

  it("generates Redis alongside Postgres in the same compose", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-mixed-"));
    tempDirs.push(dir);

    writeGeneratedInfra(
      dir,
      buildRuntimeConfig({
        plugins: {
          cache: {
            name: "cache",
            url: "http://localhost:3020",
            entry: "/mf-manifest.json",
            source: "local" as const,
            secrets: ["CACHE_REDIS_URL"],
          },
        },
      }),
    );
    const dockerCompose = readFileSync(join(dir, "docker-compose.yml"), "utf-8");

    expect(dockerCompose).toContain("x-pg-common:");
    expect(dockerCompose).toContain("x-redis-common:");
    expect(dockerCompose).toContain("postgres-api:");
    expect(dockerCompose).toContain("redis-cache:");
  });

  it("persists ports in infra-state.json and keeps existing ports stable", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-state-"));
    tempDirs.push(dir);

    syncGeneratedInfra(
      dir,
      buildRuntimeConfig({
        plugins: {
          example: {
            name: "example",
            url: "http://localhost:3010",
            entry: "/mf-manifest.json",
            source: "local" as const,
            secrets: ["EXAMPLE_DATABASE_URL"],
          },
        },
      }),
    );

    const statePath = join(dir, ".bos", "infra-state.json");
    expect(existsSync(statePath)).toBe(true);

    const firstState = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(firstState.postgresPorts.example).toBe(5434);

    const firstEnv = readFileSync(join(dir, ".env.example"), "utf-8");
    expect(firstEnv).toContain(
      "EXAMPLE_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5434/example_db",
    );

    syncGeneratedInfra(
      dir,
      buildRuntimeConfig({
        plugins: {
          example: {
            name: "example",
            url: "http://localhost:3010",
            entry: "/mf-manifest.json",
            source: "local" as const,
            secrets: ["EXAMPLE_DATABASE_URL"],
          },
          registry: {
            name: "registry",
            url: "http://localhost:3021",
            entry: "/mf-manifest.json",
            source: "local" as const,
            secrets: ["REGISTRY_DATABASE_URL"],
          },
        },
      }),
    );

    const secondState = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(secondState.postgresPorts.example).toBe(5434);
    expect(secondState.postgresPorts.registry).toBe(5435);

    const secondEnv = readFileSync(join(dir, ".env.example"), "utf-8");
    expect(secondEnv).toContain(
      "EXAMPLE_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5434/example_db",
    );
    expect(secondEnv).toContain(
      "REGISTRY_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5435/registry_db",
    );

    const dockerCompose = readFileSync(join(dir, "docker-compose.yml"), "utf-8");
    expect(dockerCompose).toContain('"5434:5432"');
    expect(dockerCompose).toContain('"5435:5432"');
  });

  it("assigns ports by alphabetical slug order for deterministic fallback", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-order-"));
    tempDirs.push(dir);

    mkdirSync(join(dir, ".bos"), { recursive: true });

    writeGeneratedInfra(
      dir,
      buildRuntimeConfig({
        plugins: {
          zebra: {
            name: "zebra",
            url: "http://localhost:3030",
            entry: "/mf-manifest.json",
            source: "local" as const,
            secrets: ["ZEBRA_DATABASE_URL"],
          },
          alpha: {
            name: "alpha",
            url: "http://localhost:3040",
            entry: "/mf-manifest.json",
            source: "local" as const,
            secrets: ["ALPHA_DATABASE_URL"],
          },
          beta: {
            name: "beta",
            url: "http://localhost:3050",
            entry: "/mf-manifest.json",
            source: "local" as const,
            secrets: ["BETA_DATABASE_URL"],
          },
        },
      }),
    );

    const state = JSON.parse(readFileSync(join(dir, ".bos", "infra-state.json"), "utf-8"));

    // Slugs sorted alphabetically: alpha, beta, zebra
    expect(state.postgresPorts.alpha).toBe(5434);
    expect(state.postgresPorts.beta).toBe(5435);
    expect(state.postgresPorts.zebra).toBe(5436);
  });

  it("detects stale .env values when ports change", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-stale-"));
    tempDirs.push(dir);

    syncGeneratedInfra(
      dir,
      buildRuntimeConfig({
        plugins: {
          example: {
            name: "example",
            url: "http://localhost:3010",
            entry: "/mf-manifest.json",
            source: "local" as const,
            secrets: ["EXAMPLE_DATABASE_URL"],
          },
        },
      }),
    );

    writeFileSync(
      join(dir, ".env"),
      "EXAMPLE_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:9999/example_db\n",
    );

    const result = syncGeneratedInfra(
      dir,
      buildRuntimeConfig({
        plugins: {
          example: {
            name: "example",
            url: "http://localhost:3010",
            entry: "/mf-manifest.json",
            source: "local" as const,
            secrets: ["EXAMPLE_DATABASE_URL"],
          },
        },
      }),
    );

    expect(result.staleEnvWarnings.length).toBe(1);
    expect(result.staleEnvWarnings[0]).toContain("EXAMPLE_DATABASE_URL");
    expect(result.staleEnvWarnings[0]).toContain("9999");
    expect(result.staleEnvWarnings[0]).toContain("5434");
  });

  it("reports no stale warnings when .env matches or does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-fresh-"));
    tempDirs.push(dir);

    const result = syncGeneratedInfra(dir, buildRuntimeConfig());
    expect(result.staleEnvWarnings.length).toBe(0);

    writeFileSync(
      join(dir, ".env"),
      "API_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5432/api_db\n",
    );

    const second = syncGeneratedInfra(dir, buildRuntimeConfig());
    expect(second.staleEnvWarnings.length).toBe(0);
  });

  it("creates .env with generated auth secret and preserves other defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-env-"));
    tempDirs.push(dir);

    writeGeneratedInfra(dir, buildRuntimeConfig());
    ensureEnvFile(dir);

    const env = readFileSync(join(dir, ".env"), "utf-8");

    expect(env).toContain(
      "API_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5432/api_db",
    );
    expect(env).toContain(
      "AUTH_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5433/auth_db",
    );
    expect(env).toContain(
      "EXAMPLE_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5434/example_db",
    );
    expect(env).toContain("PAYMENT_API_URL=");
    expect(env).toContain("CORS_ORIGIN=http://localhost:3000");
    expect(env).toMatch(/BETTER_AUTH_SECRET=.+/);
  });

  it("skips rewriting generated infra when nothing changed", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-sync-env-"));
    tempDirs.push(dir);

    const first = syncGeneratedInfra(dir, buildRuntimeConfig());
    const second = syncGeneratedInfra(dir, buildRuntimeConfig());

    expect(first.envExampleChanged).toBe(true);
    expect(first.dockerComposeChanged).toBe(true);
    expect(second.envExampleChanged).toBe(false);
    expect(second.dockerComposeChanged).toBe(false);
  });

  it("loads .env into the bos process without overriding exported values", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-load-env-"));
    tempDirs.push(dir);

    const originalApi = process.env.API_DATABASE_URL;
    const originalAuth = process.env.AUTH_DATABASE_URL;
    const originalSecret = process.env.BETTER_AUTH_SECRET;

    try {
      process.env.API_DATABASE_URL = "postgres://already-exported";
      delete process.env.AUTH_DATABASE_URL;
      delete process.env.BETTER_AUTH_SECRET;

      writeFileSync(
        join(dir, ".env"),
        [
          "API_DATABASE_URL=postgres://from-dotenv",
          "AUTH_DATABASE_URL=postgres://auth-from-dotenv",
          "BETTER_AUTH_SECRET=test-secret",
        ].join("\n"),
      );

      loadProjectEnv(dir);

      expect(process.env.API_DATABASE_URL).toBe("postgres://already-exported");
      expect(process.env.AUTH_DATABASE_URL).toBe("postgres://auth-from-dotenv");
      expect(process.env.BETTER_AUTH_SECRET).toBe("test-secret");
    } finally {
      if (originalApi === undefined) delete process.env.API_DATABASE_URL;
      else process.env.API_DATABASE_URL = originalApi;

      if (originalAuth === undefined) delete process.env.AUTH_DATABASE_URL;
      else process.env.AUTH_DATABASE_URL = originalAuth;

      if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = originalSecret;
    }
  });

  it("derives CORS_ORIGIN from runtimeConfig.host.port in development", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-cors-port-"));
    tempDirs.push(dir);

    writeGeneratedInfra(
      dir,
      buildRuntimeConfig({
        host: {
          name: "host",
          url: "http://localhost:3210",
          entry: "/mf-manifest.json",
          port: 3210,
        },
      }),
    );
    const envExample = readFileSync(join(dir, ".env.example"), "utf-8");
    expect(envExample).toContain("CORS_ORIGIN=http://localhost:3210");
  });

  it("leaves CORS_ORIGIN at the URL-derived port when host.port is unset", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-cors-url-"));
    tempDirs.push(dir);

    writeGeneratedInfra(
      dir,
      buildRuntimeConfig({
        host: { name: "host", url: "http://localhost:3055", entry: "/mf-manifest.json" },
      }),
    );
    const envExample = readFileSync(join(dir, ".env.example"), "utf-8");
    expect(envExample).toContain("CORS_ORIGIN=http://localhost:3055");
  });

  it("skips dev CORS_ORIGIN override in production env", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-cors-prod-"));
    tempDirs.push(dir);

    writeGeneratedInfra(
      dir,
      buildRuntimeConfig({
        env: "production",
        host: {
          name: "host",
          url: "http://localhost:3210",
          entry: "/mf-manifest.json",
          port: 3210,
        },
      }),
    );
    const envExample = readFileSync(join(dir, ".env.example"), "utf-8");
    expect(envExample).toContain("CORS_ORIGIN=http://localhost:3000");
  });

  it("persists and reloads devPorts via loadPortState/savePortState", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-devports-"));
    tempDirs.push(dir);

    savePortState(dir, {
      postgresPorts: {},
      redisPorts: {},
      devPorts: { host: 3100, api: 3101, ui: 3103, pluginPortStart: 3110 },
    });
    const loaded = loadPortState(dir);
    expect(loaded.devPorts?.host).toBe(3100);
    expect(loaded.devPorts?.api).toBe(3101);
    expect(loaded.devPorts?.pluginPortStart).toBe(3110);
  });

  it("devPorts round-trips undefined slots for remote services (Bug A)", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-devports-remote-"));
    tempDirs.push(dir);

    savePortState(dir, {
      postgresPorts: {},
      redisPorts: {},
      devPorts: {
        host: 3100,
        api: undefined,
        ui: 3103,
        auth: undefined,
        pluginPortStart: undefined,
      },
    });
    const loaded = loadPortState(dir);
    expect(loaded.devPorts?.host).toBe(3100);
    expect(loaded.devPorts?.api).toBeUndefined();
    expect(loaded.devPorts?.ui).toBe(3103);
    expect(loaded.devPorts?.auth).toBeUndefined();
    expect(loaded.devPorts?.pluginPortStart).toBeUndefined();
  });

  it("loadPortState tolerates missing devPorts on existing state files", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-devports-legacy-"));
    tempDirs.push(dir);

    mkdirSync(join(dir, ".bos"), { recursive: true });
    writeFileSync(
      join(dir, ".bos", "infra-state.json"),
      JSON.stringify({ postgresPorts: { api: 5432 }, redisPorts: {} }),
    );
    const loaded = loadPortState(dir);
    expect(loaded.devPorts).toBeUndefined();
    expect(loaded.postgresPorts.api).toBe(5432);
  });
});

describe("buildDatabaseConfigs with infraConfig", () => {
  it("returns shared DATABASE_URL when infraConfig.database present", () => {
    const configs = buildDatabaseConfigs(
      ["API_DATABASE_URL", "AUTH_DATABASE_URL"],
      new Map(),
      {},
      { database: { type: "postgres" } },
    );
    expect(configs).toHaveLength(1);
    expect(configs[0].secret).toBe("DATABASE_URL");
    expect(configs[0].slug).toBe("shared");
    expect(configs[0].port).toBe(5432);
    expect(configs[0].url).toContain("shared_db");
  });

  it("falls back to convention scanning when infraConfig.database is absent", () => {
    const originMap = new Map<string, string>();
    originMap.set("API_DATABASE_URL", "everything.near");
    originMap.set("AUTH_DATABASE_URL", "everything.near");
    const configs = buildDatabaseConfigs(["API_DATABASE_URL", "AUTH_DATABASE_URL"], originMap, {});
    expect(configs.length).toBeGreaterThan(1);
    expect(configs.map((c) => c.secret)).toContain("API_DATABASE_URL");
    expect(configs.map((c) => c.secret)).toContain("AUTH_DATABASE_URL");
  });

  it("uses existing port when infraConfig.database present", () => {
    const configs = buildDatabaseConfigs(
      ["API_DATABASE_URL"],
      new Map(),
      { shared: 5433 },
      { database: { type: "postgres" } },
    );
    expect(configs[0].port).toBe(5433);
  });

  it("returns per-plugin configs from record variant", () => {
    const originMap = new Map<string, string>();
    originMap.set("AUTH_DATABASE_URL", "test.near");
    originMap.set("API_DATABASE_URL", "test.near");
    const configs = buildDatabaseConfigs(
      ["API_DATABASE_URL", "EXAMPLE_DATABASE_URL", "AUTH_DATABASE_URL"],
      originMap,
      {},
      {
        database: {
          auth: { type: "postgres" },
          api: { type: "postgres" },
        },
      },
    );
    expect(configs).toHaveLength(2);
    const secrets = configs.map((c) => c.secret).sort();
    expect(secrets).toEqual(["API_DATABASE_URL", "AUTH_DATABASE_URL"]);
  });

  it("skips per-plugin entries without matching secrets", () => {
    const configs = buildDatabaseConfigs(
      ["API_DATABASE_URL"],
      new Map(),
      {},
      {
        database: {
          auth: { type: "postgres" },
          nonexistent: { type: "postgres" },
        },
      },
    );
    expect(configs).toHaveLength(0);
  });

  it("assigns 5432 and 5433 for API and AUTH ports in per-plugin record", () => {
    const originMap = new Map<string, string>();
    originMap.set("API_DATABASE_URL", "test.near");
    originMap.set("AUTH_DATABASE_URL", "test.near");
    const configs = buildDatabaseConfigs(
      ["API_DATABASE_URL", "AUTH_DATABASE_URL"],
      originMap,
      {},
      {
        database: {
          api: { type: "postgres" },
          auth: { type: "postgres" },
        },
      },
    );
    const apiConfig = configs.find((c) => c.secret === "API_DATABASE_URL");
    const authConfig = configs.find((c) => c.secret === "AUTH_DATABASE_URL");
    expect(apiConfig?.port).toBe(5432);
    expect(authConfig?.port).toBe(5433);
  });

  it("uses custom secret name from per-plugin InfraDatabase.secret", () => {
    const originMap = new Map<string, string>();
    originMap.set("CUSTOM_DB_URL", "test.near");
    const configs = buildDatabaseConfigs(
      ["CUSTOM_DB_URL", "AUTH_DATABASE_URL"],
      originMap,
      {},
      {
        database: {
          auth: { type: "postgres", secret: "CUSTOM_DB_URL" },
        },
      },
    );
    expect(configs).toHaveLength(1);
    expect(configs[0].secret).toBe("CUSTOM_DB_URL");
  });

  it("falls back to conventional secret when InfraDatabase.secret is absent", () => {
    const configs = buildDatabaseConfigs(
      ["AUTH_DATABASE_URL"],
      new Map(),
      {},
      {
        database: {
          auth: { type: "postgres" },
        },
      },
    );
    expect(configs).toHaveLength(1);
    expect(configs[0].secret).toBe("AUTH_DATABASE_URL");
  });
});
