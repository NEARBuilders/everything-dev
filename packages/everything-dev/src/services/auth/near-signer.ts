import { isPrivateKey, Near, type PrivateKey, parseKey } from "near-kit";
import { FileKeyStore } from "near-kit/keys/file";
import type { TxStatus } from "../registry/confirm";
import type { NetworkId } from "../registry/fastkv";
import { executeKeychainTransaction, isNearCliInstalled, NearTransactionError } from "./near-cli";

export type SigningKeySource = "provided" | "credentials-file";

export interface ResolvedSigningKey {
  source: SigningKeySource;
  privateKey: string;
}

export interface RegistryWriteRequest {
  account: string;
  contract: string;
  method: string;
  args: Record<string, string>;
  network: NetworkId;
  privateKey?: string;
}

export type SigningStrategy =
  | { strategy: "near-kit"; privateKey: string; source: SigningKeySource }
  | { strategy: "near-cli-keychain" };

export interface NearTransactionResult {
  success: true;
  txHash?: string;
  signedWith: "env" | "credentials-file" | "near-cli-keychain";
}

function assertPrivateKey(key: string): PrivateKey {
  if (!isPrivateKey(key)) {
    throw new NearTransactionError(
      `Invalid private key format: must start with "ed25519:" or "secp256k1:" (got a ${key.length}-character value).`,
    );
  }
  return key as PrivateKey;
}

export async function resolveSigningKey(opts: {
  privateKey?: string;
  account: string;
  network: NetworkId;
}): Promise<ResolvedSigningKey> {
  const explicitKey =
    opts.privateKey || process.env.NEAR_PRIVATE_KEY || process.env.BOS_NEAR_PRIVATE_KEY;
  if (explicitKey) {
    return { source: "provided", privateKey: explicitKey };
  }

  const keyStore = new FileKeyStore("~/.near-credentials", opts.network);
  const keyPair = await keyStore.get(opts.account);
  if (keyPair?.secretKey) {
    return { source: "credentials-file", privateKey: keyPair.secretKey };
  }

  throw new NearTransactionError("No signing key available");
}

export async function resolveSigningStrategy(opts: {
  privateKey?: string;
  account: string;
  network: NetworkId;
}): Promise<SigningStrategy> {
  try {
    const resolved = await resolveSigningKey(opts);
    return { strategy: "near-kit", privateKey: resolved.privateKey, source: resolved.source };
  } catch {
    // fall through to the near-cli-rs keychain
  }

  if (process.stdin.isTTY && (await isNearCliInstalled())) {
    return { strategy: "near-cli-keychain" };
  }

  throw new NearTransactionError(
    `No signing key available for ${opts.account} on ${opts.network}. ` +
      `Set NEAR_PRIVATE_KEY (or BOS_NEAR_PRIVATE_KEY), store credentials at ` +
      `~/.near-credentials/${opts.network}/${opts.account}.json, or sign with the ` +
      `near-cli-rs keychain (install it, then retry from an interactive terminal). ` +
      `Generate a publish key with: bos login --key`,
  );
}

export function describeSigningStrategy(strategy: SigningStrategy): string {
  if (strategy.strategy === "near-cli-keychain") {
    return "near-cli-rs keychain";
  }
  return strategy.source === "provided"
    ? "the environment or --private-key flag"
    : `~/.near-credentials`;
}

async function submitWithNearKit(
  tx: RegistryWriteRequest,
  privateKey: string,
): Promise<NearTransactionResult> {
  const near = new Near({
    network: tx.network,
    defaultSignerId: tx.account,
    privateKey: assertPrivateKey(privateKey),
  });

  const outcome = await near
    .transaction(tx.account)
    .functionCall(tx.contract, tx.method, tx.args, {
      gas: "300 Tgas",
      attachedDeposit: "0 yocto",
    })
    .send({ waitUntil: "NONE" });

  return { success: true, txHash: outcome?.transaction?.hash, signedWith: "env" };
}

export async function submitRegistryWrite(
  tx: RegistryWriteRequest,
  strategy?: SigningStrategy,
): Promise<NearTransactionResult> {
  const resolved = strategy ?? (await resolveSigningStrategy(tx));

  if (resolved.strategy === "near-cli-keychain") {
    const result = await executeKeychainTransaction({
      account: tx.account,
      contract: tx.contract,
      method: tx.method,
      args: tx.args,
      network: tx.network,
    });
    return { ...result, signedWith: "near-cli-keychain" };
  }

  return submitWithNearKit(tx, resolved.privateKey);
}

/** Classify a broadcast transaction for the publish-confirmation machine.
 * The wait level is NONE — one cheap RPC read of the current state, never a
 * wait-for-inclusion poll (the confirmation loop paces itself). The registry
 * namespace account is codeless: publishes execute with CodeDoesNotExist and
 * that is the designed success state, so a failed execution reads as
 * `included` — only a transaction the chain has never seen (`unknown`), a
 * consumed nonce or a missing publish key (`invalid`), or an unusable probe
 * (`unreachable`, informative-only) classify differently. Discrimination goes
 * through near-kit's `error.name` (every class sets it; the classes are not
 * re-exported from the package root). */
export async function classifyTransactionOutcome(
  txHash: string,
  accountId: string,
  network: NetworkId,
): Promise<TxStatus> {
  const near = new Near({ network, defaultSignerId: accountId });
  try {
    await near.getTransactionStatus(txHash, accountId, "NONE");
    return "included";
  } catch (error) {
    if (!(error instanceof Error)) return "unreachable";
    const congested =
      error.name === "InvalidTransactionError" &&
      (Boolean((error as { shardCongested?: boolean }).shardCongested) ||
        Boolean((error as { shardStuck?: boolean }).shardStuck));
    switch (error.name) {
      case "ContractNotDeployedError":
      case "FunctionCallError":
      case "ContractExecutionError":
      case "InvalidTransactionError":
        return congested ? "unknown" : "included";
      case "InvalidNonceError":
      case "AccessKeyDoesNotExistError":
      case "AccountDoesNotExistError":
        return "invalid";
      case "NetworkError":
        return /not found|unknown/i.test(error.message) ? "unknown" : "unreachable";
      default:
        return "unreachable";
    }
  }
}

/** One publish prepays 300 Tgas; the floor covers a full-price (1e9 yoctoNEAR
 * per gas unit) inclusion burn of a failed execution. */
const MIN_PUBLISH_ALLOWANCE_YOCTO = 300_000_000_000_000_000_000_000n;

export interface PublishKeyHealth {
  ok: boolean;
  warning?: string;
  error?: string;
}

interface ScopedAccessKeyPermission {
  receiver_id: string;
  method_names: string[];
  allowance?: string | null;
  balance?: string;
}

/** Verify the signing key exists on the publisher account and is scoped to
 * exactly what a publish calls (`__fastdata_kv` on the registry namespace)
 * before the build train runs — a rotated or exhausted key otherwise surfaces
 * only as an UNKNOWN_TRANSACTION broadcast that never appears on-chain. Probe
 * failures are soft: an unreachable registry RPC must not block an
 * otherwise-valid publish. */
export async function checkPublishKeyHealth(input: {
  account: string;
  contract: string;
  privateKey: string;
  network: NetworkId;
}): Promise<PublishKeyHealth> {
  const near = new Near({ network: input.network, defaultSignerId: input.account });
  const publicKey = parseKey(input.privateKey).publicKey.toString();
  let view: Awaited<ReturnType<Near["getAccessKey"]>>;
  try {
    view = await near.getAccessKey(input.account, publicKey);
  } catch (error) {
    if (!(error instanceof Error)) {
      return { ok: true, warning: "key health check skipped (registry RPC unreachable)" };
    }
    if (error.name === "AccountDoesNotExistError") {
      return {
        ok: false,
        error: `publisher account ${input.account} does not exist on ${input.network}`,
      };
    }
    if (error.name === "AccessKeyDoesNotExistError") {
      return {
        ok: false,
        error: publishKeyRepairHint(input.account, input.contract, publicKey),
      };
    }
    return { ok: true, warning: "key health check skipped (registry RPC unreachable)" };
  }
  if (!view) {
    return { ok: false, error: publishKeyRepairHint(input.account, input.contract, publicKey) };
  }
  const permission = view.permission as
    | "FullAccess"
    | { FunctionCall?: ScopedAccessKeyPermission; GasKeyFunctionCall?: ScopedAccessKeyPermission };
  if (typeof permission !== "object") {
    return { ok: true };
  }
  const isGasKey = "GasKeyFunctionCall" in permission;
  const scoped = isGasKey ? permission.GasKeyFunctionCall : permission.FunctionCall;
  if (!scoped) {
    return { ok: true };
  }
  const kind = isGasKey ? "gas key" : "publish key";
  if (scoped.receiver_id !== input.contract) {
    return {
      ok: false,
      error:
        `the signing ${kind} is scoped to receiver ${scoped.receiver_id}, but publishes call ` +
        `${input.contract} — ${publishKeyRepairHint(input.account, input.contract, publicKey)}`,
    };
  }
  if (scoped.method_names.length > 0 && !scoped.method_names.includes("__fastdata_kv")) {
    return {
      ok: false,
      error:
        `the signing ${kind} is scoped to methods [${scoped.method_names.join(", ")}], but ` +
        `publishes call \`__fastdata_kv\` — ${publishKeyRepairHint(input.account, input.contract, publicKey)}`,
    };
  }
  const capped = scoped.allowance ?? scoped.balance;
  if (capped && BigInt(capped) < MIN_PUBLISH_ALLOWANCE_YOCTO) {
    return {
      ok: false,
      error:
        `the signing ${kind}'s remaining ${isGasKey ? "balance" : "allowance"} (${capped} ` +
        `yoctoNEAR) is below one publish's prepaid gas (~${MIN_PUBLISH_ALLOWANCE_YOCTO} ` +
        "yoctoNEAR) — re-add the key without an allowance cap",
    };
  }
  return { ok: true };
}

function publishKeyRepairHint(account: string, contract: string, publicKey: string): string {
  return (
    `the signing key ${publicKey} is not a publish key on ${account}. Fix on-chain, then re-run: ` +
    `\`near account add-key ${account} ${publicKey} --receiver-id ${contract} ` +
    '--method-names __fastdata_kv network-config mainnet" ' +
    "signed by any existing full-access signer, or re-mint with `bos login --key` and update NEAR_PRIVATE_KEY"
  );
}
