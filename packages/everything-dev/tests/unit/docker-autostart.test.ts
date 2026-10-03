import { describe, expect, it } from "vitest";
import { isDockerTestMode, shouldAutoStartDocker, takeTail } from "../../src/infra/docker";
import type { PreflightFailure } from "../../src/infra/preflight";

const unreachable = (secret: string): PreflightFailure => ({
  secret,
  host: "localhost",
  port: 59998,
  error: `${secret} points to localhost:59998 but nothing is listening.`,
  tcpReachable: false,
});

const authFailure = (secret: string): PreflightFailure => ({
  secret,
  host: "localhost",
  port: 5432,
  error: `${secret} at localhost:5432 is reachable but Postgres connection failed.`,
  tcpReachable: true,
});

const guards = { composeFileExists: true, dockerAvailable: true, testMode: false };

describe("shouldAutoStartDocker", () => {
  it("starts docker when every failure is an unreachable local service", () => {
    expect(shouldAutoStartDocker([unreachable("API_DATABASE_URL")], guards)).toBe(true);
    expect(
      shouldAutoStartDocker(
        [unreachable("API_DATABASE_URL"), unreachable("CACHE_REDIS_URL")],
        guards,
      ),
    ).toBe(true);
  });

  it("never starts docker when any failure is reachable-but-broken (credentials)", () => {
    expect(shouldAutoStartDocker([authFailure("API_DATABASE_URL")], guards)).toBe(false);
    expect(
      shouldAutoStartDocker(
        [unreachable("API_DATABASE_URL"), authFailure("AUTH_DATABASE_URL")],
        guards,
      ),
    ).toBe(false);
  });

  it("requires the compose file", () => {
    expect(
      shouldAutoStartDocker([unreachable("API_DATABASE_URL")], {
        ...guards,
        composeFileExists: false,
      }),
    ).toBe(false);
  });

  it("requires docker to be available", () => {
    expect(
      shouldAutoStartDocker([unreachable("API_DATABASE_URL")], {
        ...guards,
        dockerAvailable: false,
      }),
    ).toBe(false);
  });

  it("never starts docker in test mode", () => {
    expect(
      shouldAutoStartDocker([unreachable("API_DATABASE_URL")], { ...guards, testMode: true }),
    ).toBe(false);
  });

  it("does nothing when preflight passed", () => {
    expect(shouldAutoStartDocker([], guards)).toBe(false);
  });
});

describe("isDockerTestMode", () => {
  it("detects the regression-stack env markers", () => {
    expect(isDockerTestMode({ BOS_TEST: "1" })).toBe(true);
    expect(isDockerTestMode({ NODE_ENV: "test" })).toBe(true);
    expect(isDockerTestMode({ BOS_NO_PERSIST_PORTS: "1" })).toBe(true);
    expect(isDockerTestMode({ BOS_TEST: "0", NODE_ENV: "development" })).toBe(false);
    expect(isDockerTestMode({})).toBe(false);
  });
});

describe("takeTail", () => {
  it("keeps the last N lines, joined and trimmed", () => {
    expect(takeTail(["a", "b", "c"], 2)).toBe("b\nc");
    expect(takeTail(["a", "b", "c"])).toBe("a\nb\nc");
  });

  it("returns an empty string for no output", () => {
    expect(takeTail([], 5)).toBe("");
  });
});
