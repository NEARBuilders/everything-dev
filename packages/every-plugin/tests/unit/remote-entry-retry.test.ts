import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleFederationError } from "../../src/errors";
import type { PluginLoadAttemptInfo } from "../../src/remote-entry";
import {
  loadRemoteWithRetry,
  purgeRemoteEntryCache,
  waitForRemoteEntryReady,
} from "../../src/remote-entry";
import { classifyPluginFailure } from "../../src/runtime/errors";

const poisonEntryCache = (remoteUrl: string) => {
  const globalLoading: Record<string, unknown> =
    ((globalThis as Record<string, unknown>).__GLOBAL_LOADING_REMOTE_ENTRY__ as
      | Record<string, unknown>
      | undefined) ?? {};
  const poisoned = Promise.reject(new Error("poisoned"));
  poisoned.catch(() => {});
  globalLoading[`12:${remoteUrl}`] = poisoned;
  (globalThis as Record<string, unknown>).__GLOBAL_LOADING_REMOTE_ENTRY__ = globalLoading;
};

// The readiness poll fetches the real URL; tests stub `load`, so keep the
// poll's budget at zero to never touch the network.
const READINESS_NEVER = { readinessTimeoutMs: 1 };

describe("loadRemoteWithRetry", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // The readiness poll fetches the entry URL before loading; satisfy it
    // without touching the network.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "var pluginEntry = 1;" })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    purgeRemoteEntryCache("https://remote.test/remoteEntry.js");
  });

  it("succeeds on the first attempt without retrying", async () => {
    const load = vi.fn(() => Promise.resolve({ ok: true }));
    const result = await Effect.runPromise(
      loadRemoteWithRetry({
        label: "test",
        remoteUrl: "https://remote.test/remoteEntry.js",
        load,
        ...READINESS_NEVER,
      }),
    );
    expect(result).toEqual({ ok: true });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retries transient (retryable) failures until the load succeeds", async () => {
    let calls = 0;
    const load = vi.fn(() => {
      calls += 1;
      return calls < 3 ? Promise.reject(new Error("request timeout")) : Promise.resolve("loaded");
    });
    const result = await Effect.runPromise(
      loadRemoteWithRetry({
        label: "test",
        remoteUrl: "https://remote.test/remoteEntry.js",
        load,
        ...READINESS_NEVER,
      }),
    );
    expect(result).toBe("loaded");
    expect(calls).toBe(3);
  });

  it("purges the poisoned global entry cache between attempts", async () => {
    const remoteUrl = "https://remote.test/remoteEntry.js";
    poisonEntryCache(remoteUrl);
    let calls = 0;
    const load = vi.fn(() => {
      calls += 1;
      return calls < 2 ? Promise.reject(new Error("request timeout")) : Promise.resolve("ok");
    });
    await Effect.runPromise(
      loadRemoteWithRetry({ label: "t", remoteUrl, load, ...READINESS_NEVER }),
    );
    const globalLoading = (globalThis as Record<string, unknown>)
      .__GLOBAL_LOADING_REMOTE_ENTRY__ as Record<string, unknown>;
    expect(Object.keys(globalLoading)).toHaveLength(0);
  });

  it("fails fast on permanent (non-retryable) failures", async () => {
    const load = vi.fn(() =>
      Promise.reject(new Error("self-signed certificate in certificate chain")),
    );
    await expect(
      Effect.runPromise(
        loadRemoteWithRetry({
          label: "test",
          remoteUrl: "https://remote.test/remoteEntry.js",
          load,
          ...READINESS_NEVER,
        }),
      ),
    ).rejects.toThrow(/self-signed certificate/);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("fails fast on MF identity skew", async () => {
    const load = vi.fn(() =>
      Promise.reject(
        new ModuleFederationError({
          pluginId: "test",
          remoteUrl: "https://remote.test/remoteEntry.js",
          cause: new Error("shared dependency skew"),
        }),
      ),
    );
    const error = await Effect.runPromise(
      loadRemoteWithRetry({
        label: "test",
        remoteUrl: "https://remote.test/remoteEntry.js",
        load,
        ...READINESS_NEVER,
      }),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(classifyPluginFailure(error)).toMatchObject({ kind: "mf", retryable: false });
  });

  it("does not purge the entry cache on success paths", async () => {
    const remoteUrl = "https://remote.test/remoteEntry.js";
    poisonEntryCache(remoteUrl);
    await Effect.runPromise(
      loadRemoteWithRetry({
        label: "t",
        remoteUrl,
        load: () => Promise.resolve("ok"),
        ...READINESS_NEVER,
      }),
    );
    const globalLoading = (globalThis as Record<string, unknown>)
      .__GLOBAL_LOADING_REMOTE_ENTRY__ as Record<string, unknown>;
    expect(Object.keys(globalLoading)).toHaveLength(1);
  });

  it("reports every attempt through onAttempt with classification", async () => {
    const onAttempt = vi.fn((_error: unknown, _info: PluginLoadAttemptInfo) => {});
    let calls = 0;
    const load = vi.fn(() => {
      calls += 1;
      return calls < 2 ? Promise.reject(new Error("request timeout")) : Promise.resolve("ok");
    });
    await Effect.runPromise(
      loadRemoteWithRetry({
        label: "test",
        remoteUrl: "https://remote.test/remoteEntry.js",
        load,
        onAttempt,
        ...READINESS_NEVER,
      }),
    );
    expect(onAttempt).toHaveBeenCalledTimes(1);
    const [error, info] = onAttempt.mock.calls[0]!;
    expect(error).toBeInstanceOf(Error);
    expect(info.attempt).toBe(1);
    expect(info.classification.kind).toBe("network");
    expect(info.classification.retryable).toBe(true);
  });

  it("gives up with the last error when the budget is exhausted", async () => {
    const load = vi.fn(() => Promise.reject(new Error("request timeout")));
    await expect(
      Effect.runPromise(
        loadRemoteWithRetry({
          label: "test",
          remoteUrl: "https://remote.test/remoteEntry.js",
          load,
          timeoutMs: 1200,
          ...READINESS_NEVER,
        }),
      ),
    ).rejects.toThrow(/request timeout/);
    expect(load.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the default logger deduped for repeated identical failures", async () => {
    let calls = 0;
    const load = vi.fn(() => {
      calls += 1;
      return calls < 3 ? Promise.reject(new Error("request timeout")) : Promise.resolve("ok");
    });
    await Effect.runPromise(
      loadRemoteWithRetry({
        label: "test",
        remoteUrl: "https://remote.test/remoteEntry.js",
        load,
        ...READINESS_NEVER,
      }),
    );
    const errorCalls = (console.error as ReturnType<typeof vi.spyOn>).mock.calls.filter(
      (args: unknown[]) => String(args[0]).includes("[Plugins][test]"),
    );
    expect(errorCalls.length).toBe(1);
  });
});

describe("waitForRemoteEntryReady (policy integration)", () => {
  it("is used before loading — an unready entry waits then throws", async () => {
    await expect(
      waitForRemoteEntryReady("never", "https://unreachable.test/remoteEntry.js", 50),
    ).rejects.toThrow(/never became ready/);
  });
});
