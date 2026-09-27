import { generateKeyPairSync } from "node:crypto";
import { Effect } from "effect";
import { execa } from "execa";

export interface NearKeyPair {
  publicKey: string;
  privateKey: string;
}

export interface KeychainTransactionConfig {
  account: string;
  contract: string;
  method: string;
  args: Record<string, string>;
  network: "mainnet" | "testnet";
  verbose?: boolean;
}

export interface KeychainTransactionResult {
  success: true;
  txHash?: string;
}

export interface FunctionCallAccessKeyConfig {
  account: string;
  contract: string;
  allowance: string;
  functionNames: string[];
  network?: "mainnet" | "testnet";
  keyPair?: NearKeyPair;
}

const NEAR_CLI_VERSION = "0.23.5";
const INSTALLER_URL = `https://github.com/near/near-cli-rs/releases/download/v${NEAR_CLI_VERSION}/near-cli-rs-installer.sh`;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export class NearCliNotFoundError extends Error {
  readonly _tag = "NearCliNotFoundError";
  constructor() {
    super("NEAR CLI not found");
  }
}

export class NearTransactionError extends Error {
  readonly _tag = "NearTransactionError";
}

function base64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  return new Uint8Array(Buffer.from(normalized, "base64"));
}

function base58Encode(input: Uint8Array): string {
  if (input.length === 0) return "";

  const digits: number[] = [0];
  for (const byte of input) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let output = "";
  for (const byte of input) {
    if (byte === 0) output += BASE58_ALPHABET[0];
    else break;
  }

  for (let i = digits.length - 1; i >= 0; i--) {
    output += BASE58_ALPHABET[digits[i]!]!;
  }

  return output;
}

export function generateNearKeyPair(): NearKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  const privateJwk = privateKey.export({ format: "jwk" }) as JsonWebKey;

  if (!publicJwk.x || !privateJwk.d) {
    throw new Error("Failed to generate NEAR keypair");
  }

  const publicBytes = base64UrlToBytes(publicJwk.x);
  const privateSeed = base64UrlToBytes(privateJwk.d);
  const secretBytes = new Uint8Array(privateSeed.length + publicBytes.length);
  secretBytes.set(privateSeed, 0);
  secretBytes.set(publicBytes, privateSeed.length);

  return {
    publicKey: `ed25519:${base58Encode(publicBytes)}`,
    privateKey: `ed25519:${base58Encode(secretBytes)}`,
  };
}

export async function isNearCliInstalled(): Promise<boolean> {
  try {
    await execa("near", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function combineNearOutput(stdout?: string, stderr?: string): string {
  return [stdout, stderr].filter((value) => value && value.trim().length > 0).join("\n");
}

function extractTransactionHash(output: string): string | undefined {
  const match = output.match(/Transaction ID:\s*([A-Za-z0-9]+)/i);
  return match?.[1];
}

export async function executeKeychainTransaction(
  config: KeychainTransactionConfig,
): Promise<KeychainTransactionResult> {
  if (!process.stdin.isTTY) {
    throw new NearTransactionError(
      "No TTY available for keychain signing. Set NEAR_PRIVATE_KEY environment variable to sign locally.",
    );
  }

  const gas = "300Tgas";
  const deposit = "0NEAR";
  const argsBase64 = Buffer.from(JSON.stringify(config.args)).toString("base64");

  const args = [
    "contract",
    "call-function",
    "as-transaction",
    config.contract,
    config.method,
    "base64-args",
    argsBase64,
    "prepaid-gas",
    gas,
    "attached-deposit",
    deposit,
    "sign-as",
    config.account,
    "network-config",
    config.network,
    "sign-with-keychain",
    "send",
  ];

  const result = await execa("near", args, {
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
    reject: false,
    timeout: 5 * 60 * 1000,
  });

  const combined = combineNearOutput(result.stdout, result.stderr);
  const txHash = extractTransactionHash(combined);
  const hasCodeDoesNotExist = /CodeDoesNotExist/i.test(combined);

  if (result.exitCode === 0 || hasCodeDoesNotExist) {
    return { success: true, txHash };
  }

  throw new NearTransactionError(combined || `Transaction failed with code ${result.exitCode}`);
}

async function runNearCommand(args: string[]): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new NearTransactionError(
      "No TTY available for keychain signing. Set NEAR_PRIVATE_KEY environment variable to sign locally.",
    );
  }

  await execa("near", args, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
}

export const ensureNearCli = Effect.gen(function* () {
  const isInstalled = yield* Effect.promise(() => isNearCliInstalled());
  if (isInstalled) return;

  console.log();
  console.log("  NEAR CLI not found");

  console.log();
  console.log(`  To install manually: curl --proto '=https' --tlsv1.2 -LsSf ${INSTALLER_URL} | sh`);
  console.log();
  return yield* Effect.fail(new NearCliNotFoundError());
});

export async function listPublishKeys(config: {
  account: string;
  contract: string;
  network: "mainnet" | "testnet";
}): Promise<string[]> {
  const listResult = await execa(
    "near",
    ["account", "list-keys", config.account, "network-config", config.network, "now"],
    { stdout: "pipe", stderr: "pipe", reject: false },
  );

  if (listResult.exitCode !== 0) {
    throw new NearTransactionError(
      `Failed to list account keys: ${listResult.stderr || listResult.stdout || "unknown error"}`,
    );
  }

  const output = listResult.stdout ?? "";
  const oldKeys: string[] = [];

  for (const line of output.split("\n")) {
    if (line.includes(config.contract) && line.includes("__fastdata_kv")) {
      const match = line.match(/ed25519:[A-Za-z0-9]+/);
      if (match) {
        oldKeys.push(match[0]);
      }
    }
  }

  return oldKeys;
}

export async function deleteAccessKeys(
  account: string,
  publicKeys: string[],
  network: "mainnet" | "testnet",
): Promise<void> {
  const args = [
    "account",
    "delete-keys",
    account,
    "public-keys",
    publicKeys.join(","),
    "network-config",
    network,
    "sign-with-keychain",
    "send",
  ];
  await runNearCommand(args);
}

export async function addFunctionCallAccessKey(
  config: FunctionCallAccessKeyConfig,
): Promise<NearKeyPair> {
  const keyPair = config.keyPair ?? generateNearKeyPair();
  const args = [
    "account",
    "add-key",
    config.account,
    "grant-function-call-access",
    "--allowance",
    config.allowance,
    "--contract-account-id",
    config.contract,
    "--function-names",
    config.functionNames.join(", "),
    "use-manually-provided-public-key",
    keyPair.publicKey,
    "network-config",
    config.network || (config.account.endsWith(".testnet") ? "testnet" : "mainnet"),
    "sign-with-keychain",
    "send",
  ];

  await runNearCommand(args);
  return keyPair;
}
