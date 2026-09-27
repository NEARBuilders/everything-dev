import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeSessionHandle } from "../../src/auth-session";

const { ensureDelegateKeyMock, submitRegistryWriteDelegatedMock } = vi.hoisted(() => ({
  ensureDelegateKeyMock: vi.fn(),
  submitRegistryWriteDelegatedMock: vi.fn(),
}));

vi.mock("../../src/delegate-signer", () => ({
  ensureDelegateKey: ensureDelegateKeyMock,
  submitRegistryWriteDelegated: submitRegistryWriteDelegatedMock,
}));

const { fetchBosConfigFromFastKvMock } = vi.hoisted(() => ({
  fetchBosConfigFromFastKvMock: vi.fn(),
}));

vi.mock("../../src/fastkv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/fastkv")>();
  return {
    ...actual,
    fetchBosConfigFromFastKv: fetchBosConfigFromFastKvMock,
  };
});

import { publishToFastKv } from "../../src/publish";
import type { BosConfig } from "../../src/types";

const bosConfig = {
  account: "dev.everything.near",
  domain: "dev.everything.dev",
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

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "bos-publish-guard-"));
  });

  afterEach(() => {
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
    expect(result.error).toContain("Run bos login");
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

  it("a session without an accountId is accepted", async () => {
    writeSessionHandle(configDir, sessionFixture(null));
    const result = await publishToFastKv({
      ...baseInput,
      bosConfig: { ...bosConfig, publish: { auth: "session" } },
      configDir,
      dryRun: true,
    });
    expect(result.status).toBe("dry-run");
  });

  it("rejects the not-yet-implemented custody lane", async () => {
    writeSessionHandle(configDir, sessionFixture("dev.everything.near"));
    const result = await publishToFastKv({
      ...baseInput,
      bosConfig: { ...bosConfig, publish: { auth: "custody" } },
      configDir,
      dryRun: true,
    });
    expect(result.status).toBe("error");
    expect(result.error).toContain("custody");
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

  it("errors when --wallet has no session", async () => {
    const result = await publishToFastKv({
      ...baseInput,
      configDir,
      dryRun: true,
      wallet: true,
    });
    expect(result.status).toBe("error");
    expect(result.error).toContain("--wallet requires");
  });

  it("submits config + manifest atomically through the relay in --wallet mode", async () => {
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
    // isConfigAlreadyPublished → miss, then the confirmation loop reads the raw on-disk config
    fetchBosConfigFromFastKvMock.mockImplementation(async () => {
      const calls = fetchBosConfigFromFastKvMock.mock.calls.length;
      if (calls === 1) return null;
      return JSON.parse(readFileSync(join(configDir, "bos.config.json"), "utf-8")) as BosConfig;
    });

    const result = await publishToFastKv({
      ...baseInput,
      configDir,
      dryRun: false,
      wallet: true,
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
    expect(entryKeys[0]).toBe("apps/dev.everything.near/dev.everything.dev/bos.config.json");
    expect(entryKeys[1]).toMatch(/^apps\/dev\.everything\.near\/dev\.everything\.dev\/manifests\//);
    expect(submitted.relayEndpoint).toBe("http://localhost:3003/api/auth/near/relay");
    expect(submitted.apiKey).toBe("api_test");
    expect(submitted.delegatePrivateKey).toBe("ed25519:delegate-secret");
  });
});
