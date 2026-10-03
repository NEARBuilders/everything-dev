import { ConfigProvider, Effect, Redacted } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCorsOrigins } from "../../src/services/config";
import { readDbSecret, secretsFromEnv } from "../../src/services/plugins";

const KEYS = ["CORS_ORIGIN", "TEST_DB_URL", "TEST_SECRET_A", "TEST_SECRET_B", "TEST_SECRET_C"];
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

describe("readDbSecret", () => {
  it("returns a redacted value when the secret is set", async () => {
    process.env.TEST_DB_URL = "postgres://user:secret@localhost:5432/db";
    const secret = await runWithFreshEnv(readDbSecret("TEST_DB_URL"));
    expect(Redacted.value(secret)).toBe("postgres://user:secret@localhost:5432/db");
  });

  it("falls back to the unset sentinel when the secret is missing", async () => {
    const secret = await runWithFreshEnv(readDbSecret("TEST_DB_URL"));
    expect(Redacted.value(secret)).toBe("unset");
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
