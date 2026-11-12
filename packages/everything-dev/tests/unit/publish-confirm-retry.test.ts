import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BosConfig } from "../../src/types";

const {
  verifyRollbackSnapshotMock,
  fetchBosConfigFromFastKvMock,
  fetchConfigHistoryMock,
  resolveSigningStrategyMock,
  submitRegistryWriteMock,
  classifyTransactionOutcomeMock,
  openResolutionMock,
  buildWorkspaceTargetsMock,
} = vi.hoisted(() => ({
  verifyRollbackSnapshotMock: vi.fn(),
  fetchBosConfigFromFastKvMock: vi.fn(),
  fetchConfigHistoryMock: vi.fn(),
  resolveSigningStrategyMock: vi.fn(),
  submitRegistryWriteMock: vi.fn(),
  classifyTransactionOutcomeMock: vi.fn(),
  openResolutionMock: vi.fn(),
  buildWorkspaceTargetsMock: vi.fn(),
}));

vi.mock("../../src/services/deploy/rollback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/deploy/rollback")>();
  return { ...actual, verifyRollbackSnapshot: verifyRollbackSnapshotMock };
});

vi.mock("../../src/services/registry/fastkv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/registry/fastkv")>();
  // the registry serves canonical payloads — local: dev targets stripped
  // (#584); the fixtures here are published-shape
  const canonical = async (...args: Parameters<typeof fetchBosConfigFromFastKvMock>) =>
    stripLocalDevelopmentTargets(await fetchBosConfigFromFastKvMock(...args));
  return {
    ...actual,
    fetchBosConfigFromFastKv: canonical,
    fetchPublishedConfigFromFastKv: canonical,
    fetchConfigHistory: fetchConfigHistoryMock,
  };
});

vi.mock("../../src/services/auth/near-signer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/auth/near-signer")>();
  return {
    ...actual,
    resolveSigningStrategy: resolveSigningStrategyMock,
    checkPublishKeyHealth: () => Promise.resolve({ ok: true }),
    submitRegistryWrite: submitRegistryWriteMock,
    classifyTransactionOutcome: classifyTransactionOutcomeMock,
  };
});

vi.mock("../../src/services/resolution/session", () => ({
  openResolution: openResolutionMock,
}));

vi.mock("../../src/services/workspace/build-train", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/workspace/build-train")>();
  return { ...actual, buildWorkspaceTargets: buildWorkspaceTargetsMock };
});

import { publishToFastKv } from "../../src/services/deploy/train";
import { stripLocalDevelopmentTargets } from "../../src/services/resolution/merge";

const bosConfig = {
  account: "dev.everything.near",
  domain: "dev.everything.dev",
  cdn: { origin: "https://cdn.example.test" },
  app: {
    host: {
      development: "local:host",
      production: "https://host.example",
      digest: { manifest: "versions/aaaaaaaaaaaaaaaa.json", integrity: "sha384-host" },
    },
    ui: { development: "local:ui", production: "https://ui.example" },
    api: { development: "local:api", production: "https://api.example" },
  },
  plugins: {
    votes: {
      development: "local:plugins/votes",
      production: "https://votes.example",
    },
  },
} as BosConfig;

const baseInput = {
  bosConfig,
  runtimeConfig: null,
  env: "production" as const,
  build: false,
  dryRun: false,
  verbose: false,
  packages: "",
  privateKey: "ed25519:0000000000000000000000000000000000000000000000000000000000000000",
};

let configDir: string;

describe("publishToFastKv — the confirm loop's transaction-status retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configDir = mkdtempSync(join(tmpdir(), "bos-confirm-retry-"));
    writeFileSync(join(configDir, "bos.config.json"), JSON.stringify(bosConfig, null, 2));
    buildWorkspaceTargetsMock.mockResolvedValue({ built: [], skipped: [], deployResults: [] });
    openResolutionMock.mockResolvedValue({ config: bosConfig, rawConfig: bosConfig });
    resolveSigningStrategyMock.mockResolvedValue({
      strategy: "near-kit",
      privateKey: "ed25519:test",
      source: "provided",
    });
    fetchConfigHistoryMock.mockResolvedValue([]);
    // the registry serves a mutated payload — the config reads back different
    // from what the train publishes, so confirmation must poll and the
    // already-published short-circuit never fires
    fetchBosConfigFromFastKvMock.mockImplementation(async () => ({
      ...JSON.parse(JSON.stringify(bosConfig)),
      title: "stale-registry-value",
    }));
    verifyRollbackSnapshotMock.mockResolvedValue({ verifiable: false, ok: true, slots: [] });
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("resubmits identical bytes once when the transaction is terminal-unapplied", async () => {
    vi.stubEnv("BOS_PUBLISH_CONFIRMATION_TIMEOUT_MS", "300");
    vi.stubEnv("BOS_PUBLISH_CONFIRMATION_INTERVAL_MS", "10");
    submitRegistryWriteMock
      .mockResolvedValueOnce({ success: true, txHash: "tx-dead" })
      .mockResolvedValueOnce({ success: true, txHash: "tx-alive" });
    classifyTransactionOutcomeMock.mockResolvedValueOnce("invalid").mockResolvedValue("included");

    const result = await publishToFastKv({ ...baseInput, configDir });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Timed out waiting for publish confirmation");
    expect(submitRegistryWriteMock).toHaveBeenCalledTimes(2);
    const [first, second] = submitRegistryWriteMock.mock.calls;
    expect(second[0].args).toEqual(first[0].args);
    expect(second[0].method).toBe("__fastdata_kv");
    expect(classifyTransactionOutcomeMock).toHaveBeenCalledWith(
      "tx-dead",
      "dev.everything.near",
      "mainnet",
    );
    expect(classifyTransactionOutcomeMock).toHaveBeenCalledWith(
      "tx-alive",
      "dev.everything.near",
      "mainnet",
    );
  });

  it("never resubmits when the transaction is merely unindexed (included)", async () => {
    vi.stubEnv("BOS_PUBLISH_CONFIRMATION_TIMEOUT_MS", "300");
    vi.stubEnv("BOS_PUBLISH_CONFIRMATION_INTERVAL_MS", "10");
    submitRegistryWriteMock.mockResolvedValue({ success: true, txHash: "tx-float" });
    classifyTransactionOutcomeMock.mockResolvedValue("included");

    const result = await publishToFastKv({ ...baseInput, configDir });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Timed out waiting for publish confirmation");
    expect(submitRegistryWriteMock).toHaveBeenCalledTimes(1);
    expect(classifyTransactionOutcomeMock).toHaveBeenCalledWith(
      "tx-float",
      "dev.everything.near",
      "mainnet",
    );
  });

  it("reports the transaction's fate when both attempts die", async () => {
    vi.stubEnv("BOS_PUBLISH_CONFIRMATION_TIMEOUT_MS", "300");
    vi.stubEnv("BOS_PUBLISH_CONFIRMATION_INTERVAL_MS", "10");
    submitRegistryWriteMock.mockResolvedValue({ success: true, txHash: "tx-dead" });
    classifyTransactionOutcomeMock.mockResolvedValue("invalid");

    const result = await publishToFastKv({ ...baseInput, configDir });

    expect(result.status).toBe("error");
    expect(result.error).toContain("tx-dead");
    expect(submitRegistryWriteMock).toHaveBeenCalledTimes(2);
  });
});
