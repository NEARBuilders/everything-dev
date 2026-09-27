import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { NearMock, nearCalls, builder, keychainSubmit, nearCliInstalled } = vi.hoisted(() => {
  const nearCalls: Array<Record<string, unknown>> = [];
  const send = vi.fn();
  const functionCall = vi.fn(() => ({ send }));
  const transaction = vi.fn(() => ({ functionCall }));
  class NearMock {
    transaction = transaction;
    constructor(config: Record<string, unknown>) {
      nearCalls.push(config);
    }
  }
  return {
    NearMock,
    nearCalls,
    builder: { send, functionCall, transaction },
    keychainSubmit: vi.fn(),
    nearCliInstalled: vi.fn(),
  };
});

vi.mock("near-kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("near-kit")>();
  return { ...actual, Near: NearMock };
});

vi.mock("../../src/near-cli", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/near-cli")>();
  return {
    ...actual,
    executeKeychainTransaction: keychainSubmit,
    isNearCliInstalled: nearCliInstalled,
  };
});

import {
  describeSigningStrategy,
  resolveSigningKey,
  resolveSigningStrategy,
  submitRegistryWrite,
} from "../../src/near-signer";

const VALID_KEY =
  "ed25519:5dGS92auiST5KtcLpBG3hQXnWUX2ny94BGYHbzup4jhzyYcpisz6TeoSGKhVQNTtcdANs9MJp5tqqPe21aCGjtBx";
const VALID_PUBLIC_KEY = "ed25519:Co6fppChuw6TKA4CkkKP5DKVBgysE6i1BA8oZYw6Tm6N";

function withCredentialsHome(network: string, account: string, privateKey: string): string {
  const home = mkdtempSync(join(tmpdir(), "near-signer-"));
  const credDir = join(home, ".near-credentials", network);
  mkdirSync(credDir, { recursive: true });
  writeFileSync(
    join(credDir, `${account}.json`),
    JSON.stringify({ account_id: account, public_key: VALID_PUBLIC_KEY, private_key: privateKey }),
  );
  return home;
}

describe("resolveSigningKey", () => {
  const originalHome = process.env.HOME;
  const originalNearKey = process.env.NEAR_PRIVATE_KEY;
  const originalBosKey = process.env.BOS_NEAR_PRIVATE_KEY;
  const tempHomes: string[] = [];

  afterEach(() => {
    if (originalNearKey === undefined) delete process.env.NEAR_PRIVATE_KEY;
    else process.env.NEAR_PRIVATE_KEY = originalNearKey;
    if (originalBosKey === undefined) delete process.env.BOS_NEAR_PRIVATE_KEY;
    else process.env.BOS_NEAR_PRIVATE_KEY = originalBosKey;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    for (const home of tempHomes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("prefers an explicitly provided private key", async () => {
    const resolved = await resolveSigningKey({
      privateKey: VALID_KEY,
      account: "v1.citynode.near",
      network: "mainnet",
    });

    expect(resolved).toEqual({ source: "provided", privateKey: VALID_KEY });
  });

  it("falls back to the near-cli credentials file for the account", async () => {
    const home = withCredentialsHome("mainnet", "v1.citynode.near", VALID_KEY);
    tempHomes.push(home);
    process.env.HOME = home;

    const resolved = await resolveSigningKey({
      account: "v1.citynode.near",
      network: "mainnet",
    });

    expect(resolved).toEqual({ source: "credentials-file", privateKey: VALID_KEY });
  });

  it("prefers NEAR_PRIVATE_KEY over the credentials file", async () => {
    const home = withCredentialsHome("mainnet", "v1.citynode.near", VALID_KEY);
    tempHomes.push(home);
    process.env.HOME = home;
    process.env.NEAR_PRIVATE_KEY = VALID_KEY;

    const resolved = await resolveSigningKey({
      account: "v1.citynode.near",
      network: "mainnet",
    });

    expect(resolved).toEqual({ source: "provided", privateKey: VALID_KEY });
  });

  it("throws when no key or credentials file is available", async () => {
    const home = mkdtempSync(join(tmpdir(), "near-signer-"));
    tempHomes.push(home);
    process.env.HOME = home;

    await expect(
      resolveSigningKey({ account: "v1.citynode.near", network: "mainnet" }),
    ).rejects.toThrow(/No signing key available/);
  });
});

describe("resolveSigningStrategy", () => {
  const originalHome = process.env.HOME;
  const originalNearKey = process.env.NEAR_PRIVATE_KEY;
  const originalBosKey = process.env.BOS_NEAR_PRIVATE_KEY;
  const originalTty = process.stdin.isTTY;
  const tempHomes: string[] = [];

  function setTty(value: boolean) {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value });
  }

  beforeEach(() => {
    nearCliInstalled.mockReset();
    keychainSubmit.mockReset();
    setTty(true);
    nearCliInstalled.mockResolvedValue(true);
  });

  afterEach(() => {
    if (originalNearKey === undefined) delete process.env.NEAR_PRIVATE_KEY;
    else process.env.NEAR_PRIVATE_KEY = originalNearKey;
    if (originalBosKey === undefined) delete process.env.BOS_NEAR_PRIVATE_KEY;
    else process.env.BOS_NEAR_PRIVATE_KEY = originalBosKey;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: originalTty,
    });
    for (const home of tempHomes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("resolves the near-kit strategy from an env key", async () => {
    process.env.NEAR_PRIVATE_KEY = VALID_KEY;

    const strategy = await resolveSigningStrategy({
      account: "v1.citynode.near",
      network: "mainnet",
    });

    expect(strategy).toEqual({ strategy: "near-kit", privateKey: VALID_KEY, source: "provided" });
    expect(describeSigningStrategy(strategy)).toContain("--private-key");
  });

  it("resolves the near-cli keychain strategy when no key is available on a TTY", async () => {
    const home = mkdtempSync(join(tmpdir(), "near-signer-"));
    tempHomes.push(home);
    process.env.HOME = home;

    const strategy = await resolveSigningStrategy({
      account: "v1.citynode.near",
      network: "mainnet",
    });

    expect(strategy).toEqual({ strategy: "near-cli-keychain" });
    expect(describeSigningStrategy(strategy)).toContain("keychain");
  });

  it("throws actionable guidance when there is no key, no TTY, and no near CLI", async () => {
    const home = mkdtempSync(join(tmpdir(), "near-signer-"));
    tempHomes.push(home);
    process.env.HOME = home;
    setTty(false);
    nearCliInstalled.mockResolvedValue(false);

    const promise = resolveSigningStrategy({
      account: "v1.citynode.near",
      network: "mainnet",
    });

    await expect(promise).rejects.toThrow(/NEAR_PRIVATE_KEY/);
    await expect(promise).rejects.toThrow(/near-cli-rs keychain/);
  });
});

describe("submitRegistryWrite", () => {
  const originalHome = process.env.HOME;
  const originalNearKey = process.env.NEAR_PRIVATE_KEY;
  const originalBosKey = process.env.BOS_NEAR_PRIVATE_KEY;
  const originalTty = process.stdin.isTTY;
  const tempHomes: string[] = [];

  function setTty(value: boolean) {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value });
  }

  beforeEach(() => {
    nearCalls.length = 0;
    builder.send.mockReset();
    builder.functionCall.mockClear();
    builder.transaction.mockClear();
    keychainSubmit.mockReset();
    setTty(true);
    nearCliInstalled.mockResolvedValue(true);
  });

  afterEach(() => {
    if (originalNearKey === undefined) delete process.env.NEAR_PRIVATE_KEY;
    else process.env.NEAR_PRIVATE_KEY = originalNearKey;
    if (originalBosKey === undefined) delete process.env.BOS_NEAR_PRIVATE_KEY;
    else process.env.BOS_NEAR_PRIVATE_KEY = originalBosKey;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: originalTty,
    });
    for (const home of tempHomes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  const txArgs = {
    account: "v1.citynode.near",
    contract: "dev.everything.near",
    method: "__fastdata_kv",
    args: {
      "apps/v1.citynode.near/citynode.app/bos.config.json": '{"account":"v1.citynode.near"}',
    },
    network: "mainnet" as const,
    privateKey: VALID_KEY,
  };

  it("submits a function call via near-kit and returns the transaction hash", async () => {
    builder.send.mockResolvedValueOnce({ transaction: { hash: "ABCDEF123" } });

    const result = await submitRegistryWrite(txArgs);

    expect(result).toEqual({ success: true, txHash: "ABCDEF123", signedWith: "env" });
    expect(nearCalls[0]).toEqual({
      network: "mainnet",
      defaultSignerId: "v1.citynode.near",
      privateKey: VALID_KEY,
    });
    expect(builder.transaction).toHaveBeenCalledWith("v1.citynode.near");
    expect(builder.functionCall).toHaveBeenCalledWith(
      "dev.everything.near",
      "__fastdata_kv",
      txArgs.args,
      expect.objectContaining({
        gas: expect.stringContaining("Tgas"),
        attachedDeposit: expect.anything(),
      }),
    );
    expect(builder.send).toHaveBeenCalledWith({ waitUntil: "NONE" });
    expect(builder.send).toHaveBeenCalledTimes(1);
  });

  it("propagates near-kit submission errors so callers can format actionable messages", async () => {
    const cause = new Error("does not have enough allowance on this key");
    builder.send.mockRejectedValueOnce(cause);

    await expect(submitRegistryWrite(txArgs)).rejects.toBe(cause);
  });

  it("delegates to the near-cli-rs keychain when no key resolves on a TTY", async () => {
    const home = mkdtempSync(join(tmpdir(), "near-signer-"));
    tempHomes.push(home);
    process.env.HOME = home;
    const { privateKey: _privateKey, ...withoutKey } = txArgs;

    keychainSubmit.mockResolvedValueOnce({ success: true, txHash: "KC123" });

    const result = await submitRegistryWrite(withoutKey);

    expect(result).toEqual({ success: true, txHash: "KC123", signedWith: "near-cli-keychain" });
    expect(keychainSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        account: "v1.citynode.near",
        contract: "dev.everything.near",
        method: "__fastdata_kv",
        args: withoutKey.args,
        network: "mainnet",
      }),
    );
    expect(nearCalls).toHaveLength(0);
  });
});
