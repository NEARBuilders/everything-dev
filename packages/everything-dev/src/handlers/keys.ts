import process from "node:process";
import { Clock, Effect } from "effect";
import { parseKey } from "near-kit";
import {
  DEFAULT_DEPLOY_KEY_EXPIRES_IN_SECONDS,
  DEFAULT_LOGIN_EXPIRES_IN_SECONDS,
  type LoginResult,
  type LogoutResult,
} from "../contract";
import { DeviceLoginService, openInBrowser } from "../services/auth/device-login";
import { generateNearKeyPair } from "../services/auth/near-cli";
import { loginOutlayerCli } from "../services/auth/outlayer";
import { mintPublishKey } from "../services/auth/publish-key";
import type { DelegateKeyRecord, SessionCredential } from "../services/auth/session";
import { SessionStore } from "../services/auth/session-store";
import { SiteClient, type SiteClientShape } from "../services/auth/site-client";
import {
  fetchBosConfigFromFastKv,
  getRegistryNamespaceForAccount,
} from "../services/registry/fastkv";
import type { ResolutionSession } from "../services/resolution/session";
import { ResolutionSessionService } from "../services/resolution/session";
import { parseBosRef } from "../utils/bos-ref";
import { formatUnknownError } from "../utils/errors";
import { getNetworkIdForAccount } from "../utils/network";
import { colors } from "../utils/theme";
import type { BosBuilder } from "./shared";

const isoAt = (ms: number): string => new Date(ms).toISOString();

export function registerKeys(builder: BosBuilder) {
  return {
    login: builder.login.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const deviceLogin = yield* DeviceLoginService;
      const sessions = yield* SessionStore;
      const staging = input.env === "staging";
      const config = session?.config;
      const account = staging
        ? (config?.staging?.account ?? config?.account ?? "")
        : (config?.account ?? "");
      const gateway = staging
        ? (config?.staging?.domain ?? config?.domain ?? "")
        : (config?.domain ?? "");
      const expiresIn =
        input.expiresIn ??
        (input.key ? DEFAULT_DEPLOY_KEY_EXPIRES_IN_SECONDS : DEFAULT_LOGIN_EXPIRES_IN_SECONDS);

      // The scoped deploy key (bundles:write for the config's account/gateway)
      // is the session credential whenever the config names both — uploads
      // verify it, so `bos deploy` works right after login.
      let deployKey: { account: string; gateway: string } | undefined;
      if (account && gateway) {
        deployKey = { account, gateway };
      }

      const siteUrl = yield* Effect.promise(() =>
        resolveLoginSiteUrl(input.site, session, staging, input.registry),
      );

      // The gasless-publish delegate key is approved in the same browser trip:
      // the CLI generates the keypair, the approval page adds its public half
      // to the account, and the private half never leaves .bos/session.json.
      const network = getNetworkIdForAccount(account);
      const contract = account ? getRegistryNamespaceForAccount(account, input.registry) : "";
      const existingDelegate = sessions.read(session?.root ?? process.cwd())?.delegateKey ?? null;
      const reusableDelegate =
        existingDelegate &&
        existingDelegate.accountId === account &&
        existingDelegate.contract === contract &&
        existingDelegate.network === network
          ? existingDelegate
          : null;
      const pendingKeyPair =
        account && !reusableDelegate && !input.custody ? generateNearKeyPair() : null;

      const login = yield* deviceLogin
        .start({
          siteUrl,
          device: input.device,
          account: account || undefined,
          custody: input.custody ? { network } : undefined,
          delegate: pendingKeyPair
            ? { pubKey: pendingKeyPair.publicKey, contract, network }
            : undefined,
          expiresIn,
          deployKey,
        })
        .pipe(
          Effect.catchIf(
            () => true,
            (error: Error) => Effect.succeed({ startFailed: formatUnknownError(error) } as const),
          ),
        );
      if ("startFailed" in login) {
        return {
          status: "error" as const,
          siteUrl: input.site ?? "",
          error: login.startFailed,
        } satisfies LoginResult;
      }

      console.log();
      console.log(`  One-time code: ${colors.cyan(login.userCode)}`);
      yield* Effect.catchIf(
        Effect.tryPromise(() => openInBrowser(login.verificationUrl)),
        () => true,
        (error) => Effect.logWarning(colors.yellow(`  ⚠ ${(error as Error).message}`)),
      );
      console.log();
      console.log(`  Waiting for approval at ${colors.dim(login.verificationUrl)}…`);

      const startedMs = yield* Clock.currentTimeMillis;
      return yield* Effect.tryPromise({
        try: async () => {
          const approval = await login.waitForApproval();
          if (!approval.apiKey) {
            return {
              status: "error" as const,
              siteUrl,
              loginUrl: login.verificationUrl,
              error: "Login approved but no CLI credential was created",
            } satisfies LoginResult;
          }

          const expiresAt = isoAt(startedMs + expiresIn * 1000);
          const configDir = session?.root ?? process.cwd();
          const existingSession = sessions.read(configDir);
          let delegateKey: DelegateKeyRecord | null = reusableDelegate;
          let delegateNote: string | null = null;
          if (pendingKeyPair) {
            if (approval.accountId === account) {
              delegateKey = {
                publicKey: pendingKeyPair.publicKey,
                privateKey: pendingKeyPair.privateKey,
                accountId: account,
                network,
                contract,
                mintedAt: isoAt(startedMs),
              };
            } else {
              delegateNote = approval.accountId
                ? `Gasless publish key not installed: signed in as ${approval.accountId}, but the configured account is ${account}.`
                : `Gasless publish key not installed: no NEAR wallet was connected on the approval page (needed to add a key to ${account}).`;
            }
          }
          sessions.write(configDir, {
            version: 1,
            credential: {
              kind: "session",
              apiKey: approval.apiKey.key,
              apiKeyId: approval.apiKey.id,
              accountId: approval.accountId,
              label: input.device ?? siteUrl,
              siteUrl,
              createdAt: isoAt(startedMs),
              expiresAt,
            },
            publishKey: null,
            delegateKey,
            custodyWallet: approval.custodyWallet ?? existingSession?.custodyWallet ?? null,
          });

          let warning: string | null = null;
          if (approval.deployKeyWarning) {
            warning = approval.deployKeyWarning;
          }
          if (delegateNote) {
            warning = warning ? `${warning} ${delegateNote}` : delegateNote;
          }
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
              publishKey = await exportPublishKey(sessions, account, input.registry);
            } catch (error) {
              warning = `Session stored, but publish-key export failed: ${
                error instanceof Error ? error.message : "unknown error"
              }`;
            }
          }

          let outlayerCli: LoginResult["outlayerCli"] = null;
          const custodyWallet = approval.custodyWallet;
          if (input.custody && custodyWallet) {
            outlayerCli = await loginOutlayerCli(custodyWallet);
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
              input.key && deployKey && approval.apiKey && !approval.deployKeyWarning
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
        },
        catch: (error) =>
          ({
            status: "error" as const,
            siteUrl: input.site ?? "",
            error: error instanceof Error ? error.message : "Unknown error",
          }) satisfies LoginResult,
      });
    }),

    logout: builder.logout.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const siteClient = yield* SiteClient;
      const sessions = yield* SessionStore;
      const configDir = input.configDir ?? session?.root ?? process.cwd();

      return yield* Effect.tryPromise({
        try: () => logoutBody({ siteClient, sessions, session }, configDir),
        catch: (error) =>
          ({
            status: "error" as const,
            revokedApiKey: false,
            removedPublishKey: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }) satisfies LogoutResult,
      });
    }),
  };
}

async function logoutBody(
  deps: {
    siteClient: SiteClientShape;
    sessions: SessionStore["Service"];
    session: ResolutionSession | null;
  },
  configDir: string,
): Promise<LogoutResult> {
  const { siteClient, sessions, session } = deps;
  const stored = sessions.read(configDir);
  let revokedApiKey = false;
  let removedPublishKey = false;
  let warning: string | null = null;

  const credential = stored?.credential;
  if (credential) {
    revokedApiKey = await revokeApiKey(siteClient, credential).catch(() => false);
    if (!revokedApiKey) {
      warning =
        "Could not revoke the API key remotely — revoke it manually under Settings → API keys.";
    }
  }

  if (stored?.publishKey) {
    const account = stored.credential?.accountId ?? session?.config?.account ?? "";
    sessions.removePublishedKeyFile(
      stored.publishKey.network,
      account,
      stored.publishKey.publicKey,
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
}

/**
 * The login site hosts the device-approval page, custody registration, and
 * the gasless relay — platform services that live at the **root** of the
 * extends chain, not at the child's own domain. Derived by walking the
 * resolution session's extends chain to its furthest on-chain ancestor and
 * reading that runtime's published `domain`; an explicit `--site` always
 * wins (that is how a local stack is targeted), and a derivation failure
 * falls back to the authored domain.
 */
async function resolveLoginSiteUrl(
  siteInput: string | undefined,
  session: ResolutionSession | null,
  staging: boolean,
  registry?: string,
): Promise<string> {
  if (siteInput) {
    return siteInput.replace(/\/+$/, "");
  }
  if (staging) {
    const stagingDomain = session?.config?.staging?.domain ?? session?.config?.domain;
    return stagingDomain ? `https://${stagingDomain}` : "";
  }
  const derived = await deriveExtendsRootSite(session, registry);
  if (derived) {
    return derived;
  }
  const domain = session?.config?.domain;
  return domain ? `https://${domain}` : "";
}

async function deriveExtendsRootSite(
  session: ResolutionSession | null,
  registry?: string,
): Promise<string | null> {
  const chain = session?.chain ?? [];
  const rootRef = [...chain].reverse().find((ref) => ref.startsWith("bos://"));
  if (!rootRef || !session) {
    return null;
  }
  const parsed = parseBosRef(rootRef);
  if (!parsed) {
    return null;
  }
  try {
    const parent = await fetchBosConfigFromFastKv<{ domain?: string }>(rootRef, registry);
    if (parent?.domain) {
      return `https://${parent.domain}`;
    }
  } catch {
    console.log(
      colors.dim(
        `  Note: could not derive the login site from ${rootRef} — falling back to the authored domain`,
      ),
    );
  }
  return null;
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
