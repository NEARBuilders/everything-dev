import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignerService } from "../../src/services/auth/signer";
import { BundleStorage, RegistryStore } from "../../src/services/deploy/deps";
import { PublishTrainError } from "../../src/services/deploy/errors";
import { DeployTrainService } from "../../src/services/deploy/train";
import type { BosConfig } from "../../src/types";

const openResolutionMock = vi.hoisted(() => vi.fn());
const probeStorageOriginOverride = vi.hoisted(() => ({
  fn: undefined as undefined | (() => Promise<string | undefined>),
}));
const uploadWorkspaceBundleOverride = vi.hoisted(() => ({
  fn: undefined as
    | undefined
    | ((input: { workspaceKey: string }) => Promise<{
        kind: "ok";
        entryIntegrity: string;
        ssrEntryIntegrity?: string;
        pin?: unknown;
        storage: "r2";
      }>),
}));

vi.mock("../../src/services/deploy/upload-leg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/deploy/upload-leg")>();
  return {
    ...actual,
    uploadWorkspaceBundle: (input: { workspaceKey: string }) =>
      uploadWorkspaceBundleOverride.fn
        ? uploadWorkspaceBundleOverride.fn(input)
        : actual.uploadWorkspaceBundle(input as never),
  };
});

vi.mock("../../src/cdn-deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/cdn-deploy")>();
  return {
    ...actual,
    probeStorageOrigin: (...args: unknown[]) =>
      probeStorageOriginOverride.fn
        ? probeStorageOriginOverride.fn()
        : actual.probeStorageOrigin(...(args as Parameters<typeof actual.probeStorageOrigin>)),
  };
});
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

  it("the confirm wait tracks the submitted tx before the equality read-back", async () => {
    let fetchConfigReads = 0;
    const historyCalls: string[][] = [];
    const fakeRegistry = Layer.succeed(
      RegistryStore,
      RegistryStore.of({
        fetchConfig: (async () => {
          fetchConfigReads += 1;
          // The idempotency read (before submit) sees a diverged registry;
          // the post-tx read-back sees the published payload.
          return fetchConfigReads === 1
            ? ({ ...JSON.parse(JSON.stringify(configReady)), stale: true } as never)
            : JSON.parse(JSON.stringify(configReady));
        }) as never,
        fetchHistory: (async (opts: { accountId: string }) => {
          historyCalls.push([opts.accountId]);
          return [{ txHash: "tx_submitted_1", blockHeight: 1, blockTimestampNs: "0" }];
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
        submit: (async () => ({ success: true, txHash: "tx_submitted_1" })) as never,
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
    expect(historyCalls.length).toBeGreaterThanOrEqual(1);
    expect(fetchConfigReads).toBe(2);
  });

  it("uploads pipeline as builds complete, bounded, with deterministic entry order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const uploadOrder: string[] = [];
    const started: string[] = [];

    let lastSubmittedArgs: Record<string, string> | undefined;
    uploadWorkspaceBundleOverride.fn = async (input: { workspaceKey: string }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      started.push(input.workspaceKey);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      uploadOrder.push(input.workspaceKey);
      return {
        kind: "ok" as const,
        entryIntegrity: "sha384-x",
        ssrEntryIntegrity: undefined,
        pin: undefined,
        storage: "r2" as const,
      };
    };

    const scopedConfig = {
      account: "v1.acct.near",
      domain: "app.test",
      app: {
        api: { development: "local:api" },
        ui: { development: "local:ui" },
      },
      plugins: {},
    } as unknown as BosConfig;
    openResolutionMock.mockResolvedValue({
      config: scopedConfig,
      rawConfig: scopedConfig,
      runtime: null,
      root: configDir,
    });

    process.env.BOS_UPLOAD_CONCURRENCY = "1";
    process.env.BOS_BUNDLE_CDN_ORIGIN = "https://cdn.test";
    process.env.BOS_STORAGE_ORIGIN = "https://storage.test";
    process.env.BOS_STORAGE_API_KEY = "key_test";
    // The preflight's reachability probe would hit the network — the upload
    // fake below stands in for the storage service.
    probeStorageOriginOverride.fn = async () => undefined;
    try {
      const { runPublishTrain } = await import("../../src/services/deploy/train");
      const result = await runPublishTrain(
        {
          bosConfig: scopedConfig,
          runtimeConfig: null,
          configDir,
          env: "production",
          build: true,
          dryRun: false,
          verbose: false,
          packages: "all",
          privateKey: "ed25519:test",
        },
        {
          storage: BundleStorage.of({
            collectDistFiles: (() => []) as never,
            uploadWorkspaceDist: (() => ({})) as never,
            uploadBundle: (() => ({})) as never,
            resolveSlotVersion: (() => ({})) as never,
            readBuildReport: (() => ({})) as never,
            composeWorkspaceVersionManifest: (() => ({})) as never,
            buildSourceArchive: (() => ({})) as never,
          }),
          registry: {
            // The read-back serves the config the submit wrote — the merged
            // payload (integrity entries applied), not the raw input.
            fetchConfig: (async () => {
              const submitted = lastSubmittedArgs?.["apps/v1.acct.near/app.test/bos.config.json"];
              return submitted ? JSON.parse(submitted) : JSON.parse(JSON.stringify(scopedConfig));
            }) as never,
            fetchHistory: (async () => [
              { txHash: "tx_x", blockHeight: 1, blockTimestampNs: "0" },
            ]) as never,
          },
          signer: {
            submit: (async (submitInput: { args: Record<string, string> }) => {
              lastSubmittedArgs = submitInput.args;
              return { success: true, txHash: "tx_x" };
            }) as never,
          } as never,
          buildTrain: {
            buildTargets: (async (input, deps) => {
              for (const key of input.targets) {
                deps?.onWorkspaceBuilt?.(key);
                await new Promise((resolve) => setTimeout(resolve, 5));
              }
              return { built: input.targets, skipped: [] };
            }) as never,
          },
        },
      );

      expect(result.status).toBe("published");
      expect(started).toEqual(["api", "ui"]);
      expect(maxInFlight).toBe(1);
    } finally {
      delete process.env.BOS_UPLOAD_CONCURRENCY;
      delete process.env.BOS_BUNDLE_CDN_ORIGIN;
      delete process.env.BOS_STORAGE_ORIGIN;
      delete process.env.BOS_STORAGE_API_KEY;
      uploadWorkspaceBundleOverride.fn = undefined;
      probeStorageOriginOverride.fn = undefined;
    }
  });
});
