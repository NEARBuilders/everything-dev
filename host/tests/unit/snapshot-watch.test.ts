import { Effect, Layer } from "effect";
import type { BosConfig, RuntimeConfig } from "everything-dev/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "../../src/services/config";
import { RuntimeSnapshot } from "../../src/services/runtime-snapshot";
import { pointerFingerprint, runWatchTick } from "../../src/services/snapshot-watch";

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
});
