import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignerService } from "../../src/services/auth/signer";
import { BundleStorage, RegistryStore } from "../../src/services/deploy/deps";
import { PublishTrainError } from "../../src/services/deploy/errors";
import { DeployTrainService } from "../../src/services/deploy/train";
import type { BosConfig } from "../../src/types";

const openResolutionMock = vi.hoisted(() => vi.fn());
const fetchPublishedConfigMock = vi.hoisted(() => vi.fn());
const resolveSigningStrategyMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/services/resolution/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/resolution/session")>();
  return { ...actual, openResolution: openResolutionMock };
});

vi.mock("../../src/services/registry/fastkv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/registry/fastkv")>();
  return {
    ...actual,
    fetchPublishedConfigFromFastKv: fetchPublishedConfigMock,
  };
});

vi.mock("../../src/near-signer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/near-signer")>();
  return {
    ...actual,
    resolveSigningStrategy: resolveSigningStrategyMock,
  };
});

const configWithoutDomain = { account: "v1.acct.near" } as BosConfig;
const configReady = { account: "v1.acct.near", domain: "app.test" } as BosConfig;

const baseInput = {
  runtimeConfig: null,
  env: "production" as const,
  build: false,
  dryRun: false,
  verbose: false,
  packages: "all",
};

const trainLayers = DeployTrainService.Live.pipe(
  Layer.provide(Layer.mergeAll(BundleStorage.Live, RegistryStore.Live, SignerService.Live)),
);

const configDir = mkdtempSync(join(tmpdir(), "bos-train-service-"));
writeFileSync(join(configDir, "bos.config.json"), JSON.stringify(configReady, null, 2));

beforeEach(() => {
  process.env.BOS_PUBLISH_CONFIRMATION_INTERVAL_MS = "10";
  process.env.BOS_PUBLISH_CONFIRMATION_TIMEOUT_MS = "2000";
  resolveSigningStrategyMock.mockResolvedValue({
    strategy: "near-kit",
    privateKey: "ed25519:test",
    source: "provided",
  });
  openResolutionMock.mockResolvedValue({
    config: configReady,
    rawConfig: configReady,
    runtime: null,
    root: configDir,
  });
  fetchPublishedConfigMock.mockRejectedValue(new Error("No config found"));
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.BOS_PUBLISH_CONFIRMATION_INTERVAL_MS;
  delete process.env.BOS_PUBLISH_CONFIRMATION_TIMEOUT_MS;
});

afterAll(() => {
  rmSync(configDir, { recursive: true, force: true });
});

describe("DeployTrainService", () => {
  it("fails the typed channel — a preflight guard surfaces as PublishTrainError with its leg kind", async () => {
    const program = Effect.gen(function* () {
      const train = yield* DeployTrainService;
      return yield* train.publish({
        ...baseInput,
        bosConfig: configWithoutDomain,
        configDir,
      });
    });
    const failure = await Effect.runPromise(Effect.provide(program, trainLayers)).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(PublishTrainError);
    expect(failure).toMatchObject({
      kind: "preflight",
      error: "authored config must define domain to publish",
    });
  });

  it("handlers map the typed error to the wire shape mechanically via catchTag", async () => {
    const program = Effect.gen(function* () {
      const train = yield* DeployTrainService;
      return yield* train
        .publish({ ...baseInput, bosConfig: configWithoutDomain, configDir })
        .pipe(Effect.catchTag("PublishTrainError", (e) => Effect.succeed(e.toResult())));
    });
    const result = await Effect.runPromise(Effect.provide(program, trainLayers));

    expect(result).toMatchObject({
      status: "error",
      registryUrl: "",
      error: "authored config must define domain to publish",
    });
  });

  it("the dry-run short-circuit returns through the success channel", async () => {
    const program = Effect.gen(function* () {
      const train = yield* DeployTrainService;
      return yield* train.publish({
        ...baseInput,
        bosConfig: configReady,
        configDir,
        dryRun: true,
      });
    });
    const result = await Effect.runPromise(Effect.provide(program, trainLayers));

    expect(result.status).toBe("dry-run");
    expect(result.registryUrl).toContain("v1.acct.near");
  });

  it("routes registry reads and signing through the injected tags", async () => {
    const submitted: string[] = [];
    let registryReads = 0;
    const fakeRegistry = Layer.succeed(
      RegistryStore,
      RegistryStore.of({
        fetchConfig: (async () => {
          registryReads += 1;
          if (registryReads === 1) throw new Error("No config found");
          return JSON.parse(JSON.stringify(configReady));
        }) as never,
        fetchHistory: (async () => {
          throw new Error("not used");
        }) as never,
      }),
    );
    const fakeSigner = Layer.succeed(
      SignerService,
      SignerService.of({
        submitRegistryWrite: (async () => {
          throw new Error("not used");
        }) as never,
        submitRegistryWriteDelegated: (async () => {
          throw new Error("not used");
        }) as never,
        submitRegistryWriteCustody: (async () => {
          throw new Error("not used");
        }) as never,
        ensureDelegateKey: (async () => {
          throw new Error("not used");
        }) as never,
        ensureCustodyBalance: (async () => {}) as never,
        submit: (async (input: { account: string }) => {
          submitted.push(input.account);
          return { success: true, txHash: "tx_test" };
        }) as never,
      }),
    );

    const program = Effect.gen(function* () {
      const train = yield* DeployTrainService;
      return yield* train.publish({
        ...baseInput,
        bosConfig: configReady,
        configDir,
        privateKey: "ed25519:test",
      });
    });
    const result = await Effect.runPromise(
      Effect.provide(
        program,
        DeployTrainService.Live.pipe(
          Layer.provide(Layer.mergeAll(BundleStorage.Live, fakeRegistry, fakeSigner)),
        ),
      ),
    );

    expect(result.status).toBe("published");
    expect(result).toMatchObject({ txHash: "tx_test" });
    expect(submitted).toEqual(["v1.acct.near"]);
    expect(registryReads).toBeGreaterThanOrEqual(2);
  });
});
