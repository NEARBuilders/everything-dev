import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { loadPortState, savePortState } from "../../src/cli/infra";
import { makeProjectEnv } from "../../src/env/project-env";
import { InfraMaterializer, InfraMaterializerLive } from "../../src/infra/materializer";
import type { RuntimeConfig } from "../../src/types";

const projectEnv = makeProjectEnv();

async function materialize(configDir: string, runtimeConfig: RuntimeConfig): Promise<void> {
  await Effect.runPromise(
    Effect.gen(function* () {
      const m = yield* InfraMaterializer;
      yield* m.materializeTemplate(configDir, runtimeConfig);
      yield* m.materializeTestInfra(configDir, runtimeConfig);
    }).pipe(Effect.provide(InfraMaterializerLive)),
  );
}

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

describe("generated env templates", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes env example with conventional database URLs from runtime secrets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-infra-"));
    tempDirs.push(dir);

    await materialize(dir, buildRuntimeConfig());
    const envExample = readFileSync(join(dir, ".env.example"), "utf-8");

    expect(envExample).toContain("API_DATABASE_URL");
    expect(envExample).toContain("AUTH_DATABASE_URL");
    expect(envExample).toContain("EXAMPLE_DATABASE_URL");
    expect(envExample).toContain("PAYMENT_API_URL");

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
      "EXAMPLE_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5432/api_db",
    );
    expect(envExample).toContain("PAYMENT_API_URL=");

    // docker-compose.yml is a static committed file — the materializer
    // must never generate or rewrite it.
    expect(existsSync(join(dir, "docker-compose.yml"))).toBe(false);
  });

  it("writes a committed .env.test with isolated test database URLs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-env-test-"));
    tempDirs.push(dir);

    await materialize(dir, buildRuntimeConfig());
    const envTest = readFileSync(join(dir, ".env.test"), "utf-8");

    expect(envTest).toContain("# app.api");
    expect(envTest).toContain(
      "API_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5434/api_test_db",
    );
    expect(envTest).toContain("# app.auth");
    expect(envTest).toContain(
      "AUTH_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5435/auth_test_db",
    );
    expect(envTest).toContain("BETTER_AUTH_SECRET=regression-test-secret-do-not-use-in-production");
    expect(envTest).toContain("# plugins.example");
    expect(envTest).toContain(
      "EXAMPLE_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5434/api_test_db",
    );
    expect(envTest).not.toContain("CORS_ORIGIN=");
    expect(envTest).not.toContain("PAYMENT_API_URL=");
  });

  it("maps redis secrets to the conventional local redis URL in env templates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-redis-"));
    tempDirs.push(dir);

    await materialize(
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

    expect(envExample).toContain("# plugins.cache");
    expect(envExample).toContain("CACHE_REDIS_URL=redis://localhost:6379");
  });

  it("creates .env with generated auth secret and preserves other defaults", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-env-"));
    tempDirs.push(dir);

    await materialize(dir, buildRuntimeConfig());
    await Effect.runPromise(projectEnv.ensureFile(dir));

    const env = readFileSync(join(dir, ".env"), "utf-8");

    expect(env).toContain(
      "API_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5432/api_db",
    );
    expect(env).toContain(
      "AUTH_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5433/auth_db",
    );
    expect(env).toContain(
      "EXAMPLE_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5432/api_db",
    );
    expect(env).toContain("PAYMENT_API_URL=");
    expect(env).toContain("CORS_ORIGIN=http://localhost:3000");
    expect(env).toMatch(/BETTER_AUTH_SECRET=.+/);
  });

  it("skips rewriting generated env templates when nothing changed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-sync-env-"));
    tempDirs.push(dir);

    await materialize(dir, buildRuntimeConfig());

    const firstExample = readFileSync(join(dir, ".env.example"), "utf-8");
    const firstTest = readFileSync(join(dir, ".env.test"), "utf-8");
    const firstMtimes = [
      statSync(join(dir, ".env.example")).mtimeMs,
      statSync(join(dir, ".env.test")).mtimeMs,
    ];

    // sleep well above filesystem mtime resolution so a re-write is detectable
    await new Promise((r) => setTimeout(r, 1100));

    await materialize(dir, buildRuntimeConfig());

    expect(readFileSync(join(dir, ".env.example"), "utf-8")).toBe(firstExample);
    expect(readFileSync(join(dir, ".env.test"), "utf-8")).toBe(firstTest);
    expect(statSync(join(dir, ".env.example")).mtimeMs).toBe(firstMtimes[0]!);
    expect(statSync(join(dir, ".env.test")).mtimeMs).toBe(firstMtimes[1]!);
  });

  it("loads .env into the bos process without overriding exported values", async () => {
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

      await Effect.runPromise(projectEnv.load(dir));

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

  it("keeps CORS_ORIGIN stable at :3000 in .env.example regardless of host.port", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-cors-stable-"));
    tempDirs.push(dir);

    await materialize(
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
    expect(envExample).toContain("CORS_ORIGIN=http://localhost:3000");
    expect(envExample).not.toContain("CORS_ORIGIN=http://localhost:3210");
  });

  it("keeps CORS_ORIGIN stable when host.url resolves to a non-default port", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-cors-stable-url-"));
    tempDirs.push(dir);

    await materialize(
      dir,
      buildRuntimeConfig({
        host: { name: "host", url: "http://localhost:3055", entry: "/mf-manifest.json" },
      }),
    );
    const envExample = readFileSync(join(dir, ".env.example"), "utf-8");
    expect(envExample).toContain("CORS_ORIGIN=http://localhost:3000");
    expect(envExample).not.toContain("CORS_ORIGIN=http://localhost:3055");
  });

  // canary: production-env path is identical to the dev path now that
  // CORS_ORIGIN is decoupled from the runtime host port. Kept as a guard
  // in case an env-mode conditional is reintroduced.
  it("skips dev CORS_ORIGIN override in production env", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-cors-prod-"));
    tempDirs.push(dir);

    await materialize(
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

  it("loadPortState tolerates legacy state files with postgres/redis port maps", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-devports-legacy-"));
    tempDirs.push(dir);

    mkdirSync(join(dir, ".bos"), { recursive: true });
    writeFileSync(
      join(dir, ".bos", "infra-state.json"),
      JSON.stringify({
        postgresPorts: { api: 5432 },
        redisPorts: { cache: 6379 },
        devPorts: { host: 3100 },
      }),
    );
    const loaded = loadPortState(dir);
    expect(loaded.devPorts?.host).toBe(3100);
    expect("postgresPorts" in loaded).toBe(false);
  });
});
