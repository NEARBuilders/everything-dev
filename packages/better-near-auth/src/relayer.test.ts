import { base58 } from "@scure/base";
import type { DBAdapter } from "better-auth/types";
import { generateKey } from "near-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initRelayer } from "./index.js";
import { bytesToHex, encryptPrivateKey } from "./utils.js";

const NETWORK = "testnet" as const;
const RELAYER_CONFIG = {
  whitelistedContracts: ["relay.testnet"],
  maxGasPerTransaction: "300000000000000",
  maxDepositPerTransaction: "0",
} as const;

function createMockAdapter() {
  return {
    findOne: vi.fn(async () => null),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    delete: vi.fn(async () => ({})),
  } as unknown as DBAdapter & {
    findOne: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

const RPC_URL = "https://rpc.testnet.near.org";

describe("initRelayer ephemeral key recovery", () => {
  let adapter: ReturnType<typeof createMockAdapter>;

  beforeEach(() => {
    adapter = createMockAdapter();
  });

  it("recovers the stored keypair when the secret still matches", async () => {
    const keyPair = generateKey();
    const secretKeyBytes = base58.decode(keyPair.secretKey.slice(8));
    const { encrypted, iv } = await encryptPrivateKey(secretKeyBytes, "secret-a");
    adapter.findOne.mockResolvedValue({
      encryptedPrivateKey: encrypted,
      iv,
      createdAt: new Date(0),
      lastUsedAt: new Date(0),
    });

    const state = await initRelayer(
      RELAYER_CONFIG,
      NETWORK,
      adapter,
      "secret-a",
      undefined,
      RPC_URL,
    );

    expect(adapter.delete).not.toHaveBeenCalled();
    expect(adapter.create).not.toHaveBeenCalled();
    expect(state?.mode).toBe("ephemeral");
    expect(state?.accountId).toBe(bytesToHex(keyPair.publicKey.data));
  });

  it("regenerates when the stored key cannot be decrypted under the rotated secret", async () => {
    const { encrypted, iv } = await encryptPrivateKey(
      base58.decode(generateKey().secretKey.slice(8)),
      "old-secret",
    );
    adapter.findOne.mockResolvedValue({
      encryptedPrivateKey: encrypted,
      iv,
      createdAt: new Date(0),
      lastUsedAt: new Date(0),
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = await initRelayer(
      RELAYER_CONFIG,
      NETWORK,
      adapter,
      "rotated-secret",
      undefined,
      RPC_URL,
    );
    warn.mockRestore();

    expect(state?.mode).toBe("ephemeral");
    expect(state?.accountId).not.toHaveLength(0);
    expect(state?.accountId).toMatch(/^[0-9a-f]{64}$/);
    expect(adapter.delete).toHaveBeenCalledWith({
      model: "relayerKey",
      where: [{ field: "network", operator: "eq", value: NETWORK }],
    });
    expect(adapter.create).toHaveBeenCalledTimes(1);
    const created = adapter.create.mock.calls[0]![0] as { data: { accountId: string } };
    expect(created.data.accountId).toBe(state?.accountId);
  });

  it("creates a fresh keypair when no row exists", async () => {
    const warn = vi.spyOn(console, "log").mockImplementation(() => {});
    const state = await initRelayer(RELAYER_CONFIG, NETWORK, adapter, "secret", undefined, RPC_URL);
    warn.mockRestore();

    expect(state?.mode).toBe("ephemeral");
    expect(adapter.delete).not.toHaveBeenCalled();
    expect(adapter.create).toHaveBeenCalledTimes(1);
  });

  it("prefers explicit config without touching the key store table", async () => {
    const explicit = generateKey();
    const state = await initRelayer(
      {
        ...RELAYER_CONFIG,
        accountId: "relayer.testnet",
        privateKey: explicit.secretKey,
      },
      NETWORK,
      adapter,
      undefined,
      undefined,
      RPC_URL,
    );

    expect(state?.mode).toBe("explicit");
    expect(state?.accountId).toBe("relayer.testnet");
    expect(adapter.findOne).not.toHaveBeenCalled();
    expect(adapter.create).not.toHaveBeenCalled();
  });
});
