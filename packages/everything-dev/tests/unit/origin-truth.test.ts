import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { syncEnvFile } from "../../src/env/project-env";
import { preflightLocalInfra } from "../../src/infra/preflight";
import { mergeGeneratedOverFileEnv } from "../../src/orchestrator";

describe("preflight credentialed URL parsing", () => {
  it("probes the planner's credentialed postgres URLs (previously a silent no-op)", async () => {
    const env = {
      API_DATABASE_URL: "postgres://everythingdev:everythingdev@localhost:5434/api_test_db",
      AUTH_DATABASE_URL: "postgres://everythingdev:everythingdev@localhost:5435/auth_test_db",
    };
    const failures = await Effect.runPromise(preflightLocalInfra(env));
    expect(Array.isArray(failures)).toBe(true);
  });

  it("probes redis URLs and reports unreachable ports by name", async () => {
    const env = { CACHE_REDIS_URL: "redis://localhost:59999" };
    const failures = await Effect.runPromise(preflightLocalInfra(env));
    expect(failures.length).toBe(1);
    expect(failures[0]?.secret).toBe("CACHE_REDIS_URL");
    expect(failures[0]?.error).toContain("nothing is listening");
  }, 20000);

  it("skips non-local URLs", async () => {
    const failures = await Effect.runPromise(
      preflightLocalInfra({ X_DATABASE_URL: "postgres://user:pass@db.example.com:5432/x" }),
    );
    expect(failures).toEqual([]);
  });

  it("gives API/AUTH failures the docker-compose hint", async () => {
    const env = { API_DATABASE_URL: "postgres://u:p@localhost:59998/api_db" };
    const failures = await Effect.runPromise(preflightLocalInfra(env));
    expect(failures.length).toBe(1);
    expect(failures[0]?.error).toContain("docker compose up -d --wait");
  }, 20000);
});

describe("origin truth (BASE_URL/CORS_ORIGIN are generated-owned)", () => {
  it("shell-exported stale origins lose to generated values in the child env", () => {
    const merged = mergeGeneratedOverFileEnv(
      { BASE_URL: "http://localhost:5300", CORS_ORIGIN: "http://localhost:5300", OTHER: "gen" },
      { BASE_URL: "http://localhost:3000" },
      { BASE_URL: "http://localhost:3000", CORS_ORIGIN: "http://localhost:3000", OTHER: "shell" },
    );
    expect(merged.BASE_URL).toBe("http://localhost:5300");
    expect(merged.CORS_ORIGIN).toBe("http://localhost:5300");
    expect(merged.OTHER).toBe("shell");
  });

  it("syncEnvFile corrects stale origins on disk even when shell-present, and masks db urls in drift logs", async () => {
    const dir = mkdtempSync(join("bos-origin-truth-"));
    try {
      writeFileSync(
        join(dir, ".env"),
        "BASE_URL=http://localhost:3000\nCORS_ORIGIN=http://localhost:3000\nAPI_DATABASE_URL=postgres://dev:secret@localhost:5432/api_db\n",
      );
      const drift = await Effect.runPromise(
        syncEnvFile(
          dir,
          {
            BASE_URL: "http://localhost:5300",
            CORS_ORIGIN: "http://localhost:5300",
            API_DATABASE_URL: "postgres://dev:secret@localhost:5434/api_db",
          },
          { BASE_URL: "http://localhost:3000", CORS_ORIGIN: "http://localhost:3000" },
        ),
      );
      expect(drift.length).toBe(3);
      const { readFileSync } = await import("node:fs");
      const env = readFileSync(join(dir, ".env"), "utf-8");
      expect(env).toContain("BASE_URL=http://localhost:5300");
      expect(env).toContain("CORS_ORIGIN=http://localhost:5300");
      expect(env).toContain("5434");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

afterEach(() => {
  // no shared state
});
