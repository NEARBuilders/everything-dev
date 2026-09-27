import { describe, expect, it, vi } from "vitest";
import type { ApiClient, useAuthClient } from "@/app";
import {
  publishDaoTenantConfig,
  publishTenantConfigForMode,
  type TenantConfigPublishInput,
} from "./tenant-deploy";

const makeClient = (prepareRegistryConfigWrite: ReturnType<typeof vi.fn>) =>
  ({ apps: { prepareRegistryConfigWrite } }) as unknown as ApiClient;

describe("publishDaoTenantConfig", () => {
  it("prepares the DAO-owned config and submits it through the Trezu signer", async () => {
    const prepareRegistryConfigWrite = vi.fn().mockResolvedValue({
      data: {
        contractId: "dev.everything.near",
        methodName: "__fastdata_kv",
        args: { "apps/chicago.sputnik-dao.near/citynode.app/bos.config.json": "{}" },
        gas: "300 Tgas",
        attachedDeposit: "0 yocto",
      },
    });
    const signTransaction = vi.fn().mockResolvedValue({ transaction: "submitted" });

    await publishDaoTenantConfig(
      makeClient(prepareRegistryConfigWrite),
      {
        daoAccountId: "chicago.sputnik-dao.near",
        gatewayId: "citynode.app",
        baseAccount: "everything.near",
        hostname: "chicago.citynode.app",
        title: "Chicago",
      },
      signTransaction,
    );

    expect(prepareRegistryConfigWrite).toHaveBeenCalledWith({
      accountId: "chicago.sputnik-dao.near",
      gatewayId: "citynode.app",
      config: {
        extends: "bos://everything.near/citynode.app",
        account: "chicago.sputnik-dao.near",
        domain: "chicago.citynode.app",
        title: "Chicago",
        description: "Chicago",
      },
    });
    expect(signTransaction).toHaveBeenCalledWith("chicago.sputnik-dao.near", {
      receiverId: "dev.everything.near",
      methodName: "__fastdata_kv",
      args: { "apps/chicago.sputnik-dao.near/citynode.app/bos.config.json": "{}" },
      gas: "300 Tgas",
      attachedDeposit: "0 yocto",
    });
  });

  it("threads the custom fields into the prepared config", async () => {
    const prepareRegistryConfigWrite = vi.fn().mockResolvedValue({
      data: {
        contractId: "dev.everything.near",
        methodName: "__fastdata_kv",
        args: {},
        gas: "300 Tgas",
        attachedDeposit: "0 yocto",
      },
    });
    const signTransaction = vi.fn().mockResolvedValue({ transaction: "submitted" });

    await publishDaoTenantConfig(
      makeClient(prepareRegistryConfigWrite),
      {
        daoAccountId: "chicago.sputnik-dao.near",
        gatewayId: "citynode.app",
        baseAccount: "everything.near",
        hostname: "chicago.citynode.app",
        title: "Chicago",
        description: "The Chicago node",
        repository: "https://github.com/example/chicago",
        app: {
          ui: { production: "https://cdn.example.com/ui.js", integrity: "sha384-abc" },
        },
      },
      signTransaction,
    );

    expect(prepareRegistryConfigWrite).toHaveBeenCalledWith({
      accountId: "chicago.sputnik-dao.near",
      gatewayId: "citynode.app",
      config: expect.objectContaining({
        description: "The Chicago node",
        repository: "https://github.com/example/chicago",
        app: {
          ui: { production: "https://cdn.example.com/ui.js", integrity: "sha384-abc" },
        },
      }),
    });
  });
});

describe("publishTenantConfigForMode", () => {
  const baseInput = {
    accountId: "chicago.sputnik-dao.near",
    gatewayId: "citynode.app",
    baseAccount: "everything.near",
    hostname: "chicago.citynode.app",
    title: "Chicago",
  } satisfies Omit<TenantConfigPublishInput, "mode">;

  it("refuses to publish without a hostname binding", async () => {
    const apiClient = makeClient(vi.fn());
    const auth = {} as ReturnType<typeof useAuthClient>;
    await expect(
      publishTenantConfigForMode(apiClient, auth, { ...baseInput, hostname: null, mode: "dao" }),
    ).rejects.toThrow("No primary domain binding configured for this tenant");
  });

  it("routes dao mode through the Trezu signer", async () => {
    const prepareRegistryConfigWrite = vi.fn().mockResolvedValue({
      data: {
        contractId: "dev.everything.near",
        methodName: "__fastdata_kv",
        args: {},
        gas: "300 Tgas",
        attachedDeposit: "0 yocto",
      },
    });
    const signTransaction = vi.fn().mockResolvedValue({ transaction: "submitted" });
    const auth = {} as ReturnType<typeof useAuthClient>;

    const result = await publishTenantConfigForMode(
      makeClient(prepareRegistryConfigWrite),
      auth,
      {
        ...baseInput,
        description: "The Chicago node",
        mode: "dao",
      },
      signTransaction,
    );
    expect(prepareRegistryConfigWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ description: "The Chicago node" }),
      }),
    );
    expect(signTransaction).toHaveBeenCalledWith(
      "chicago.sputnik-dao.near",
      expect.objectContaining({ receiverId: "dev.everything.near" }),
    );
    expect(result).toEqual({ transaction: "submitted" });
  });

  it("falls back to the session wallet when no relayer is enabled", async () => {
    const prepareRegistryConfigWrite = vi.fn().mockResolvedValue({
      data: {
        contractId: "dev.everything.near",
        methodName: "__fastdata_kv",
        args: {},
        gas: "300 Tgas",
        attachedDeposit: "0 yocto",
      },
    });
    const send = vi.fn().mockResolvedValue({ transaction: "signed" });
    const functionCall = vi.fn().mockReturnValue({ send });
    const transaction = vi.fn().mockReturnValue({ functionCall });
    const auth = {
      near: {
        ensureConnected: vi.fn().mockResolvedValue(true),
        refreshGasKeyInfo: vi.fn().mockResolvedValue(null),
        getRelayerInfo: vi.fn().mockResolvedValue({ data: { enabled: false } }),
        getAccountId: vi.fn().mockReturnValue("chicago.sputnik-dao.near"),
        getNetwork: vi.fn().mockReturnValue("mainnet"),
        getNearClient: vi.fn().mockReturnValue({ transaction }),
      },
    } as unknown as ReturnType<typeof useAuthClient>;

    const result = await publishTenantConfigForMode(makeClient(prepareRegistryConfigWrite), auth, {
      ...baseInput,
      mode: "platform",
    });

    expect(auth.near.getNearClient).toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledWith("chicago.sputnik-dao.near");
    expect(result).toEqual({ transaction: "signed" });
  });

  it("prefers the session gas key when one is bootstrapped and funded", async () => {
    const prepareRegistryConfigWrite = vi.fn().mockResolvedValue({
      data: {
        contractId: "dev.everything.near",
        methodName: "__fastdata_kv",
        args: { key: "value" },
        gas: "300000000000000",
        attachedDeposit: "0 yocto",
      },
    });
    const sendWithGasKey = vi.fn().mockResolvedValue({ txHash: "gas-key-tx" });
    const auth = {
      near: {
        ensureConnected: vi.fn().mockResolvedValue(true),
        refreshGasKeyInfo: vi.fn().mockResolvedValue({
          accountId: "chicago.sputnik-dao.near",
          publicKey: "ed25519:gaskey",
          networkId: "mainnet",
          balance: "50000000000000000000000",
          numNonces: 4,
        }),
        sendWithGasKey,
        getRelayerInfo: vi.fn(),
        getAccountId: vi.fn().mockReturnValue("chicago.sputnik-dao.near"),
        getNetwork: vi.fn().mockReturnValue("mainnet"),
      },
    } as unknown as ReturnType<typeof useAuthClient>;

    const result = await publishTenantConfigForMode(makeClient(prepareRegistryConfigWrite), auth, {
      ...baseInput,
      mode: "platform",
    });

    expect(sendWithGasKey).toHaveBeenCalledWith({
      receiverId: "dev.everything.near",
      methodName: "__fastdata_kv",
      args: { key: "value" },
      gas: "300000000000000",
    });
    expect(auth.near.getRelayerInfo).not.toHaveBeenCalled();
    expect(result).toEqual({ txHash: "gas-key-tx" });
  });

  it("uses the relayer when the gas key exists but is unfunded", async () => {
    const prepareRegistryConfigWrite = vi.fn().mockResolvedValue({
      data: {
        contractId: "dev.everything.near",
        methodName: "__fastdata_kv",
        args: {},
        gas: "300 Tgas",
        attachedDeposit: "0 yocto",
      },
    });
    const signed = vi.fn().mockResolvedValue("signed-payload");
    const relay = vi.fn().mockResolvedValue({ data: { txHash: "relayed-tx" }, error: null });
    const auth = {
      near: {
        ensureConnected: vi.fn().mockResolvedValue(true),
        refreshGasKeyInfo: vi.fn().mockResolvedValue({
          accountId: "chicago.sputnik-dao.near",
          publicKey: "ed25519:gaskey",
          networkId: "mainnet",
          balance: "0",
          numNonces: 4,
        }),
        buildSignedDelegateAction: signed,
        relayTransaction: relay,
        getRelayerInfo: vi.fn().mockResolvedValue({ data: { enabled: true } }),
        getAccountId: vi.fn().mockReturnValue("chicago.sputnik-dao.near"),
        getNetwork: vi.fn().mockReturnValue("mainnet"),
      },
    } as unknown as ReturnType<typeof useAuthClient>;

    const result = await publishTenantConfigForMode(makeClient(prepareRegistryConfigWrite), auth, {
      ...baseInput,
      mode: "platform",
    });

    expect(signed).toHaveBeenCalled();
    expect(relay).toHaveBeenCalledWith({ payload: "signed-payload" });
    expect(result).toEqual({ data: { txHash: "relayed-tx" }, error: null });
  });

  it("falls back to the relayer when the gas-key send fails mid-flight", async () => {
    const prepareRegistryConfigWrite = vi.fn().mockResolvedValue({
      data: {
        contractId: "dev.everything.near",
        methodName: "__fastdata_kv",
        args: {},
        gas: "300 Tgas",
        attachedDeposit: "0 yocto",
      },
    });
    const signed = vi.fn().mockResolvedValue("signed-payload");
    const relay = vi.fn().mockResolvedValue({ data: { txHash: "relayed-tx" }, error: null });
    const auth = {
      near: {
        ensureConnected: vi.fn().mockResolvedValue(true),
        refreshGasKeyInfo: vi.fn().mockResolvedValue({
          accountId: "chicago.sputnik-dao.near",
          publicKey: "ed25519:gaskey",
          networkId: "mainnet",
          balance: "500000000000000000000000",
          numNonces: 4,
        }),
        sendWithGasKey: vi.fn().mockRejectedValue(new Error("nonce conflict")),
        buildSignedDelegateAction: signed,
        relayTransaction: relay,
        getRelayerInfo: vi.fn().mockResolvedValue({ data: { enabled: true } }),
        getAccountId: vi.fn().mockReturnValue("chicago.sputnik-dao.near"),
        getNetwork: vi.fn().mockReturnValue("mainnet"),
      },
    } as unknown as ReturnType<typeof useAuthClient>;

    const result = await publishTenantConfigForMode(makeClient(prepareRegistryConfigWrite), auth, {
      ...baseInput,
      mode: "platform",
    });

    expect(auth.near.sendWithGasKey).toHaveBeenCalledTimes(1);
    expect(signed).toHaveBeenCalled();
    expect(relay).toHaveBeenCalledWith({ payload: "signed-payload" });
    expect(result).toEqual({ data: { txHash: "relayed-tx" }, error: null });
  });

  it("requires a wallet for platform mode without a relayer", async () => {
    const prepareRegistryConfigWrite = vi.fn().mockResolvedValue({
      data: {
        contractId: "dev.everything.near",
        methodName: "__fastdata_kv",
        args: {},
        gas: "300 Tgas",
        attachedDeposit: "0 yocto",
      },
    });
    const auth = {
      near: {
        ensureConnected: vi.fn().mockResolvedValue(true),
        getRelayerInfo: vi.fn().mockResolvedValue({ data: { enabled: false } }),
        getAccountId: vi.fn().mockReturnValue(null),
        getNetwork: vi.fn().mockReturnValue("mainnet"),
      },
    } as unknown as ReturnType<typeof useAuthClient>;

    await expect(
      publishTenantConfigForMode(makeClient(prepareRegistryConfigWrite), auth, {
        ...baseInput,
        mode: "platform",
      }),
    ).rejects.toThrow("Connect a NEAR wallet first");
  });

  it("refuses to publish when the connected signer does not own the tenant namespace", async () => {
    const prepareRegistryConfigWrite = vi.fn();
    const auth = {
      near: {
        ensureConnected: vi.fn().mockResolvedValue(true),
        getAccountId: vi.fn().mockReturnValue("alice.near"),
        getNetwork: vi.fn().mockReturnValue("mainnet"),
      },
    } as unknown as ReturnType<typeof useAuthClient>;

    await expect(
      publishTenantConfigForMode(makeClient(prepareRegistryConfigWrite), auth, {
        ...baseInput,
        mode: "platform",
      }),
    ).rejects.toThrow("cannot publish chicago.sputnik-dao.near");
    expect(prepareRegistryConfigWrite).not.toHaveBeenCalled();
  });

  it("requires the wallet network that owns the tenant namespace", async () => {
    const prepareRegistryConfigWrite = vi.fn();
    const auth = {
      near: {
        ensureConnected: vi.fn().mockResolvedValue(true),
        getAccountId: vi.fn().mockReturnValue("chicago.sputnik-dao.near"),
        getNetwork: vi.fn().mockReturnValue("testnet"),
      },
    } as unknown as ReturnType<typeof useAuthClient>;

    await expect(
      publishTenantConfigForMode(makeClient(prepareRegistryConfigWrite), auth, {
        ...baseInput,
        mode: "platform",
      }),
    ).rejects.toThrow("Switch your wallet to mainnet");
    expect(prepareRegistryConfigWrite).not.toHaveBeenCalled();
  });
});
