import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { getBalance: unknown[]; call: unknown[] } = { getBalance: [], call: [] };
let getBalanceImpl: () => Promise<{ balance: string; token: string; account_id: string }>;
let callImpl: () => Promise<unknown>;

vi.mock("@outlayer/sdk", () => {
  class OutlayerError extends Error {
    code: string;
    status: number;
    constructor(opts: { code: string; message: string; status: number }) {
      super(opts.message);
      this.code = opts.code;
      this.status = opts.status;
    }
  }
  class PolicyDeniedError extends OutlayerError {}
  class WalletFrozenError extends OutlayerError {}
  class OutlayerClient {
    constructor(public opts: { apiKey: string; network: string }) {}
    getBalance(query: unknown) {
      calls.getBalance.push(query);
      return getBalanceImpl();
    }
    call(request: unknown) {
      calls.call.push(request);
      return callImpl();
    }
  }
  return { OutlayerClient, OutlayerError, PolicyDeniedError, WalletFrozenError };
});

import type { CustodyWalletRecord } from "../../src/auth-session";
import {
  custodyFundUrl,
  ensureCustodyBalance,
  submitRegistryWriteCustody,
} from "../../src/custody-signer";

const wallet: CustodyWalletRecord = {
  apiKey: "wk_test",
  walletId: "wallet-1",
  nearAccountId: "36842e2f73d0b7b2f2af6e0d94a7a997398c2c09d9cf09ca3fa23b5426fccf88",
  network: "testnet",
  handoffUrl: "https://app.outlayer.ai/wallet?key=wk_test",
  registeredAt: new Date().toISOString(),
};

const NEAR = (amount: number) => `${BigInt(Math.floor(amount * 1e24))}`;

beforeEach(() => {
  calls.getBalance.length = 0;
  calls.call.length = 0;
  getBalanceImpl = async () => ({
    balance: NEAR(1),
    token: "near",
    account_id: wallet.nearAccountId,
  });
  callImpl = async () => ({ request_id: "req-1", status: "success", tx_hash: "txhash-1" });
});

describe("ensureCustodyBalance", () => {
  it("passes when the wallet holds gas", async () => {
    await expect(ensureCustodyBalance(wallet, "testnet")).resolves.toBeUndefined();
    expect(calls.getBalance).toHaveLength(1);
  });

  it("fails with the fund URL when the wallet is empty", async () => {
    getBalanceImpl = async () => ({
      balance: "0",
      token: "near",
      account_id: wallet.nearAccountId,
    });
    const error = await ensureCustodyBalance(wallet, "testnet").catch((e: Error) => e);
    expect(error.message).toContain("below the gas minimum");
    expect(error.message).toContain(custodyFundUrl(wallet));
  });

  it("fails when the balance is below the gas float", async () => {
    getBalanceImpl = async () => ({
      balance: NEAR(0.005),
      token: "near",
      account_id: wallet.nearAccountId,
    });
    await expect(ensureCustodyBalance(wallet, "testnet")).rejects.toThrow("below the gas minimum");
  });
});

describe("submitRegistryWriteCustody", () => {
  const opts = {
    contract: "registry.testnet",
    network: "testnet" as const,
    args: { "apps/x/gateway/bos.config.json": "{}" },
    custodyWallet: wallet,
    idempotencyKey: "bos-publish-fp",
  };

  it("calls __fastdata_kv on the registry contract and returns the tx hash", async () => {
    const result = await submitRegistryWriteCustody(opts);
    expect(result).toEqual({ success: true, txHash: "txhash-1" });
    expect(calls.call[0]).toMatchObject({
      receiver_id: "registry.testnet",
      method_name: "__fastdata_kv",
      args: opts.args,
      gas: "30000000000000",
      deposit: "0",
      idempotencyKey: "bos-publish-fp",
    });
  });

  it("treats an on-chain revert as submitted — the read-back is authoritative", async () => {
    callImpl = async () => {
      throw new (await import("@outlayer/sdk")).OutlayerError({
        code: "onchain_tx_failed",
        message: '{"AccountDoesNotExist":{"account_id":"dev.allthethings.testnet"}}',
        status: 422,
      });
    };
    await expect(submitRegistryWriteCustody(opts)).resolves.toEqual({ success: true });
  });

  it("maps underfunded-at-signing to the fund URL with the coordinator's cost detail", async () => {
    callImpl = async () => {
      throw new (await import("@outlayer/sdk")).OutlayerError({
        code: "wallet_underfunded",
        message: "it holds 0.050 NEAR and the call costs 0.300 NEAR",
        status: 402,
      });
    };
    const error = await submitRegistryWriteCustody(opts).catch((e: Error) => e);
    expect(error.message).toContain("0.300 NEAR");
    expect(error.message).toContain(custodyFundUrl(wallet));
  });

  it("refuses a failed request instead of reporting success", async () => {
    callImpl = async () => ({ request_id: "req-2", status: "failed", tx_hash: null });
    await expect(submitRegistryWriteCustody(opts)).rejects.toThrow(/did not settle.*req-2/);
  });

  it("sends a pending approval back to the dashboard", async () => {
    callImpl = async () => ({
      request_id: "req-3",
      status: "pending_approval",
      approval_id: "a1",
      required: 2,
      approved: 1,
    });
    await expect(submitRegistryWriteCustody(opts)).rejects.toThrow("multisig approval");
  });

  it("maps a policy denial to the handoff URL", async () => {
    callImpl = async () => {
      throw new (await import("@outlayer/sdk")).PolicyDeniedError({
        code: "policy_denied",
        message: "denied",
        status: 403,
      });
    };
    await expect(submitRegistryWriteCustody(opts)).rejects.toThrow(
      /policy refused.*handoff|policy refused.*Manage the wallet/s,
    );
  });

  it("maps a frozen wallet to the handoff URL", async () => {
    callImpl = async () => {
      throw new (await import("@outlayer/sdk")).WalletFrozenError({
        code: "wallet_frozen",
        message: "frozen",
        status: 403,
      });
    };
    await expect(submitRegistryWriteCustody(opts)).rejects.toThrow("frozen");
  });

  it("maps insufficient balance to the fund URL", async () => {
    callImpl = async () => {
      throw new (await import("@outlayer/sdk")).OutlayerError({
        code: "insufficient_balance",
        message: "not enough",
        status: 400,
      });
    };
    await expect(submitRegistryWriteCustody(opts)).rejects.toThrow(custodyFundUrl(wallet));
  });

  it("maps a revoked key to a re-login message", async () => {
    callImpl = async () => {
      throw new (await import("@outlayer/sdk")).OutlayerError({
        code: "invalid_api_key",
        message: "nope",
        status: 401,
      });
    };
    await expect(submitRegistryWriteCustody(opts)).rejects.toThrow("bos login --custody");
  });

  it("passes unknown errors through with their own message", async () => {
    callImpl = async () => {
      throw new Error("socket hangup");
    };
    await expect(submitRegistryWriteCustody(opts)).rejects.toThrow("socket hangup");
  });
});
