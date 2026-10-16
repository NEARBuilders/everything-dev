import { Effect, Layer } from "effect";
import type { BosConfig, RuntimeConfig } from "everything-dev/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "../../src/services/config";
import { RuntimeSnapshot } from "../../src/services/runtime-snapshot";
import {
  adoptBackoffMs,
  DEFAULT_WATCH_INTERVAL_MS,
  pointerFingerprint,
  runWatchTick,
} from "../../src/services/snapshot-watch";

const bootConfig = {
  env: "production",
  account: "v1.citynode.near",
  domain: "citynode.app",
  networkId: "mainnet",
  ui: {
    name: "ui",
    url: "https://cdn.example.test/ui/",
    entry: "https://cdn.example.test/ui/mf-manifest.json",
    source: "remote",
    integrity: "sha384-ui-entry",
  },
} as unknown as RuntimeConfig;

const publishedPointer = {
  account: "v1.citynode.near",
  domain: "citynode.app",
  app: {
    ui: {
      development: "local:ui",
      production: "https://cdn.example.test/ui/",
      pin: {
        manifest: "versions/8f3ac1d2feedbeef.json",
        integrity: "sha384-pin",
      },
    },
  },
} as unknown as BosConfig;

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../src/utils/logger", () => ({ logger: loggerMock }));

const snapshotLayer = RuntimeSnapshot.layer().pipe(
  Layer.provide(Layer.succeed(ConfigService, bootConfig)),
);

let snapshot: RuntimeSnapshot["Service"];

const makeDeps = (overrides?: Partial<Parameters<typeof runWatchTick>[0]>) => {
  const deps = {
    snapshot,
    adopt: vi.fn().mockResolvedValue({ status: "swapped" }),
    fetchPointer: vi.fn().mockResolvedValue(publishedPointer),
    verifyEntries: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as Parameters<typeof runWatchTick>[0] & {
    adopt: ReturnType<typeof vi.fn>;
    verifyEntries: ReturnType<typeof vi.fn>;
    log: {
      error: ReturnType<typeof vi.fn>;
      warn: ReturnType<typeof vi.fn>;
      info: ReturnType<typeof vi.fn>;
    };
  };
  return deps;
};

describe("runWatchTick", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    snapshot = await Effect.runPromise(RuntimeSnapshot.pipe(Effect.provide(snapshotLayer)));
  });

  it("adopts when the published pointer's fingerprint changes", async () => {
    const deps = makeDeps();
    const { lastSeen } = await Effect.runPromise(runWatchTick({ ...deps, lastSeen: undefined }));
    expect(deps.fetchPointer).toHaveBeenCalledTimes(1);
    expect(deps.adopt).toHaveBeenCalledTimes(1);
    expect(lastSeen).toBe(pointerFingerprint(publishedPointer));
  });

  it("skips the adopt when the pointer is unchanged", async () => {
    const fp = pointerFingerprint(publishedPointer);
    const deps = makeDeps();
    const { lastSeen } = await Effect.runPromise(runWatchTick({ ...deps, lastSeen: fp }));
    expect(deps.adopt).not.toHaveBeenCalled();
    expect(deps.verifyEntries).toHaveBeenCalledTimes(1);
    expect(lastSeen).toBe(fp);
  });

  it("verifies the current entries each unchanged-pointer tick", async () => {
    const fp = pointerFingerprint(publishedPointer);
    const deps = makeDeps();
    await Effect.runPromise(runWatchTick({ ...deps, lastSeen: fp }));
    expect(deps.verifyEntries).toHaveBeenCalledWith(bootConfig);
  });

  it("alerts on entry-verification failure when the pointer is unchanged", async () => {
    const fp = pointerFingerprint(publishedPointer);
    const verifyEntries = vi
      .fn<(config: RuntimeConfig) => Promise<void>>()
      .mockRejectedValue(new Error("[SRI] Integrity check failed"));
    const deps = makeDeps({ verifyEntries });

    await Effect.runPromise(runWatchTick({ ...deps, lastSeen: fp }));

    // an unchanged pointer cannot heal by re-adopting — alert (the greppable
    // string) for the serving-side corruption
    expect(deps.adopt).not.toHaveBeenCalled();
    const alert = loggerMock.error.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes("INTEGRITY FAILURE"),
    );
    expect(alert).toBeDefined();
  });

  it("an adopt failure is logged and retried on a later tick (lastSeen unchanged)", async () => {
    const deps = makeDeps({
      adopt: vi.fn().mockRejectedValue(new Error("pre-warm compose failed")),
    });
    const { lastSeen } = await Effect.runPromise(runWatchTick({ ...deps, lastSeen: undefined }));
    expect(deps.adopt).toHaveBeenCalledTimes(1);
    expect(lastSeen).toBeUndefined();
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("the adopt-failure log unwraps Effect's UnknownError wrapper to the real cause", async () => {
    const realCause = new Error("pinned entry failed verification (https://cdn/ui/remoteEntry.js)");
    const unknownErrorWrapper = Object.assign(new Error("An error occurred in Effect.tryPromise"), {
      cause: realCause,
    });
    const deps = makeDeps({
      adopt: vi.fn().mockRejectedValue(unknownErrorWrapper),
    });

    await Effect.runPromise(runWatchTick({ ...deps, lastSeen: undefined }));

    const failure = loggerMock.error.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes("adopt failed"),
    );
    expect(failure).toBeDefined();
    const rendered = String(failure![1]);
    expect(rendered).toContain("pinned entry failed verification");
  });

  it("describeCauseChain walks nested causes and dedupes repeats", async () => {
    const { describeCauseChain } = await import("../../src/services/snapshot-watch");
    const inner = new Error("CDN 403 for versions/8f3ac1d2.json");
    const outer = Object.assign(new Error("pre-warm compose failed"), { cause: inner });
    const wrapper = Object.assign(new Error("An error occurred in Effect.tryPromise"), {
      cause: outer,
    });

    const chain = describeCauseChain(wrapper);
    expect(chain).toContain("pre-warm compose failed");
    expect(chain).toContain("CDN 403 for versions/8f3ac1d2.json");

    expect(describeCauseChain("plain string")).toBe("plain string");
    expect(describeCauseChain(null)).toBe("null");
  });
});

describe("adoptBackoffMs", () => {
  it("keeps the base interval with no consecutive failures", () => {
    expect(adoptBackoffMs(DEFAULT_WATCH_INTERVAL_MS, 0)).toBe(DEFAULT_WATCH_INTERVAL_MS);
  });

  it("doubles per consecutive failure and caps at 5 minutes", () => {
    expect(adoptBackoffMs(30_000, 1)).toBe(30_000);
    expect(adoptBackoffMs(30_000, 2)).toBe(60_000);
    expect(adoptBackoffMs(30_000, 3)).toBe(120_000);
    expect(adoptBackoffMs(30_000, 4)).toBe(240_000);
    expect(adoptBackoffMs(30_000, 5)).toBe(300_000);
    expect(adoptBackoffMs(30_000, 6)).toBe(300_000);
    expect(adoptBackoffMs(30_000, 50)).toBe(300_000);
  });
});
