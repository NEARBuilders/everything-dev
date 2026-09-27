import { isPrivateKey, Near, type PrivateKey } from "near-kit";
import { FileKeyStore } from "near-kit/keys/file";

import type { NetworkId } from "./fastkv";
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
      `Generate a publish key with: bos key generate`,
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
