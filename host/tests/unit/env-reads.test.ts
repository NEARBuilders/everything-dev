import { ConfigProvider, Effect, Redacted } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCorsOrigins } from "../../src/services/config";
import { resolveSecretsWithDatabaseFallback, secretsFromEnv } from "../../src/services/plugins";

const KEYS = [
  "AI_API_KEY",
  "API_DATABASE_URL",
  "CORS_ORIGIN",
  "TEMPLATE_DATABASE_URL",
  "TEST_DB_URL",
  "TEST_SECRET_A",
  "TEST_SECRET_B",
  "TEST_SECRET_C",
  "VOTES_DATABASE_URL",
];
let savedEnv: Record<string, string | undefined>;

function runWithFreshEnv<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(
    Effect.provideService(effect, ConfigProvider.ConfigProvider, ConfigProvider.fromEnv()),
  );
}

beforeEach(() => {
  savedEnv = {};
  for (const key of KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("readCorsOrigins", () => {
  it("returns an empty list when CORS_ORIGIN is unset", async () => {
    expect(await runWithFreshEnv(readCorsOrigins)).toEqual([]);
  });

  it("splits, trims, and filters a comma-separated CORS_ORIGIN", async () => {
    process.env.CORS_ORIGIN = " https://a.test ,https://b.test, ,";
    expect(await runWithFreshEnv(readCorsOrigins)).toEqual(["https://a.test", "https://b.test"]);
  });

  it("treats an empty CORS_ORIGIN as unset", async () => {
    process.env.CORS_ORIGIN = "";
    expect(await runWithFreshEnv(readCorsOrigins)).toEqual([]);
  });
});

describe("resolveSecretsWithDatabaseFallback", () => {
  it("leaves explicitly-set plugin database secrets untouched", async () => {
    process.env.VOTES_DATABASE_URL = "postgres://votes@localhost:5432/votes_db";
    process.env.API_DATABASE_URL = "postgres://api@localhost:5432/api_db";
    const secrets = await runWithFreshEnv(
      resolveSecretsWithDatabaseFallback(["VOTES_DATABASE_URL"]),
    );
    expect(secrets.VOTES_DATABASE_URL).toBe("postgres://votes@localhost:5432/votes_db");
  });

  it("fills missing plugin database secrets with the API database URL", async () => {
    process.env.API_DATABASE_URL = "postgres://api@localhost:5432/api_db";
    const secrets = await runWithFreshEnv(
      resolveSecretsWithDatabaseFallback(["VOTES_DATABASE_URL", "TEMPLATE_DATABASE_URL"]),
    );
    expect(secrets.VOTES_DATABASE_URL).toBe("postgres://api@localhost:5432/api_db");
    expect(secrets.TEMPLATE_DATABASE_URL).toBe("postgres://api@localhost:5432/api_db");
  });

  it("omits plugin database secrets when no API database URL is set", async () => {
    const secrets = await runWithFreshEnv(
      resolveSecretsWithDatabaseFallback(["VOTES_DATABASE_URL"]),
    );
    expect(secrets).toEqual({});
  });

  it("treats an empty API database URL as unset", async () => {
    process.env.API_DATABASE_URL = "";
    const secrets = await runWithFreshEnv(
      resolveSecretsWithDatabaseFallback(["VOTES_DATABASE_URL"]),
    );
    expect(secrets).toEqual({});
  });

  it("passes non-database secrets through untouched", async () => {
    process.env.API_DATABASE_URL = "postgres://api@localhost:5432/api_db";
    process.env.AI_API_KEY = "sk-test";
    const secrets = await runWithFreshEnv(resolveSecretsWithDatabaseFallback(["AI_API_KEY"]));
    expect(secrets).toEqual({ AI_API_KEY: "sk-test" });
  });
});

describe("secretsFromEnv", () => {
  it("collects only present, non-empty secrets as redacted values", async () => {
    process.env.TEST_SECRET_A = "alpha";
    process.env.TEST_SECRET_B = "";
    const secrets = await runWithFreshEnv(
      secretsFromEnv(["TEST_SECRET_A", "TEST_SECRET_B", "TEST_SECRET_C"]),
    );
    expect(Object.keys(secrets)).toEqual(["TEST_SECRET_A"]);
    expect(Redacted.value(secrets.TEST_SECRET_A)).toBe("alpha");
  });

  it("returns an empty record for an empty key list", async () => {
    expect(await runWithFreshEnv(secretsFromEnv([]))).toEqual({});
  });
});
