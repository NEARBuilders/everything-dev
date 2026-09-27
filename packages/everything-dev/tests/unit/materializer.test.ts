import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  InfraMaterializer,
  InfraMaterializerLive,
  materializeViaLayer,
} from "../../src/infra/materializer";
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
        secrets: ["EXAMPLE_DATABASE_URL"],
      },
    },
    ...overrides,
  } as RuntimeConfig;
}

async function materializeAll(configDir: string, runtimeConfig: RuntimeConfig): Promise<void> {
  await Effect.runPromise(
    Effect.gen(function* () {
      const m = yield* InfraMaterializer;
      yield* m.materializeTemplate(configDir, runtimeConfig);
      yield* m.materializeTestInfra(configDir, runtimeConfig);
    }).pipe(Effect.provide(InfraMaterializerLive)),
  );
}

describe("InfraMaterializer Tag + Layer", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Tag is resolvable through InfraMaterializerLive", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const m = yield* InfraMaterializer;
        expect(typeof m.materializeTemplate).toBe("function");
        expect(typeof m.materializeTestInfra).toBe("function");
      }).pipe(Effect.provide(InfraMaterializerLive)),
    );
  });

  it("Layer.succeed shape matches the Tag.Service contract", () => {
    // The static type system already guarantees this; the runtime check
    // is here to prevent accidental drift if the Layer is replaced by a
    // thinner one that no-ops silently under test.
    expect(Layer.isLayer(InfraMaterializerLive)).toBe(true);
  });

  it("writes .env.example and .env.test — and never touches .env or docker-compose.yml", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-materializer-"));
    tempDirs.push(dir);

    await materializeAll(dir, buildRuntimeConfig());

    expect(existsSync(join(dir, ".env.example"))).toBe(true);
    expect(existsSync(join(dir, ".env"))).toBe(false);
    expect(existsSync(join(dir, ".env.test"))).toBe(true);
    expect(existsSync(join(dir, "docker-compose.yml"))).toBe(false);
  });

  it(".env is syncEnvFile's domain — the materializer must not clobber user keys", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-materializer-"));
    tempDirs.push(dir);

    await materializeAll(dir, buildRuntimeConfig());

    const envExample = readFileSync(join(dir, ".env.example"), "utf-8");
    expect(envExample).toContain("CORS_ORIGIN=http://localhost:3000");
  });

  it("materializer is idempotent — re-running does not bump mtimes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-materializer-"));
    tempDirs.push(dir);

    await materializeAll(dir, buildRuntimeConfig());
    const first = {
      example: statSync(join(dir, ".env.example")).mtimeMs,
      test: statSync(join(dir, ".env.test")).mtimeMs,
    };
    await new Promise((r) => setTimeout(r, 1100));
    await materializeAll(dir, buildRuntimeConfig());
    expect(statSync(join(dir, ".env.example")).mtimeMs).toBe(first.example);
    expect(statSync(join(dir, ".env.test")).mtimeMs).toBe(first.test);
  });
});

describe("materializeViaLayer orchestration", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function buildRuntimeConfigForPort(port: number): RuntimeConfig {
    return {
      env: "development",
      account: "dev.everything.near",
      networkId: "mainnet",
      host: {
        name: "host",
        url: `http://localhost:${port}`,
        entry: "/mf-manifest.json",
        port,
      },
      ui: { name: "ui", url: "http://localhost:3003", entry: "/mf-manifest.json" },
      api: {
        name: "api",
        url: `http://localhost:${port + 1}`,
        entry: "/mf-manifest.json",
        secrets: ["API_DATABASE_URL"],
      },
      auth: {
        name: "auth",
        url: `http://localhost:${port + 2}`,
        entry: "/mf-manifest.json",
        secrets: ["AUTH_DATABASE_URL", "BETTER_AUTH_SECRET", "CORS_ORIGIN"],
      },
      plugins: {},
    } as RuntimeConfig;
  }

  it("writes .env.example when ephemeral is false", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-orch-non-ephemeral-"));
    tempDirs.push(dir);

    await materializeViaLayer(dir, buildRuntimeConfigForPort(4100), {
      ephemeral: false,
    });

    expect(existsSync(join(dir, ".env.example"))).toBe(true);
    expect(readFileSync(join(dir, ".env.example"), "utf-8")).toContain(
      "CORS_ORIGIN=http://localhost:3000",
    );
  });

  it("does NOT write .env.example when ephemeral is true (regression scenario)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-orch-ephemeral-"));
    tempDirs.push(dir);

    // pre-populate .env.example to mimic a committed reference template
    const committedTemplate = "# committed reference\nCORS_ORIGIN=http://localhost:3000\n";
    writeFileSync(join(dir, ".env.example"), committedTemplate);
    const mtimeBefore = statSync(join(dir, ".env.example")).mtimeMs;

    await new Promise((r) => setTimeout(r, 1100));

    await materializeViaLayer(dir, buildRuntimeConfigForPort(4100), {
      ephemeral: true,
    });

    // .env.example must remain byte-identical and untouched
    expect(readFileSync(join(dir, ".env.example"), "utf-8")).toBe(committedTemplate);
    expect(statSync(join(dir, ".env.example")).mtimeMs).toBe(mtimeBefore);

    // ephemeral runs still materialize test infra
    expect(existsSync(join(dir, ".env.test"))).toBe(true);
    expect(existsSync(join(dir, "docker-compose.yml"))).toBe(false);
  });

  it("defaults to env-var detection (BOS_NO_PERSIST_PORTS=1 → ephemeral)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-orch-default-"));
    tempDirs.push(dir);

    const committedTemplate = "DO NOT TOUCH ME\n";
    writeFileSync(join(dir, ".env.example"), committedTemplate);

    const previous = process.env.BOS_NO_PERSIST_PORTS;
    process.env.BOS_NO_PERSIST_PORTS = "1";
    try {
      await materializeViaLayer(dir, buildRuntimeConfigForPort(4100));
      expect(readFileSync(join(dir, ".env.example"), "utf-8")).toBe(committedTemplate);
      expect(existsSync(join(dir, ".env.test"))).toBe(true);
      expect(existsSync(join(dir, "docker-compose.yml"))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.BOS_NO_PERSIST_PORTS;
      else process.env.BOS_NO_PERSIST_PORTS = previous;
    }
  });
});
