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

/** near-kit's default mainnet RPC (free.rpc.fastnear.com) accepts signed
 * broadcasts via send_tx and silently drops them post-acceptance (2026-11-04:
 * every publish broadcast since 02:42 died UNKNOWN_TRANSACTION while the same
 * endpoint served fresh nonce views, from CI runners and local machines
 * alike). NEAR_RPC_URL pins the signing stack to an endpoint with a real
 * transaction pool — set it to https://rpc.mainnet.near.org. Mirrors the
 * auth plugin's dev-wiring convention (plugins/auth/plugin.dev.ts). */
export function resolveNearRpcUrl(): string | undefined {
  return process.env.NEAR_RPC_URL || undefined;
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

export async function hasLocalSigningKey(opts: {
  account: string;
  network: NetworkId;
}): Promise<boolean> {
  try {
    await resolveSigningKey(opts);
    return true;
  } catch {
    return false;
  }
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
      `Run \`bos login\` to sign through your browser (no local key), or set NEAR_PRIVATE_KEY ` +
      `(or BOS_NEAR_PRIVATE_KEY) / store credentials at ` +
      `~/.near-credentials/${opts.network}/${opts.account}.json for direct key signing ` +
      `(mint one with \`bos login --key\`).`,
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

/** The gas one registry write attaches. A FastKV publish targets the codeless
 * namespace account — it executes as CodeDoesNotExist (the designed success
 * state) and burns almost nothing, so 30 Tgas is generous. The previous 300
 * Tgas inflated the prepayment lock to ~0.30 NEAR and pushed under-funded
 * accounts into silent broadcast drops (2026-11-04 outage: NotEnoughBalance
 * surfaced as "dropped at broadcast" on every deploy for 14 hours). */
export const PUBLISH_ATTACHED_GAS = "30 Tgas";
export const PUBLISH_ATTACHED_GAS_UNITS = 30_000_000_000_000n;

/** Admission prices the prepayment at the shard's worst-case gas price, so
 * the publish account must hold attached_gas × gas_price — not burn it. A 2×
 * safety margin covers intra-epoch price adjustment; the head-block
 * `gas_price` under-reports it (observed 2026-11-04: admission priced at
 * ~1.003 nanoNEAR/gas while the head RPC reported 1e8 yoctoNEAR/gas). */
const PUBLISH_BALANCE_SAFETY = 2n;
const PUBLISH_BALANCE_LOW_HEADROOM = 3n;

async function submitWithNearKit(
  tx: RegistryWriteRequest,
  privateKey: string,
): Promise<NearTransactionResult> {
  const near = new Near({
    network: tx.network,
    defaultSignerId: tx.account,
    privateKey: assertPrivateKey(privateKey),
    rpcUrl: resolveNearRpcUrl(),
  });

  let outcome: Awaited<
    ReturnType<ReturnType<ReturnType<Near["transaction"]>["functionCall"]>["send"]>
  >;
  // The builder caches the signed transaction, so its hash survives even when
  // send() throws on the designed execution failure below.
  const pending = near.transaction(tx.account).functionCall(tx.contract, tx.method, tx.args, {
    gas: PUBLISH_ATTACHED_GAS,
    attachedDeposit: "0 yocto",
  });
  let txHash: string | undefined;
  try {
    // EXECUTED_OPTIMISTIC waits for the pool's verdict instead of accepting
    // the hash fire-and-forget: admission rejections (NotEnoughBalance,
    // stale nonce, missing key) surface here with their real reason, never
    // as a silent broadcast the confirm loop can only call "dropped".
    outcome = await pending.send({ waitUntil: "EXECUTED_OPTIMISTIC" });
    txHash = outcome?.transaction?.hash;
  } catch (error) {
    if (error instanceof Error && DESIGNED_EXECUTION_FAILURE.test(error.name)) {
      // The codeless namespace executes every publish as CodeDoesNotExist —
      // that is the designed success state (ADR 0001, action-indexed writes).
      txHash ??= (error as { transaction?: { hash?: string } }).transaction?.hash;
      txHash ??=
        typeof pending.getHash === "function" ? (pending.getHash() ?? undefined) : undefined;
      return { success: true, txHash, signedWith: "env" };
    }
    const rejection = describePublishRejection(error, tx.account);
    if (rejection) throw new NearTransactionError(rejection);
    throw error;
  }

  return { success: true, txHash, signedWith: "env" };
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
  const near = new Near({ network, defaultSignerId: accountId, rpcUrl: resolveNearRpcUrl() });
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

/** One publish prepays 30 Tgas; the floor covers a full-price (1e9 yoctoNEAR
 * per gas unit) inclusion burn of a failed execution. */
const MIN_PUBLISH_ALLOWANCE_YOCTO = 30_000_000_000_000_000_000_000n;

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
  const near = new Near({
    network: input.network,
    defaultSignerId: input.account,
    rpcUrl: resolveNearRpcUrl(),
  });
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

/** Execution failures whose name marks the designed CodeDoesNotExist success
 * (the registry namespace account is codeless). Everything else with the
 * InvalidTxError wire shape is a real admission rejection. */
const DESIGNED_EXECUTION_FAILURE =
  /^(ContractNotDeployedError|FunctionCallError|ContractExecutionError)$/;

/** Turn a near-kit admission rejection into a human reason, or null when the
 * error is not one (execution outcomes are designed success; congestion means
 * the tx lands later). Discriminates on the `InvalidTxError` wire shape the
 * RPC returns for pre-inclusion rejections — e.g. the 2026-11-04 outage where
 * `NotEnoughBalance` surfaced only as "dropped at broadcast". */
export function describePublishRejection(error: unknown, account: string): string | null {
  if (!(error instanceof Error) || error.name !== "InvalidTransactionError") return null;
  const congested =
    Boolean((error as { shardCongested?: boolean }).shardCongested) ||
    Boolean((error as { shardStuck?: boolean }).shardStuck);
  if (congested) return null;
  const invalidTx = (error as { data?: { InvalidTxError?: Record<string, unknown> } }).data
    ?.InvalidTxError;
  if (!invalidTx) return null;
  if (invalidTx.NotEnoughBalance) {
    const { balance, cost } = invalidTx.NotEnoughBalance as { balance: string; cost: string };
    try {
      return (
        `the publish account ${account} holds ${formatNearAmount(BigInt(balance))} NEAR but ` +
        `this publish needs ${formatNearAmount(BigInt(cost))} NEAR to prepay its gas — ` +
        `top up the account`
      );
    } catch {
      return `the publish account ${account} cannot cover this publish's gas prepayment — top up the account`;
    }
  }
  if (invalidTx.InvalidNonce) {
    return `stale nonce — another publish signed with this key in the same window; resubmit`;
  }
  if (invalidTx.AccessKeyDoesNotExist || invalidTx.InvalidSignerKey) {
    return `the signing key is not an access key on ${account} — re-mint with \`bos login --key\``;
  }
  if (invalidTx.Expired) {
    return `the transaction's block reference expired before inclusion — resubmit`;
  }
  return `the transaction was rejected at admission: ${JSON.stringify(invalidTx)}`;
}

/** Format a yoctoNEAR bigint for humans — integer part plus up to 6 decimals,
 * trailing zeros trimmed (0.0000284 stays honest; 300000000000000000000000
 * reads as "0.3"). */
export function formatNearAmount(yocto: bigint): string {
  const whole = yocto / 10n ** 24n;
  const frac = (yocto % 10n ** 24n).toString().padStart(24, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** The admission bound: balance must cover attached gas at the (worst-case)
 * gas price — the burn is nearly zero, the prepayment lock is not. */
export function classifyPublishBalance(
  balance: bigint,
  required: bigint,
): { ok: boolean; low: boolean } {
  const ok = balance >= required;
  return { ok, low: ok && balance < required * PUBLISH_BALANCE_LOW_HEADROOM };
}

export interface PublishBalanceHealth {
  ok: boolean;
  warning?: string;
  error?: string;
}

/** Check the publish account can actually prepay its gas before the build
 * train runs — a balance a hair under the prepayment lock surfaces only as a
 * silent broadcast drop otherwise (the 2026-11-04 outage: 0.30089 NEAR held,
 * 0.30092 NEAR required, every deploy dead for 14 hours). Soft-skips when the
 * registry RPC is unreachable, like the key health check. */
export async function checkPublishBalance(input: {
  account: string;
  network: NetworkId;
}): Promise<PublishBalanceHealth> {
  const near = new Near({
    network: input.network,
    defaultSignerId: input.account,
    rpcUrl: resolveNearRpcUrl(),
  });
  let balance: bigint;
  let minGasPrice: bigint;
  try {
    const [view, config] = await Promise.all([
      near.getBalance(input.account),
      near.rpc.call("EXPERIMENTAL_protocol_config", { finality: "final" }) as Promise<{
        min_gas_price: string;
      }>,
    ]);
    balance = BigInt(view);
    minGasPrice = BigInt(config.min_gas_price);
  } catch {
    return { ok: true, warning: "balance check skipped (registry RPC unreachable)" };
  }
  const required = PUBLISH_ATTACHED_GAS_UNITS * minGasPrice * PUBLISH_BALANCE_SAFETY;
  const classified = classifyPublishBalance(balance, required);
  if (!classified.ok) {
    return {
      ok: false,
      error:
        `the publish account ${input.account} holds ${formatNearAmount(balance)} NEAR but ` +
        `prepaying ${PUBLISH_ATTACHED_GAS} at the current gas price needs ` +
        `${formatNearAmount(required)} NEAR — top up the account`,
    };
  }
  if (classified.low) {
    return {
      ok: true,
      warning:
        `publish account ${input.account} is low: ${formatNearAmount(balance)} NEAR ` +
        `(one publish locks ~${formatNearAmount(required)} NEAR) — top up soon`,
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
