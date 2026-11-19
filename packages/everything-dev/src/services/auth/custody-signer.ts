import { OutlayerClient, OutlayerError, PolicyDeniedError, WalletFrozenError } from "@outlayer/sdk";
import type { NetworkId } from "../registry/fastkv";
import type { RelayResult } from "./delegate-signer";
import type { CustodyWalletRecord } from "./session";

const PUBLISH_GAS = "30000000000000";
const MIN_GAS_BALANCE = "50000000000000000000000";

const OUTLAYER_HOSTS: Record<NetworkId, string> = {
  mainnet: "https://api.outlayer.ai",
  testnet: "https://testnet-api.outlayer.ai",
};

export interface CustodySubmitOptions {
  contract: string;
  args: Record<string, string>;
  custodyWallet: CustodyWalletRecord;
  idempotencyKey?: string;
}

function custodyClient(custodyWallet: CustodyWalletRecord): OutlayerClient {
  const network = custodyWallet.network;
  return new OutlayerClient({
    apiKey: custodyWallet.apiKey,
    network,
    baseUrl: OUTLAYER_HOSTS[network],
  });
}

export function custodyFundUrl(custodyWallet: CustodyWalletRecord): string {
  return `https://app.outlayer.ai/wallet/fund?to=${custodyWallet.nearAccountId}&amount=0.05&token=near`;
}

export interface CustodyBalanceStatus {
  /** false = the wallet needs funding before a publish can settle */
  ok: boolean;
  /** the funding instruction (balance below minimum) or the network failure detail */
  message: string;
  /** true = the check itself could not run (OutLayer unreachable) — informative only */
  unreachable: boolean;
}

/** Non-throwing balance probe for preflight: a funding gap fails the deploy
 * before the build train; an OutLayer outage only warns (the submit-time
 * check remains the authoritative gate). */
export async function checkCustodyBalance(
  custodyWallet: CustodyWalletRecord,
): Promise<CustodyBalanceStatus> {
  const client = custodyClient(custodyWallet);
  try {
    const { balance } = await client.getBalance({ chain: "near" });
    if (BigInt(balance) < BigInt(MIN_GAS_BALANCE)) {
      return {
        ok: false,
        unreachable: false,
        message:
          `The custody wallet ${custodyWallet.nearAccountId} holds ${balance} yoctoNEAR on ` +
          `${custodyWallet.network}, below the gas minimum. Fund it at ${custodyFundUrl(custodyWallet)}`,
      };
    }
    return { ok: true, unreachable: false, message: balance };
  } catch (error) {
    return {
      ok: true,
      unreachable: true,
      message: `custody balance check skipped (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

export async function ensureCustodyBalance(custodyWallet: CustodyWalletRecord): Promise<void> {
  const client = custodyClient(custodyWallet);
  try {
    const { balance } = await client.getBalance({ chain: "near" });
    if (BigInt(balance) < BigInt(MIN_GAS_BALANCE)) {
      throw new Error(
        `The custody wallet ${custodyWallet.nearAccountId} holds ${balance} yoctoNEAR on ` +
          `${custodyWallet.network}, below the gas minimum. Fund it at ${custodyFundUrl(custodyWallet)}`,
      );
    }
  } catch (error) {
    throw custodyPublishError(error, custodyWallet);
  }
}

export async function submitRegistryWriteCustody(opts: CustodySubmitOptions): Promise<RelayResult> {
  const client = custodyClient(opts.custodyWallet);
  try {
    const result = await client.call({
      receiver_id: opts.contract,
      method_name: "__fastdata_kv",
      args: opts.args,
      gas: PUBLISH_GAS,
      deposit: "0",
      ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
    });
    if (result.status === "failed" || result.status === "rejected") {
      throw new Error(
        `The custody publish did not settle (status ${result.status}). Inspect request ${result.request_id} at the OutLayer dashboard.`,
      );
    }
    if (result.status === "pending_approval") {
      throw new Error(
        `The custody publish needs multisig approval (${result.approved ?? 0}/${result.required ?? "?"} so far). ` +
          "Approve it at the OutLayer dashboard, then re-run the deploy.",
      );
    }
    return { success: true, txHash: result.tx_hash ?? undefined };
  } catch (error) {
    const code: string = error instanceof OutlayerError ? error.code : "";
    if (code === "onchain_tx_failed") {
      return { success: true };
    }
    throw custodyPublishError(error, opts.custodyWallet);
  }
}

/** Manifest attribution for custody deploys (ADR 0046 ticket 05): the
 * coordinator's TEE-held wallet key signs the canonical manifest payload —
 * the same key that signs the registry write, so no new key material exists.
 * The response's public key is the verifying key; the train cross-checks it
 * against the config's `publish.verification.publicKey`. */
export async function signManifestPayloadCustody(
  custodyWallet: CustodyWalletRecord,
  payload: string,
  recipient: string,
): Promise<{ publicKey: string; value: string }> {
  const client = custodyClient(custodyWallet);
  try {
    const result = await client.signMessage({
      message: payload,
      recipient,
      format: "raw",
    });
    const value = result.signature_base64 ?? result.signature;
    if (!value || !result.public_key) {
      throw new Error(
        "The custody wallet signed without returning a signature/public key pair — cannot attribute the manifest",
      );
    }
    return { publicKey: result.public_key, value };
  } catch (error) {
    throw custodyPublishError(error, custodyWallet);
  }
}

function custodyPublishError(error: unknown, custodyWallet: CustodyWalletRecord): unknown {
  if (!(error instanceof OutlayerError)) return error;
  const code: string = error.code;
  const context = custodyWallet.handoffUrl
    ? ` Manage the wallet at ${custodyWallet.handoffUrl}.`
    : "";
  if (error instanceof PolicyDeniedError) {
    return new Error(`The custody wallet policy refused the publish.${context}`);
  }
  if (error instanceof WalletFrozenError) {
    return new Error(`The custody wallet is frozen.${context}`);
  }
  if (code === "insufficient_balance" || code === "wallet_underfunded") {
    const detail = error.message ? ` (${error.message})` : "";
    return new Error(
      `The custody wallet ran out of gas for the publish${detail}. Fund it at ${custodyFundUrl(custodyWallet)}`,
    );
  }
  if (code === "invalid_api_key" || code === "missing_auth") {
    return new Error(
      `The stored custody wallet key was rejected. Re-run \`bos login --custody\` to re-register.`,
    );
  }
  return new Error(`Custody publish failed (${code}): ${error.message}`);
}
