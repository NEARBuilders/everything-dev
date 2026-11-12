import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeSessionHandle } from "../../src/services/auth/session";

const {
  ensureDelegateKeyMock,
  submitRegistryWriteDelegatedMock,
  classifyTransactionOutcomeMock,
  checkPublishKeyHealthMock,
  hasLocalSigningKeyMock,
} = vi.hoisted(() => ({
  ensureDelegateKeyMock: vi.fn(),
  submitRegistryWriteDelegatedMock: vi.fn(),
  classifyTransactionOutcomeMock: vi.fn(),
  checkPublishKeyHealthMock: vi.fn(),
  hasLocalSigningKeyMock: vi.fn(),
}));

vi.mock("../../src/services/auth/delegate-signer", () => ({
  ensureDelegateKey: ensureDelegateKeyMock,
  submitRegistryWriteDelegated: submitRegistryWriteDelegatedMock,
}));

vi.mock("../../src/services/auth/near-signer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/auth/near-signer")>();
  return {
    ...actual,
    classifyTransactionOutcome: classifyTransactionOutcomeMock,
    checkPublishKeyHealth: checkPublishKeyHealthMock,
    hasLocalSigningKey: hasLocalSigningKeyMock,
  };
});

const { fetchBosConfigFromFastKvMock } = vi.hoisted(() => ({
  fetchBosConfigFromFastKvMock: vi.fn(),
}));

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
  };
});

import { preflightPublish } from "../../src/services/deploy/preflight";
import { publishToFastKv } from "../../src/services/deploy/train";
import { stripLocalDevelopmentTargets } from "../../src/services/resolution/merge";
import type { BosConfig } from "../../src/types";

const bosConfig = {
  account: "dev.everything.near",
  domain: "everything.dev",
  app: {
    host: { development: "local:host", production: "https://host.example" },
    ui: { development: "local:ui", production: "https://ui.example" },
    api: { development: "local:api", production: "https://api.example" },
  },
} as BosConfig;

const baseInput = {
  bosConfig,
  runtimeConfig: null,
  env: "production" as const,
  build: false,
  verbose: false,
  packages: "",
};

function sessionFixture(accountId: string | null) {
  return {
    version: 1 as const,
    credential: {
      kind: "session" as const,
      apiKey: "api_test",
      apiKeyId: "key-1",
      accountId,
      label: "test",
      siteUrl: "http://localhost:3003",
      createdAt: new Date().toISOString(),
      expiresAt: null,
    },
    publishKey: null,
    delegateKey: null,
  };
}

describe("publishToFastKv publish.auth guard", () => {
  let configDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "bos-publish-guard-"));
    checkPublishKeyHealthMock.mockResolvedValue({ ok: true });
    hasLocalSigningKeyMock.mockResolvedValue(false);
    savedEnv = {
      NEAR_PRIVATE_KEY: process.env.NEAR_PRIVATE_KEY,
      BOS_NEAR_PRIVATE_KEY: process.env.BOS_NEAR_PRIVATE_KEY,
    };
    delete process.env.NEAR_PRIVATE_KEY;
    delete process.env.BOS_NEAR_PRIVATE_KEY;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    writeSessionGuardCleanup();
  });

  function writeSessionGuardCleanup() {
    rmSync(join(configDir, ".bos"), { recursive: true, force: true });
  }

  it("errors when publish.auth=session but no session exists", async () => {
    const result = await publishToFastKv({
      ...baseInput,
      bosConfig: { ...bosConfig, publish: { auth: "session" } },
      configDir,
      dryRun: true,
    });
    expect(result.status).toBe("error");
    expect(result.error).toContain("bos login");
  });

  it("errors on account mismatch between session and config", async () => {
    writeSessionHandle(configDir, sessionFixture("someone.else.near"));
    const result = await publishToFastKv({
      ...baseInput,
      bosConfig: { ...bosConfig, publish: { auth: "session" } },
      configDir,
      dryRun: true,
    });
    expect(result.status).toBe("error");
    expect(result.error).toContain("someone.else.near");
  });

  it("accepts a session whose account matches the config", async () => {
    writeSessionHandle(configDir, sessionFixture("dev.everything.near"));
    const result = await publishToFastKv({
      ...baseInput,
      bosConfig: { ...bosConfig, publish: { auth: "session" } },
      configDir,
      dryRun: true,
    });
    expect(result.status).toBe("dry-run");
  });

  it("a session without an accountId cannot relay — publish.auth=session fails before the build", async () => {
    writeSessionHandle(configDir, sessionFixture(null));
    const result = await publishToFastKv({
      ...baseInput,
      bosConfig: { ...bosConfig, publish: { auth: "session" } },
      configDir,
      dryRun: true,
    });
    expect(result.status).toBe("error");
    expect(result.error).toContain("no NEAR account");
  });

  it("custody mode without a stored custody wallet fails with the login hint", async () => {
    writeSessionHandle(configDir, sessionFixture("dev.everything.near"));
    const result = await publishToFastKv({
      ...baseInput,
      bosConfig: { ...bosConfig, publish: { auth: "custody" } },
      configDir,
      dryRun: true,
    });
    expect(result.status).toBe("error");
    expect(result.error).toContain("custody");
    expect(result.error).toContain("bos login --custody");
  });

  it("a custody publish without a session credential still passes the guards (uploads use the minted key)", async () => {
    writeSessionHandle(configDir, {
      version: 1,
      credential: null,
      publishKey: null,
      delegateKey: null,
      custodyWallet: {
        apiKey: "wk_test",
        walletId: "wallet-1",
        nearAccountId: "2e6f1f3a9c8d4b2e1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b",
        network: "mainnet",
        handoffUrl: null,
        registeredAt: new Date().toISOString(),
      },
    });
    const result = await publishToFastKv({
      ...baseInput,
      bosConfig: {
        ...bosConfig,
        account: "2e6f1f3a9c8d4b2e1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b",
        publish: { auth: "custody" },
      },
      configDir,
      dryRun: true,
    });
    expect(result.status).toBe("dry-run");
  });

  it("an explicit private key bypasses the session requirement", async () => {
    const result = await publishToFastKv({
      ...baseInput,
      bosConfig: { ...bosConfig, publish: { auth: "session" } },
      configDir,
      dryRun: true,
      privateKey: "ed25519:seed",
    });
    expect(result.status).toBe("dry-run");
  });

  it("an implicit session for the config account resolves to session signing", async () => {
    writeSessionHandle(configDir, sessionFixture("dev.everything.near"));
    const preflight = await preflightPublish({
      bosConfig,
      configDir,
      env: "production",
      build: false,
      dryRun: false,
      packages: "",
    });
    expect(preflight.kind).toBe("ready");
    if (preflight.kind === "ready") {
      expect(preflight.plan.signing.mode).toBe("session");
    }
  });

  it("submits config + manifest atomically through the relay for a logged-in session", async () => {
    writeSessionHandle(configDir, sessionFixture("dev.everything.near"));
    ensureDelegateKeyMock.mockResolvedValue({
      publicKey: "ed25519:delegate",
      privateKey: "ed25519:delegate-secret",
      accountId: "dev.everything.near",
      network: "mainnet",
      contract: "dev.everything.near",
      mintedAt: new Date().toISOString(),
    });
    submitRegistryWriteDelegatedMock.mockResolvedValue({ success: true, txHash: "tx_test" });

    writeFileSync(join(configDir, "bos.config.json"), JSON.stringify(bosConfig, null, 2));

    fetchBosConfigFromFastKvMock.mockReset();
    // Behavior-keyed: every registry read misses until the relay submit has
    // happened, then the read-back serves the raw on-disk config for the
    // confirm legs — another pre-submit train read must not re-choreograph
    // this mock.
    fetchBosConfigFromFastKvMock.mockImplementation(async () => {
      if (submitRegistryWriteDelegatedMock.mock.calls.length === 0) return null;
      return JSON.parse(readFileSync(join(configDir, "bos.config.json"), "utf-8")) as BosConfig;
    });

    const result = await publishToFastKv({
      ...baseInput,
      configDir,
      dryRun: false,
    });

    expect(result.status).toBe("published");
    expect(result.txHash).toBe("tx_test");
    expect(ensureDelegateKeyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        account: "dev.everything.near",
        contract: "dev.everything.near",
        network: "mainnet",
        siteUrl: "http://localhost:3003",
      }),
    );

    const submitted = submitRegistryWriteDelegatedMock.mock.calls[0][0] as {
      account: string;
      contract: string;
      delegatePrivateKey: string;
      relayEndpoint: string;
      apiKey: string;
      args: Record<string, string>;
    };
    const entryKeys = Object.keys(submitted.args);
    expect(entryKeys).toHaveLength(2);
    expect(entryKeys[0]).toBe("apps/dev.everything.near/everything.dev/bos.config.json");
    expect(entryKeys[1]).toMatch(/^apps\/dev\.everything\.near\/everything\.dev\/deploys\//);
    expect(submitted.relayEndpoint).toBe("http://localhost:3003/api/auth/near/relay");
    expect(submitted.apiKey).toBe("api_test");
    expect(submitted.delegatePrivateKey).toBe("ed25519:delegate-secret");
    // the tx-status probe queries by (hash, sender) and only the train's own
    // direct-key broadcast answers it — a relayed tx moves the relayer's
    // signature, so wallet mode must never consult it
    expect(classifyTransactionOutcomeMock).not.toHaveBeenCalled();
  });
});
