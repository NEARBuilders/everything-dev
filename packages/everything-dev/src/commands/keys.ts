import { join } from "node:path";
import process from "node:process";
import { Context, Effect } from "effect";
import { type KeyPair, parseKey } from "near-kit";
import { openInBrowser, startDeviceLogin } from "../auth-login";
import {
  deleteSessionHandle,
  nearCredentialsPath,
  readSessionHandle,
  removePublishedKeyFile,
  type SessionCredential,
  writeSessionHandle,
} from "../auth-session";
import type { LoginResult } from "../contract";
import { getRegistryNamespaceForAccount } from "../fastkv";
import {
  addFunctionCallAccessKey,
  deleteAccessKeys,
  ensureNearCli,
  generateNearKeyPair,
  listPublishKeys,
} from "../near-cli";
import { getNetworkIdForAccount } from "../network";
import type { ResolutionSession } from "../resolution/session";
import { colors } from "../utils/theme";
import { type BosBuilder, BosDepsTag } from "./shared";

const PUBLISH_FUNCTION_NAMES = ["__fastdata_kv"];

export function registerKeys(builder: BosBuilder) {
  return {
    keyPublish: builder.keyPublish.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const session = deps.session;
      if (!session?.config) {
        return {
          status: "error" as const,
          account: "",
          network: "mainnet" as const,
          env: input.env,
          contract: "",
          allowance: input.allowance,
          functionNames: PUBLISH_FUNCTION_NAMES,
          error: "No bos.config.json found",
        };
      }

      const account =
        input.env === "staging"
          ? (session.config.staging?.account ?? session.config.account)
          : session.config.account;
      const network = getNetworkIdForAccount(account);
      const contract = getRegistryNamespaceForAccount(account, input.registry);
      try {
        await Effect.runPromise(ensureNearCli);

        const oldKeys = await listPublishKeys({ account, contract, network });

        const keyPair = await addFunctionCallAccessKey({
          account,
          contract,
          allowance: input.allowance,
          functionNames: PUBLISH_FUNCTION_NAMES,
          network,
        });

        if (oldKeys.length > 0) {
          console.log();
          console.log(
            `  Found ${oldKeys.length} existing publish key${oldKeys.length > 1 ? "s" : ""}:`,
          );
          for (const k of oldKeys) {
            console.log(`    ${colors.dim(k)}`);
          }

          if (input.removeOldKeys !== false) {
            try {
              await deleteAccessKeys(account, oldKeys, network);
              console.log(
                `  ${colors.green("✓")} Removed ${oldKeys.length} old key${
                  oldKeys.length > 1 ? "s" : ""
                }`,
              );
            } catch {
              console.log(
                `  ${colors.yellow("⚠")} Failed to remove old key${
                  oldKeys.length > 1 ? "s" : ""
                } (new key still active)`,
              );
            }
          } else {
            console.log(`  ${colors.dim("Old key(s) retained.")}`);
          }
        }

        return {
          status: "published" as const,
          account,
          network,
          env: input.env,
          contract,
          allowance: input.allowance,
          functionNames: PUBLISH_FUNCTION_NAMES,
          publicKey: keyPair.publicKey,
          privateKey: keyPair.privateKey,
        };
      } catch (error) {
        return {
          status: "error" as const,
          account,
          network,
          env: input.env,
          contract,
          allowance: input.allowance,
          functionNames: PUBLISH_FUNCTION_NAMES,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    login: builder.login.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const staging = input.env === "staging";
      const account = staging
        ? (deps.session?.config?.staging?.account ?? deps.session?.config?.account ?? "")
        : (deps.session?.config?.account ?? "");

      try {
        const siteUrl = resolveLoginSiteUrl(input.site, deps.session, staging);
        const login = await startDeviceLogin({
          siteUrl,
          device: input.device,
          account: account || undefined,
          expiresIn: input.expiresIn,
        });

        console.log();
        console.log(`  One-time code: ${colors.cyan(login.userCode)}`);
        await openInBrowser(login.verificationUrl).catch((error: unknown) => {
          console.log(colors.yellow(`  ⚠ ${(error as Error).message}`));
        });
        console.log();
        console.log(`  Waiting for approval at ${colors.dim(login.verificationUrl)}…`);

        const approval = await login.waitForApproval();

        if (!approval.apiKey) {
          return {
            status: "error" as const,
            siteUrl,
            loginUrl: login.verificationUrl,
            error: "Login approved but no CLI credential was created",
          };
        }

        const expiresAt = new Date(Date.now() + input.expiresIn * 1000).toISOString();
        writeSessionHandle(deps.session?.root ?? process.cwd(), {
          version: 1,
          credential: {
            kind: "session",
            apiKey: approval.apiKey.key,
            apiKeyId: approval.apiKey.id,
            accountId: approval.accountId,
            label: input.device ?? siteUrl,
            siteUrl,
            createdAt: new Date().toISOString(),
            expiresAt,
          },
          publishKey: null,
          delegateKey: null,
        });

        let warning: string | null = null;
        if (account && approval.accountId && approval.accountId !== account) {
          warning = `Logged in as ${approval.accountId}, but bos.config.json account is ${account}. Publishes will use the configured account.`;
        }

        let publishKey: LoginResult["publishKey"] = null;
        if (input.key) {
          try {
            publishKey = await exportPublishKey(account, input.registry);
          } catch (error) {
            warning = `Session stored, but publish-key export failed: ${
              error instanceof Error ? error.message : "unknown error"
            }`;
          }
        }

        return {
          status: "logged-in" as const,
          siteUrl,
          accountId: approval.accountId,
          expiresAt,
          loginUrl: login.verificationUrl,
          publishKey,
          warning,
        };
      } catch (error) {
        return {
          status: "error" as const,
          siteUrl: input.site ?? "",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    logout: builder.logout.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const configDir = input.configDir ?? deps.session?.root ?? process.cwd();

      try {
        const session = readSessionHandle(configDir);
        let revokedApiKey = false;
        let removedPublishKey = false;
        let warning: string | null = null;

        if (session?.credential) {
          revokedApiKey = await revokeApiKey(session.credential).catch(() => false);
          if (!revokedApiKey) {
            warning =
              "Could not revoke the API key remotely — revoke it manually under Settings → API keys.";
          }
        }

        if (session?.publishKey) {
          const account = session.credential?.accountId ?? deps.session?.config?.account ?? "";
          removePublishedKeyFile(session.publishKey.network, account, session.publishKey.publicKey);
          removedPublishKey = true;
          warning = warning
            ? `${warning} Re-run ${colors.cyan("bos login --key")} to re-export a publish key.`
            : "Removed the exported publish key. Re-run bos login --key to re-export one.";
        }

        deleteSessionHandle(configDir);
        return {
          status: "logged-out" as const,
          revokedApiKey,
          removedPublishKey,
          warning,
        };
      } catch (error) {
        return {
          status: "error" as const,
          revokedApiKey: false,
          removedPublishKey: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),
  };
}

function resolveLoginSiteUrl(
  siteInput: string | undefined,
  session: ResolutionSession | null,
  staging: boolean,
): string {
  if (siteInput) {
    return siteInput.replace(/\/+$/, "");
  }
  if (staging) {
    const stagingDomain = session?.config?.staging?.domain ?? session?.config?.domain;
    return stagingDomain ? `https://${stagingDomain}` : (session?.runtime?.ui?.url ?? "");
  }
  const devUiUrl = session?.runtime?.ui?.url;
  if (devUiUrl && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(devUiUrl)) {
    return devUiUrl.replace(/\/+$/, "");
  }
  const domain = session?.config?.domain;
  return domain ? `https://${domain}` : "";
}

async function exportPublishKey(
  account: string,
  registry: string | undefined,
): Promise<NonNullable<LoginResult["publishKey"]>> {
  if (!account) {
    throw new Error("bos.config.json has no account to export a publish key for");
  }

  await Effect.runPromise(ensureNearCli);

  const network = getNetworkIdForAccount(account);
  const contract = getRegistryNamespaceForAccount(account, registry);
  await listPublishKeys({ account, contract, network });

  const keyPair = generateNearKeyPair();
  await addFunctionCallAccessKey({
    account,
    contract,
    allowance: "1NEAR",
    functionNames: PUBLISH_FUNCTION_NAMES,
    network,
    keyPair,
  });

  const { FileKeyStore } = await import("near-kit/keys/file");
  const keyStore = new FileKeyStore("~/.near-credentials", network);
  await keyStore.add(account, parseNearPrivateKey(keyPair.privateKey));
  try {
    const { statSync, chmodSync } = await import("node:fs");
    const { homedir } = await import("node:os");
    const credentialPath = join(
      homedir(),
      ".near-credentials",
      network === "mainnet" ? "mainnet" : network,
      `${account}.json`,
    );
    if (statSync(credentialPath).mode & 0o077) {
      chmodSync(credentialPath, 0o600);
    }
  } catch {}

  return {
    publicKey: keyPair.publicKey,
    network,
    contract,
    exportedTo: nearCredentialsPath(network, account),
  };
}
function parseNearPrivateKey(privateKey: string): KeyPair {
  return parseKey(privateKey) as KeyPair;
}

async function revokeApiKey(credential: SessionCredential): Promise<boolean> {
  if (!credential.apiKey || !credential.siteUrl) return false;
  try {
    const response = await fetch(`${credential.siteUrl}/api/auth/api-key/delete`, {
      method: "POST",
      headers: {
        "x-api-key": credential.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ keyId: credential.apiKeyId }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
