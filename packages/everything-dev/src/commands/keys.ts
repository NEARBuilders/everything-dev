import process from "node:process";
import { Effect } from "effect";
import { parseKey } from "near-kit";
import type { SessionCredential } from "../auth-session";
import { MISSING_CONFIG_MESSAGE } from "../config";
import {
  DEFAULT_DEPLOY_KEY_EXPIRES_IN_SECONDS,
  DEFAULT_LOGIN_EXPIRES_IN_SECONDS,
  type KeyPublishResult,
  type LoginResult,
  type LogoutResult,
} from "../contract";
import { getRegistryNamespaceForAccount } from "../fastkv";
import { deleteAccessKeys } from "../near-cli";
import { getNetworkIdForAccount } from "../network";
import { loginOutlayerCli } from "../outlayer-login";
import type { ResolutionSession } from "../resolution/session";
import { DeviceLoginService, openInBrowser } from "../services/auth/device-login";
import { mintPublishKey, PUBLISH_FUNCTION_NAMES } from "../services/auth/publish-key";
import { SessionStore } from "../services/auth/session-store";
import { SiteClient, type SiteClientShape } from "../services/auth/site-client";
import { colors } from "../utils/theme";
import { type BosBuilder, BosDepsTag } from "./shared";

export function registerKeys(builder: BosBuilder) {
  return {
    keyPublish: builder.keyPublish.effect(function* (_opts, input) {
      const deps = yield* BosDepsTag;
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
          error: MISSING_CONFIG_MESSAGE,
        } satisfies KeyPublishResult;
      }

      return yield* Effect.tryPromise({
        try: () => keyPublishBody(session, input),
        catch: (error) => {
          const account = keyPublishAccount(session, input.env);
          return {
            status: "error" as const,
            account,
            network: account ? getNetworkIdForAccount(account) : ("mainnet" as const),
            env: input.env,
            contract: getRegistryNamespaceForAccount(account, input.registry),
            allowance: input.allowance,
            functionNames: PUBLISH_FUNCTION_NAMES,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        },
      });
    }),

    login: builder.login.effect(function* (_opts, input) {
      const deps = yield* BosDepsTag;
      const deviceLogin = yield* DeviceLoginService;
      const sessions = yield* SessionStore;
      const staging = input.env === "staging";
      const config = deps.session?.config;
      const account = staging
        ? (config?.staging?.account ?? config?.account ?? "")
        : (config?.account ?? "");
      const gateway = staging
        ? (config?.staging?.domain ?? config?.domain ?? "")
        : (config?.domain ?? "");
      const expiresIn =
        input.expiresIn ??
        (input.key ? DEFAULT_DEPLOY_KEY_EXPIRES_IN_SECONDS : DEFAULT_LOGIN_EXPIRES_IN_SECONDS);

      try {
        const siteUrl = resolveLoginSiteUrl(input.site, deps.session, staging);
        let deployKey: { account: string; gateway: string } | undefined;
        if (input.key) {
          if (!account || !gateway) {
            return {
              status: "error" as const,
              siteUrl: siteUrl,
              error:
                "Deploy keys scope to the authored config's account and domain — set both in bos.config.json (or drop --key for a plain login)",
            } satisfies LoginResult;
          }
          deployKey = { account, gateway };
        }
        const login = yield* deviceLogin.start({
          siteUrl,
          device: input.device,
          account: account || undefined,
          custody: input.custody ? { network: getNetworkIdForAccount(account) } : undefined,
          expiresIn,
          deployKey,
        });

        console.log();
        console.log(`  One-time code: ${colors.cyan(login.userCode)}`);
        yield* Effect.catchIf(
          Effect.tryPromise(() => openInBrowser(login.verificationUrl)),
          () => true,
          (error) =>
            Effect.sync(() => console.log(colors.yellow(`  ⚠ ${(error as Error).message}`))),
        );
        console.log();
        console.log(`  Waiting for approval at ${colors.dim(login.verificationUrl)}…`);

        const approval = yield* Effect.tryPromise(() => login.waitForApproval());

        if (!approval.apiKey) {
          return {
            status: "error" as const,
            siteUrl,
            loginUrl: login.verificationUrl,
            error: "Login approved but no CLI credential was created",
          } satisfies LoginResult;
        }

        const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
        const configDir = deps.session?.root ?? process.cwd();
        const existingSession = sessions.read(configDir);
        sessions.write(configDir, {
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
          custodyWallet: approval.custodyWallet ?? existingSession?.custodyWallet ?? null,
        });

        let warning: string | null = null;
        if (input.custody && !approval.custodyWallet) {
          warning =
            "Custody wallet credential could not be fetched after approval. Re-run `bos login --custody` — the wallet is kept server-side.";
        }
        if (account && approval.accountId && approval.accountId !== account) {
          warning = warning
            ? `${warning} Logged in as ${approval.accountId}, but the authored config account is ${account}. Publishes will use the configured account.`
            : `Logged in as ${approval.accountId}, but the authored config account is ${account}. Publishes will use the configured account.`;
        }

        let publishKey: LoginResult["publishKey"] = null;
        if (input.key) {
          try {
            publishKey = yield* Effect.tryPromise(() =>
              exportPublishKey(sessions, account, input.registry),
            );
          } catch (error) {
            warning = `Session stored, but publish-key export failed: ${
              error instanceof Error ? error.message : "unknown error"
            }`;
          }
        }

        let outlayerCli: LoginResult["outlayerCli"] = null;
        const custodyWallet = approval.custodyWallet;
        if (input.custody && custodyWallet) {
          outlayerCli = yield* Effect.tryPromise(() => loginOutlayerCli(custodyWallet));
          if (outlayerCli.status === "error") {
            const failure = `OutLayer CLI login failed: ${outlayerCli.detail}`;
            warning = warning ? `${warning} ${failure}` : failure;
          }
        }

        return {
          status: "logged-in" as const,
          siteUrl,
          accountId: approval.accountId,
          expiresAt,
          loginUrl: login.verificationUrl,
          publishKey,
          deployKey:
            deployKey && approval.apiKey
              ? {
                  key: approval.apiKey.key,
                  account: deployKey.account,
                  gateway: deployKey.gateway,
                }
              : null,
          custodyWallet: approval.custodyWallet
            ? {
                walletId: approval.custodyWallet.walletId,
                nearAccountId: approval.custodyWallet.nearAccountId,
                network: approval.custodyWallet.network,
                handoffUrl: approval.custodyWallet.handoffUrl,
              }
            : null,
          outlayerCli,
          warning,
        } satisfies LoginResult;
      } catch (error) {
        return {
          status: "error" as const,
          siteUrl: input.site ?? "",
          error: error instanceof Error ? error.message : "Unknown error",
        } satisfies LoginResult;
      }
    }),

    logout: builder.logout.effect(function* (_opts, input) {
      const deps = yield* BosDepsTag;
      const siteClient = yield* SiteClient;
      const sessions = yield* SessionStore;
      const configDir = input.configDir ?? deps.session?.root ?? process.cwd();

      try {
        const session = sessions.read(configDir);
        let revokedApiKey = false;
        let removedPublishKey = false;
        let warning: string | null = null;

        const credential = session?.credential;
        if (credential) {
          revokedApiKey = yield* Effect.catchIf(
            Effect.tryPromise(() => revokeApiKey(siteClient, credential)),
            () => true,
            () => Effect.succeed(false),
          );
          if (!revokedApiKey) {
            warning =
              "Could not revoke the API key remotely — revoke it manually under Settings → API keys.";
          }
        }

        if (session?.publishKey) {
          const account = session.credential?.accountId ?? deps.session?.config?.account ?? "";
          sessions.removePublishedKeyFile(
            session.publishKey.network,
            account,
            session.publishKey.publicKey,
          );
          removedPublishKey = true;
          warning = warning
            ? `${warning} Re-run ${colors.cyan("bos login --key")} to re-export a publish key.`
            : "Removed the exported publish key. Re-run bos login --key to re-export one.";
        }

        sessions.delete(configDir);
        return {
          status: "logged-out" as const,
          revokedApiKey,
          removedPublishKey,
          warning,
        } satisfies LogoutResult;
      } catch (error) {
        return {
          status: "error" as const,
          revokedApiKey: false,
          removedPublishKey: false,
          error: error instanceof Error ? error.message : "Unknown error",
        } satisfies LogoutResult;
      }
    }),
  };
}

function keyPublishAccount(
  session: { config: { account?: string; staging?: { account?: string } | undefined } | null },
  env: "production" | "staging",
): string {
  const account =
    env === "staging"
      ? (session.config?.staging?.account ?? session.config?.account)
      : session.config?.account;
  return account ?? "";
}

async function keyPublishBody(
  session: { config: { account?: string; staging?: { account?: string } | undefined } | null },
  input: {
    env: "production" | "staging";
    allowance: string;
    registry?: string;
    removeOldKeys?: boolean;
  },
): Promise<KeyPublishResult> {
  const account = keyPublishAccount(session, input.env);
  const minted = await mintPublishKey({
    account: account ?? "",
    registry: input.registry,
    allowance: input.allowance,
  });

  if (minted.oldKeys.length > 0) {
    console.log();
    console.log(
      `  Found ${minted.oldKeys.length} existing publish key${minted.oldKeys.length > 1 ? "s" : ""}:`,
    );
    for (const k of minted.oldKeys) {
      console.log(`    ${colors.dim(k)}`);
    }

    if (input.removeOldKeys === true) {
      try {
        await deleteAccessKeys(account ?? "", minted.oldKeys, minted.network);
        console.log(
          `  ${colors.green("✓")} Removed ${minted.oldKeys.length} old key${
            minted.oldKeys.length > 1 ? "s" : ""
          }`,
        );
      } catch {
        console.log(
          `  ${colors.yellow("⚠")} Failed to remove old key${
            minted.oldKeys.length > 1 ? "s" : ""
          } (new key still active)`,
        );
      }
    } else {
      console.log(`  ${colors.dim("Old key(s) retained.")}`);
    }
  }

  return {
    status: "published",
    account: account ?? "",
    network: minted.network,
    env: input.env,
    contract: minted.contract,
    allowance: input.allowance,
    functionNames: PUBLISH_FUNCTION_NAMES,
    publicKey: minted.keyPair.publicKey,
    privateKey: minted.keyPair.privateKey,
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

/** `login --key`'s export: the shared mint, then the near-cli-rs keystore
 * handoff (~/.near-credentials) with a 0600 permission fix-up. */
async function exportPublishKey(
  sessions: { nearCredentialsPath: (network: "mainnet" | "testnet", account: string) => string },
  account: string,
  registry: string | undefined,
): Promise<NonNullable<LoginResult["publishKey"]>> {
  const minted = await mintPublishKey({ account, registry });

  const { FileKeyStore } = await import("near-kit/keys/file");
  const keyStore = new FileKeyStore("~/.near-credentials", minted.network);
  await keyStore.add(account, parseNearPrivateKey(minted.keyPair.privateKey));
  try {
    const { statSync, chmodSync } = await import("node:fs");
    const credentialPath = sessions.nearCredentialsPath(minted.network, account);
    if (statSync(credentialPath).mode & 0o077) {
      chmodSync(credentialPath, 0o600);
    }
  } catch {}

  return {
    publicKey: minted.keyPair.publicKey,
    network: minted.network,
    contract: minted.contract,
    exportedTo: sessions.nearCredentialsPath(minted.network, account),
  };
}

function parseNearPrivateKey(privateKey: string): ReturnType<typeof parseKey> {
  return parseKey(privateKey);
}

async function revokeApiKey(
  siteClient: SiteClientShape,
  credential: SessionCredential,
): Promise<boolean> {
  if (!credential.apiKey || !credential.siteUrl) return false;
  try {
    const response = await siteClient.authPost(
      credential.siteUrl,
      "/api-key/delete",
      { keyId: credential.apiKeyId },
      undefined,
      { "x-api-key": credential.apiKey },
      AbortSignal.timeout(10_000),
    );
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}
