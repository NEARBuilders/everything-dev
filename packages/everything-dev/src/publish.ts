import { join } from "node:path";
import process from "node:process";
import { readSessionHandle } from "./auth-session";
import { buildWorkspaceTargets, resolveWorkspaceTarget, selectWorkspaceTargets } from "./build";
import { resolveCdnDeployInputs } from "./cdn-deploy";
import { generateCodeArtifacts } from "./code-artifacts";
import {
  loadResolvedConfig,
  readGeneratedConfigFile,
  writeGeneratedConfigFile,
  writeResolvedConfig,
} from "./config";
import type { WorkspaceDeployResult } from "./contract";
import { ensureDelegateKey, submitRegistryWriteDelegated } from "./delegate-signer";
import {
  buildRegistryConfigUrlForNetwork,
  fetchBosConfigFromFastKv,
  getRegistryNamespaceForNetwork,
  type NetworkId,
} from "./fastkv";
import { applyDeployResults, type DeployResultEntry } from "./integrity";
import {
  describeSigningStrategy,
  resolveSigningStrategy,
  type SigningStrategy,
  submitRegistryWrite,
} from "./near-signer";
import { getNetworkIdForAccount } from "./network";
import { platformUrlDeployEntries } from "./platform-deploy";
import { collectDistFiles, uploadWorkspaceDist } from "./storage-upload";
import type { BosConfig, BosConfigInput, PublishConfig, RuntimeConfig } from "./types";
import { padRight } from "./utils/string";
import { colors, icons } from "./utils/theme";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForPublishedConfig(opts: {
  account: string;
  gateway: string;
  publishConfig: BosConfigInput;
  registry?: string;
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
        opts.registry,
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

export async function isConfigAlreadyPublished(opts: {
  account: string;
  gateway: string;
  publishConfig: BosConfigInput;
  registry?: string;
}): Promise<boolean> {
  try {
    const current = await fetchBosConfigFromFastKv<BosConfigInput>(
      `bos://${opts.account}/${opts.gateway}`,
      opts.registry,
    );
    return JSON.stringify(current) === JSON.stringify(opts.publishConfig);
  } catch {
    return false;
  }
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
  wallet?: boolean;
  registry?: string;
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
  const account = isStaging ? (bosConfig.staging?.account ?? bosConfig.account) : bosConfig.account;
  const gateway = isStaging ? (bosConfig.staging?.domain ?? bosConfig.domain) : bosConfig.domain;
  if (!gateway) {
    return {
      status: "error",
      registryUrl: "",
      error: "The config must define domain to publish",
    };
  }

  const network: NetworkId = input.network ?? getNetworkIdForAccount(account);
  const registryUrl = buildRegistryConfigUrlForNetwork(network, account, gateway, input.registry);
  const targets = selectWorkspaceTargets(input.packages, bosConfig);

  let built: string[] | undefined;
  let skipped: string[] | undefined;
  let deployResults: WorkspaceDeployResult[] | undefined;

  const publishAuth: PublishConfig["auth"] = bosConfig.publish?.auth;
  const governsWalletPublish = (publishAuth === "session" || input.wallet) && !input.privateKey;
  if (governsWalletPublish) {
    const session = readSessionHandle(configDir);
    if (!session?.credential) {
      return {
        status: "error",
        registryUrl,
        error:
          (input.wallet ? "--wallet requires" : 'The config sets publish.auth = "session", but') +
          " no CLI session is stored in .bos/ for this project. Run bos login to create one.",
      };
    }
    if (session.credential.accountId && session.credential.accountId !== account) {
      return {
        status: "error",
        registryUrl,
        error:
          `The CLI session was created for ${session.credential.accountId}, but the configured ` +
          `account is ${account}. Gasless wallet publish relays the FastKV write under the session's ` +
          "NEAR account. Run bos login again under the matching account.",
      };
    }
  }
  if (publishAuth && !input.privateKey) {
    if (publishAuth === "custody") {
      return {
        status: "error",
        registryUrl,
        error:
          'The config sets publish.auth = "custody", but custody publish is not implemented yet (see NEARBuilders/everything-dev#291).',
      };
    }
  }

  if (dryRun) {
    return { status: "dry-run", registryUrl, built, skipped };
  }

  const useWallet = input.wallet === true;
  let strategy: SigningStrategy | undefined;
  if (useWallet) {
    console.log(
      `  Signing via ${colors.cyan("gasless NEP-366 delegate action (relayed by the platform relayer)")}`,
    );
  } else {
    try {
      strategy = await resolveSigningStrategy({ privateKey: input.privateKey, account, network });
      console.log(`  Signing via ${colors.cyan(describeSigningStrategy(strategy))}`);
    } catch (error) {
      return {
        status: "error" as const,
        registryUrl,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  if (input.build) {
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
        error: "Failed to reload the config after build",
      };
    }

    bosConfig = refreshed.config;
  }

  // The publish payload is the generated config (`.bos/bos.resolved-config.json`,
  // ADR 0005) — authored composition plus the last deploy's bundle URLs. A
  // first publish on a fresh checkout materializes it from the authored config.
  let generated = readGeneratedConfigFile(configDir);
  if (!generated) {
    writeResolvedConfig(configDir, bosConfig, "production");
    generated = readGeneratedConfigFile(configDir);
    if (!generated) {
      return {
        status: "error",
        registryUrl,
        built,
        skipped,
        deployResults,
        error: "Failed to generate the resolved config under .bos/",
      };
    }
  }
  const { meta: generatedMeta, config: rawConfig } = generated;
  let publishPayload: BosConfigInput = isStaging ? { ...rawConfig, domain: gateway } : rawConfig;

  // CDN deploy (ADR 0020): the resolution chain (env → bos login session →
  // derived from the base's inherited bundle URLs) lives in cdn-deploy.ts.
  // The image keeps only the boot role.
  const session = readSessionHandle(configDir);
  const cdnDeploy = resolveCdnDeployInputs({
    env: process.env as Record<string, string | undefined>,
    runtimeConfig: runtimeConfig ?? null,
    session: session?.credential ?? null,
    account,
    gateway,
  });
  if (cdnDeploy.error) {
    return {
      status: "error",
      registryUrl,
      built,
      skipped,
      deployResults,
      error: cdnDeploy.error,
    };
  }
  const cdnOrigin = cdnDeploy.cdnOrigin;
  const storageOrigin = cdnDeploy.storageOrigin;
  const storageApiKey = cdnDeploy.apiKey;
  const urlOrigin = cdnOrigin ?? `https://${gateway}`;
  const deployTargets = (built ?? []).filter((key) => targets.includes(key));
  const platformEntries: DeployResultEntry[] = [];

  console.log();
  if (cdnOrigin) {
    console.log(`  CDN deploy — uploading workspace dists to ${storageOrigin}...`);
  } else {
    console.log("  Image-native deploy — writing bundle URLs from the runtime origin...");
  }
  for (const key of deployTargets) {
    const ws = resolveWorkspaceTarget(key, bosConfig, runtimeConfig, configDir);
    if (!ws) continue;

    let integrity: string | undefined;
    let ssrIntegrity: string | undefined;
    let fileCount: number | undefined;
    if (cdnOrigin) {
      const result = await uploadWorkspaceDist({
        origin: storageOrigin,
        apiKey: storageApiKey,
        account,
        gateway,
        workspace: key,
        files: await collectDistFiles(join(ws.path, "dist")),
      });
      integrity = result.integrity["remoteEntry.js"];
      ssrIntegrity =
        result.integrity["ssr/remoteEntry.server.js"] ?? result.integrity["remoteEntry.server.js"];
      fileCount = result.stored;
    }

    console.log(
      `    ${colors.green(icons.ok)} ${padRight(key, 28)} → ${urlOrigin}/bundles/${account}/${gateway}/${key}/${fileCount !== undefined ? ` (${fileCount} files)` : ""}`,
    );

    platformEntries.push(
      ...platformUrlDeployEntries({
        origin: urlOrigin,
        account,
        gateway,
        key,
        kind: ws.kind,
        integrity,
        ssrIntegrity,
      }),
    );
  }

  if (platformEntries.length > 0) {
    const merged = applyDeployResults(rawConfig, platformEntries);
    try {
      writeGeneratedConfigFile(configDir, merged, generatedMeta);
    } catch (error) {
      return {
        status: "error",
        registryUrl,
        built,
        skipped,
        deployResults,
        error: `Failed to write bundle URLs to the generated config: ${error instanceof Error ? error.message : error}`,
      };
    }
    publishPayload = (isStaging ? { ...merged, domain: gateway } : merged) as BosConfigInput;
  }

  const registryKey = `apps/${account}/${gateway}/bos.config.json`;
  const registryNamespace = getRegistryNamespaceForNetwork(network, input.registry);
  const publishedAt = new Date().toISOString();
  const registryEntries: Record<string, string> = {
    [registryKey]: JSON.stringify(publishPayload),
  };
  if (input.wallet) {
    const manifestKey = `apps/${account}/${gateway}/manifests/${publishedAt.replace(/[:.]/g, "-")}.json`;
    registryEntries[manifestKey] = JSON.stringify({
      account,
      gateway,
      network,
      publishedAt,
      registryUrl,
    });
  }

  console.log();
  console.log("  Publishing to:");
  console.log(`    ${colors.cyan(registryUrl)}`);
  if (input.wallet) {
    console.log(
      `    ${colors.dim(`+ per-deploy manifest written atomically in the same delegation`)}`,
    );
  }

  try {
    const alreadyPublished = await isConfigAlreadyPublished({
      account,
      gateway,
      publishConfig: publishPayload,
      registry: input.registry,
    });
    if (alreadyPublished) {
      console.log("  Already up to date — skipping transaction");
      return {
        status: "published",
        registryUrl,
        built,
        skipped,
        deployResults,
        publishConfig: publishPayload,
      };
    }

    console.log(`  Submitting transaction on ${network}...`);

    let result: { success: boolean; txHash?: string };
    if (useWallet) {
      const session = readSessionHandle(configDir);
      const credential = session?.credential;
      if (!credential || credential.accountId !== account) {
        return {
          status: "error",
          registryUrl,
          error: `--wallet requires a CLI session under ${account}. Run bos login first.`,
        };
      }
      const record = await ensureDelegateKey({
        configDir,
        account,
        contract: registryNamespace,
        network,
        siteUrl: credential.siteUrl,
      });
      result = await submitRegistryWriteDelegated({
        account,
        contract: registryNamespace,
        network,
        args: registryEntries,
        delegatePrivateKey: record.privateKey,
        relayEndpoint: `${credential.siteUrl}/api/auth/near/relay`,
        apiKey: credential.apiKey,
      });
    } else {
      if (!strategy) {
        return {
          status: "error",
          registryUrl,
          error: "non-wallet publish requires a resolved signing strategy",
        };
      }
      result = await submitRegistryWrite(
        {
          account,
          contract: registryNamespace,
          method: "__fastdata_kv",
          args: registryEntries,
          network,
          privateKey: input.privateKey,
        },
        strategy,
      );
    }

    if (result.txHash) {
      console.log(`  Transaction submitted: ${colors.dim(result.txHash)}`);
    }

    console.log("  Waiting for publish confirmation...");
    await waitForPublishedConfig({
      account,
      gateway,
      publishConfig: publishPayload,
      registry: input.registry,
    });

    return {
      status: "published",
      registryUrl,
      txHash: result.txHash,
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
