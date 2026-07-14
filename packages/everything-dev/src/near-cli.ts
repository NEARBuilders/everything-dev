import { generateKeyPairSync } from "node:crypto";
import { Effect } from "effect";
import { execa } from "execa";
import { colors } from "./utils/theme";

export interface NearTransactionConfig {
  account: string;
  contract: string;
  method: string;
  argsBase64: string;
  network?: "mainnet" | "testnet";
  privateKey?: string;
  gas?: string;
  deposit?: string;
  verbose?: boolean;
}

export interface NearTransactionResult {
  success: true;
  txHash?: string;
  output?: string;
}

export interface NearKeyPair {
  publicKey: string;
  privateKey: string;
}

export interface FunctionCallAccessKeyConfig {
  account: string;
  contract: string;
  allowance: string;
  functionNames: string[];
  network?: "mainnet" | "testnet";
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

export type NearSigningMode =
  | { _tag: "privateKey"; privateKey: string }
  | { _tag: "interactiveKeychain" };

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

const checkNearCliInstalled = Effect.tryPromise({
  try: async () => {
    try {
      await execa("near", ["--version"], { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  },
  catch: () => new Error("Failed to check NEAR CLI"),
});

async function runNearCommand(args: string[]): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new NearTransactionError(
      "No TTY available for keychain signing. Set NEAR_PRIVATE_KEY environment variable to sign locally.",
    );
  }

  await execa("near", args, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
}

export function resolveNearSigningMode(privateKey?: string): NearSigningMode {
  if (privateKey) {
    return { _tag: "privateKey", privateKey };
  }

  if (!process.stdin.isTTY) {
    throw new NearTransactionError(
      "No private key provided and no TTY available for keychain signing. Set NEAR_PRIVATE_KEY environment variable to sign locally.",
    );
  }

  console.log(
    colors.yellow(
      "  Warning: No NEAR_PRIVATE_KEY set — falling back to interactive keychain signing.",
    ),
  );
  return { _tag: "interactiveKeychain" };
}

export const ensureNearCli = Effect.gen(function* () {
  const isInstalled = yield* checkNearCliInstalled;
  if (isInstalled) return;

  console.log();
  console.log("  NEAR CLI not found");

  console.log();
  console.log(`  To install manually: curl --proto '=https' --tlsv1.2 -LsSf ${INSTALLER_URL} | sh`);
  console.log();
  yield* Effect.fail(new NearCliNotFoundError());
});

function combineNearOutput(stdout?: string, stderr?: string): string {
  return [stdout, stderr].filter((value) => value && value.trim().length > 0).join("\n");
}

function extractTransactionHash(output: string): string | undefined {
  const match = output.match(/Transaction ID:\s*([A-Za-z0-9]+)/i);
  return match?.[1];
}

export const executeTransaction = (
  config: NearTransactionConfig,
  signingMode?: NearSigningMode,
): Effect.Effect<NearTransactionResult, Error> =>
  Effect.gen(function* () {
    const resolvedSigningMode = signingMode ?? resolveNearSigningMode(config.privateKey);
    const gas = (config.gas || "300Tgas").replace(/\s+/g, "");
    const deposit = (config.deposit || "0NEAR").replace(/\s+/g, "");
    const network = config.network || (config.account.endsWith(".testnet") ? "testnet" : "mainnet");

    const args = [
      "contract",
      "call-function",
      "as-transaction",
      config.contract,
      config.method,
      "base64-args",
      config.argsBase64,
      "prepaid-gas",
      gas,
      "attached-deposit",
      deposit,
      "sign-as",
      config.account,
      "network-config",
      network,
    ];

    if (resolvedSigningMode._tag === "privateKey") {
      args.push("sign-with-plaintext-private-key", resolvedSigningMode.privateKey, "send");
    } else {
      args.push("sign-with-keychain", "send");
    }

    const output = yield* Effect.tryPromise({
      try: async () => {
        const isPrivateKeyMode = resolvedSigningMode._tag === "privateKey";
        const verbose = config.verbose ?? false;

        const proc = execa("near", args, {
          stdin: isPrivateKeyMode ? "ignore" : "inherit",
          stdout: "pipe",
          stderr: "pipe",
          reject: false,
          timeout: 5 * 60 * 1000,
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        proc.stdout?.on("data", (chunk: Buffer) => {
          stdoutChunks.push(chunk);
          if (verbose) {
            process.stdout.write(chunk);
          }
        });

        proc.stderr?.on("data", (chunk: Buffer) => {
          stderrChunks.push(chunk);
          if (verbose) {
            process.stderr.write(chunk);
          }
        });

        const result = await proc;
        const stdoutStr = Buffer.concat(stdoutChunks).toString("utf-8");
        const stderrStr = Buffer.concat(stderrChunks).toString("utf-8");
        const combined = combineNearOutput(stdoutStr, stderrStr);
        const txHash = extractTransactionHash(combined);
        const hasCodeDoesNotExist = /CodeDoesNotExist/i.test(combined);

        if (result.exitCode === 0 || hasCodeDoesNotExist) {
          if (hasCodeDoesNotExist) {
            console.log(
              `  ${colors.green("✓")} Transaction confirmed${txHash ? ` ${colors.dim(txHash)}` : ""}`,
            );
          }
          return {
            success: true,
            txHash,
            output: combined || undefined,
          };
        }

        throw new NearTransactionError(
          combined || `Transaction failed with code ${result.exitCode}`,
        );
      },
      catch: (error) => error as Error,
    });

    return {
      success: true,
      txHash: output.txHash,
      output: output.output,
    };
  });

export async function addFunctionCallAccessKey(
  config: FunctionCallAccessKeyConfig,
): Promise<NearKeyPair> {
  const keyPair = generateNearKeyPair();
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
