import process from "node:process";
import { Effect } from "effect";
import { generateAlchemyRun } from "./alchemy";
import { buildWorkspaceTargets, selectWorkspaceTargets } from "./build";
import { generateCodeArtifacts } from "./code-artifacts";
import { loadResolvedConfig } from "./config";
import { findBosConfigPath, readBosConfigSource } from "./config-source";
import type { WorkspaceDeployResult } from "./contract";
import {
  buildRegistryConfigUrlForNetwork,
  fetchBosConfigFromFastKv,
  getRegistryNamespaceForNetwork,
} from "./fastkv";
import { ensureNearCli, executeTransaction, resolveNearSigningMode } from "./near-cli";
import { getNetworkIdForAccount } from "./network";
import type { BosConfig, BosConfigInput, RuntimeConfig } from "./types";
import { padRight } from "./utils/string";
import { colors, icons } from "./utils/theme";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractPublishedUrl(output: string): string | null {
  const deployMatch = output.match(/🚀.*Deployed:\s*(https?:\S+)/);
  if (deployMatch) return deployMatch[1];
  const match = output.match(/https?:\/\/[^\s"'<>]+/g);
  if (!match || match.length === 0) return null;
  return match[match.length - 1] ?? null;
}

export async function waitForPublishedConfig(opts: {
  account: string;
  gateway: string;
  publishConfig: BosConfigInput;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<void> {
  const envTimeoutMs = Number(process.env.BOS_PUBLISH_CONFIRMATION_TIMEOUT_MS);
  const envIntervalMs = Number(process.env.BOS_PUBLISH_CONFIRMATION_INTERVAL_MS);
  const timeoutMs =
    opts.timeoutMs ?? (Number.isFinite(envTimeoutMs) ? envTimeoutMs : undefined) ?? 120_000;
  const intervalMs =
    opts.intervalMs ?? (Number.isFinite(envIntervalMs) ? envIntervalMs : undefined) ?? 3_000;
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const verifiedConfig = await fetchBosConfigFromFastKv<BosConfigInput>(
        `bos://${opts.account}/${opts.gateway}`,
      );

      if (JSON.stringify(verifiedConfig) === JSON.stringify(opts.publishConfig)) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(intervalMs);
  }

  const reason = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(
    `Timed out waiting for publish confirmation at bos://${opts.account}/${opts.gateway}.${reason}`,
  );
}

interface PublishToFastKvInput {
  bosConfig: BosConfig;
  runtimeConfig: RuntimeConfig | null;
  configDir: string;
  env: "production" | "staging";
  build: boolean;
  dryRun: boolean;
  verbose: boolean;
  packages: string;
  network?: "mainnet" | "testnet";
  privateKey?: string;
}

interface PublishToFastKvResult {
  status: "published" | "error" | "dry-run";
  registryUrl: string;
  txHash?: string;
  built?: string[];
  skipped?: string[];
  error?: string;
  publishConfig?: BosConfigInput;
  deployResults?: WorkspaceDeployResult[];
}

export async function publishToFastKv(input: PublishToFastKvInput): Promise<PublishToFastKvResult> {
  const { env, dryRun, configDir } = input;
  let bosConfig = input.bosConfig;
  const runtimeConfig = input.runtimeConfig;

  const isStaging = env === "staging";
  const account = bosConfig.account;
  const gateway = isStaging ? (bosConfig.staging?.domain ?? bosConfig.domain) : bosConfig.domain;
  if (!gateway) {
    return {
      status: "error",
      registryUrl: "",
      error: "bos.config must define a domain to publish",
    };
  }

  const network = input.network ?? getNetworkIdForAccount(account);
  const registryUrl = buildRegistryConfigUrlForNetwork(network, account, gateway);
  const targets = selectWorkspaceTargets(input.packages, bosConfig);

  let built: string[] | undefined;
  let skipped: string[] | undefined;
  let deployResults: WorkspaceDeployResult[] | undefined;

  if (dryRun) {
    return { status: "dry-run", registryUrl, built, skipped };
  }

  const privateKey =
    input.privateKey || process.env.NEAR_PRIVATE_KEY || process.env.BOS_NEAR_PRIVATE_KEY;
  let signingMode: ReturnType<typeof resolveNearSigningMode>;
  try {
    signingMode = resolveNearSigningMode(privateKey);
  } catch (error) {
    return {
      status: "error" as const,
      registryUrl,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  if (input.build) {
    console.log("  Ensuring NEAR CLI...");
    await Effect.runPromise(ensureNearCli);
    console.log("  NEAR CLI ready");

    await generateCodeArtifacts(configDir, bosConfig, {
      env: "production",
      runtimeConfig: runtimeConfig ?? undefined,
    });

    const result = await buildWorkspaceTargets({
      configDir,
      bosConfig,
      runtimeConfig,
      targets,
      deploy: true,
      verbose: input.verbose,
    });
    built = result.built;
    skipped = result.skipped;
    deployResults = result.deployResults;

    if (deployResults) {
      const failures = deployResults.filter((r) => !r.success);
      if (failures.length > 0) {
        const total = deployResults.length;
        console.log();
        console.log(
          colors.error(
            `  ${icons.err} Deploy failed — ${failures.length} of ${total} workspace${total > 1 ? "s" : ""} failed`,
          ),
        );
        console.log();
        for (const f of failures) {
          const errorLine = (f.error ?? "Failed").split("\n")[0];
          console.log(`    ${colors.error(icons.err)} ${padRight(f.key, 28)} ${errorLine}`);
        }
        console.log();
        if (!input.verbose) {
          console.log(colors.dim("  Run with --verbose for full build output."));
          console.log();
        }
        return {
          status: "error" as const,
          registryUrl,
          built,
          skipped,
          deployResults,
          error: `${failures.length} of ${total} workspaces failed to deploy`,
        };
      }
    }

    const refreshed = await loadResolvedConfig({ cwd: configDir });
    if (!refreshed?.config) {
      return {
        status: "error",
        registryUrl,
        built,
        skipped,
        deployResults,
        error: "Failed to reload bos.config after build",
      };
    }

    bosConfig = refreshed.config;
  }

  const rawConfigPath = findBosConfigPath(configDir);
  if (!rawConfigPath) {
    return {
      status: "error",
      registryUrl,
      built,
      skipped,
      deployResults,
      error: "No bos.config.toml or bos.config.json found",
    };
  }
  const rawConfig = readBosConfigSource(rawConfigPath);
  const publishPayload: BosConfigInput = isStaging ? { ...rawConfig, domain: gateway } : rawConfig;

  const registryEntries: Record<string, string> = {
    [`apps/${account}/${gateway}/bos.config.json`]: JSON.stringify(publishPayload),
  };

  const payload = JSON.stringify(registryEntries);
  const argsBase64 = Buffer.from(payload).toString("base64");

  console.log();
  console.log("  Publishing to:");
  console.log(`    ${colors.cyan(registryUrl)}`);

  try {
    let txHash: string | undefined;

    console.log(`  Submitting transaction on ${network}...`);

    try {
      const tx = await Effect.runPromise(
        executeTransaction(
          {
            account,
            contract: getRegistryNamespaceForNetwork(network),
            method: "__fastdata_kv",
            argsBase64,
            network,
            privateKey: signingMode._tag === "privateKey" ? signingMode.privateKey : undefined,
            gas: "300Tgas",
            deposit: "0NEAR",
            verbose: input.verbose,
          },
          signingMode,
        ),
      );
      txHash = tx.txHash;
      if (txHash && !tx.output?.includes("CodeDoesNotExist")) {
        console.log(`  Transaction submitted: ${colors.dim(txHash)}`);
      }
    } catch (error) {
      console.log(colors.dim("  Transaction reported an error — verifying publish..."));
      try {
        await waitForPublishedConfig({
          account,
          gateway,
          publishConfig: publishPayload,
          timeoutMs: 30_000,
          intervalMs: 2_000,
        });
        txHash = extractTransactionHash(error);
      } catch {
        throw error;
      }
    }

    console.log("  Waiting for publish confirmation...");
    await waitForPublishedConfig({
      account,
      gateway,
      publishConfig: publishPayload,
    });

    if (bosConfig.deploy) {
      console.log(`  Generating deploy script from [deploy] config...`);
      try {
        generateAlchemyRun(bosConfig.deploy, bosConfig.infra, configDir);
        console.log(`    ${colors.dim("alchemy.run.ts written")}`);
      } catch (err) {
        console.warn(
          `${colors.yellow("  ⚠ Failed to write alchemy.run.ts:")} ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return {
      status: "published",
      registryUrl,
      txHash,
      built,
      skipped,
      deployResults,
      publishConfig: publishPayload,
    };
  } catch (error) {
    return {
      status: "error",
      registryUrl,
      error: formatNearError(error),
      built,
      skipped,
      deployResults,
    };
  }
}

function formatNearError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("does not have enough allowance")) {
    return (
      "The publish access key has insufficient allowance to cover this transaction.\n" +
      "  Regenerate your key with a higher allowance:\n" +
      "    bos key generate\n" +
      `  Original: ${message}`
    );
  }

  if (message.includes("exceeded gas") || message.includes("GasLimitExceeded")) {
    return `Transaction exceeded gas limit.\n  Original: ${message}`;
  }

  if (message.includes("timeout") || message.includes("Timeout")) {
    return `Transaction timed out. Check NEAR network status.\n  Original: ${message}`;
  }

  return message;
}

function extractTransactionHash(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/Transaction ID:\s*([A-Za-z0-9]+)/i);
  return match?.[1];
}
