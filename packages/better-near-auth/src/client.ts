import type { WalletManifest } from "@fastnear/near-connect";
import type { EventMap } from "@fastnear/near-connect/build/types/index.js";
import { hex } from "@scure/base";
import type {
  BetterFetch,
  BetterFetchOption,
  BetterFetchResponse,
  ClientStore,
} from "better-auth/client";
import { atom } from "nanostores";
import type { Near as NearType, PrivateKey, SignedMessage } from "near-kit";
import {
  fromNearConnect,
  generateKey,
  generateNonce,
  Near,
  type TransactionBuilder,
} from "near-kit";
import { PASSKEY_WALLET_UNAVAILABLE } from "./constants.js";
import {
  type GasKeyScope,
  type GasKeyState,
  gasKeyState,
  isGasKeyWallet,
  loadSessionGasKey,
  nextLane,
  resolveGasUnits,
  saveSessionGasKey,
} from "./gas-key-client.js";
import { linkPasskeyWallet } from "./passkey-client.js";
import {
  type NearClientAtoms,
  type NearNetwork,
  type NearState,
  readSessionNearAccountId,
} from "./store.js";
import {
  type AccountId,
  type CheckSubAccountAvailabilityRequestT,
  type CheckSubAccountAvailabilityResponseT,
  type CreateSubAccountRequestT,
  type CreateSubAccountResponseT,
  type DualNetworkConfig,
  type GetRelayerInfoRequestT,
  type ListAccountsResponseT,
  type NearAccount,
  type NonceRequestT,
  type NonceResponseT,
  type ProfileResponseT,
  type RelayerInfo,
  type RelayHistoryResponseT,
  type RelayResponseT,
  type RelayStatusResponseT,
  type SetPrimaryAccountRequestT,
  type SetPrimaryAccountResponseT,
  SUB_ACCOUNT_LABEL_REGEX,
  type VerifyRequestT,
  type VerifyResponseT,
  type ViewContractRequestT,
  type ViewContractResponseT,
} from "./types.js";

export {
  getNearAtoms,
  type NearAtomsSource,
  type NearClientAtoms,
  type NearNetwork,
  type NearState,
} from "./store.js";

export interface AuthCallbacks {
  onSuccess?: () => void;
  onError?: (error: Error & { status?: number; code?: string }) => void;
}

export interface SIWNClientConfig {
  recipient?: string;
  recipients?: DualNetworkConfig<string>;
  networkId?: "mainnet" | "testnet";
  cspNonce?: string;
  wallets?: WalletManifest[];
}

interface SignWithWalletResult {
  signedMessage: SignedMessage;
  accountId: string;
  publicKey: string;
  nonceHex: string;
}

export interface SIWNClientActions {
  near: {
    nonce: (params: NonceRequestT) => Promise<BetterFetchResponse<NonceResponseT>>;
    verify: (params: VerifyRequestT) => Promise<BetterFetchResponse<VerifyResponseT>>;
    getProfile: (accountId?: AccountId) => Promise<BetterFetchResponse<ProfileResponseT>>;
    view: (params: ViewContractRequestT) => Promise<BetterFetchResponse<ViewContractResponseT>>;
    getAccountId: () => string | null;
    getState: () => NearState;
    isWalletConnected: () => boolean;
    detectNearAccount: () => Promise<{
      accountId: string;
      publicKey: string | null;
      networkId: string;
    } | null>;
    ensureConnected: () => Promise<boolean>;
    disconnect: () => Promise<void>;
    link: (callbacks?: AuthCallbacks) => Promise<void>;
    linkPasskeyWallet: (callbacks?: AuthCallbacks) => Promise<{ accountId: string } | null>;
    unlink: (params: {
      accountId: string;
      network?: "mainnet" | "testnet";
    }) => Promise<BetterFetchResponse<{ success: boolean; message: string }>>;
    listAccounts: () => Promise<BetterFetchResponse<ListAccountsResponseT>>;
    setPrimaryAccount: (
      params: SetPrimaryAccountRequestT,
    ) => Promise<BetterFetchResponse<SetPrimaryAccountResponseT>>;
    buildSignedDelegateAction: (
      receiverId: string,
      buildActions: (builder: TransactionBuilder, receiverId: string) => TransactionBuilder,
    ) => Promise<string>;
    relayTransaction: (params: { payload: string }) => Promise<BetterFetchResponse<RelayResponseT>>;
    getRelayStatus: (txHash: string) => Promise<BetterFetchResponse<RelayStatusResponseT>>;
    getRelayerInfo: (
      params?: GetRelayerInfoRequestT,
    ) => Promise<BetterFetchResponse<RelayerInfo & { enabled: boolean }>>;
    relayHistory: () => Promise<BetterFetchResponse<RelayHistoryResponseT>>;
    createSubAccount: (
      params: CreateSubAccountRequestT,
    ) => Promise<BetterFetchResponse<CreateSubAccountResponseT>>;
    checkSubAccountAvailability: (
      params: CheckSubAccountAvailabilityRequestT,
    ) => Promise<BetterFetchResponse<CheckSubAccountAvailabilityResponseT>>;
    getGasKeyScope: () => Promise<BetterFetchResponse<GasKeyScope>>;
    isGasKeyWalletSupported: () => Promise<boolean>;
    addSessionGasKey: (callbacks?: AuthCallbacks) => Promise<void>;
    sendWithGasKey: (params: {
      receiverId: string;
      methodName: string;
      args?: object | Uint8Array;
      gas?: string;
    }) => Promise<{ txHash: string }>;
    refreshGasKeyInfo: () => Promise<GasKeyState>;
    ensureGasKeyFunded: (callbacks?: AuthCallbacks) => Promise<boolean>;
    getGasKeyState: () => GasKeyState;
    setNetwork: (network: "mainnet" | "testnet") => void;
    getNetwork: () => "mainnet" | "testnet";
    getSupportedNetworks: () => ("mainnet" | "testnet")[];
    getRecipient: (network?: "mainnet" | "testnet") => string;
    getNearClient: (network?: "mainnet" | "testnet") => NearType;
  };
  signIn: {
    near: (callbacks?: AuthCallbacks) => Promise<void>;
  };
}

export { DEFAULT_DEVICE_LINK_CLIENT_ID } from "./constants.js";
export { isPasskeyWalletAvailable, type PasskeyWalletNetwork } from "./passkey.js";

/**
 * Executor build of NEAR-DevHub/near-connect-passkey (mainnet only). Bump the
 * version on every executor change — near-connect caches executor code in
 * IndexedDB keyed by `id:version`.
 */
export const passkeyWalletManifest: WalletManifest = {
  id: "passkey",
  version: "1.0.1",
  name: "Passkey",
  icon: "https://trezu.org/icons/passkey.svg",
  description: "Sign in with Face ID, Touch ID, or your device passcode.",
  website: "https://trezu.org",
  executor:
    "https://raw.githubusercontent.com/NEAR-DevHub/near-connect-passkey/refs/heads/main/passkey-executor.js",
  type: "sandbox",
  platform: ["web"],
  features: {
    signMessage: true,
    signTransaction: false,
    signAndSendTransaction: true,
    signAndSendTransactions: true,
    signInWithoutAddKey: true,
    signInAndSignMessage: true,
    addFunctionCallKey: false,
    signDelegateActions: true,
    gasKeys: false,
    mainnet: true,
    testnet: false,
  },
  permissions: {
    storage: true,
  },
};

export const siwnClient = (config: SIWNClientConfig) => {
  const nearState = atom<NearState>(null);
  const walletConnected = atom<boolean>(false);
  const activeNetwork = atom<NearNetwork>(config.networkId || "mainnet");

  const getRecipient = (network?: "mainnet" | "testnet"): string => {
    const net = network || activeNetwork.get();
    if (config.recipients) return config.recipients[net];
    return config.recipient ?? "";
  };

  const getSupportedNetworks = (): ("mainnet" | "testnet")[] => {
    if (config.recipients) return ["mainnet", "testnet"];
    if (config.recipient) return [config.recipient.endsWith(".testnet") ? "testnet" : "mainnet"];
    return ["mainnet"];
  };

  const connectors = new Map<
    "mainnet" | "testnet",
    InstanceType<typeof import("@fastnear/near-connect").NearConnector>
  >();
  const nearClients = new Map<"mainnet" | "testnet", Near>();
  const initializedNetworks = new Set<"mainnet" | "testnet">();
  let connectorModulePromise: Promise<typeof import("@fastnear/near-connect")> | null = null;
  const initPromises = new Map<"mainnet" | "testnet", Promise<boolean>>();

  const loadConnector = async () => {
    connectorModulePromise ??= import("@fastnear/near-connect");
    const { NearConnector } = await connectorModulePromise;
    return NearConnector;
  };

  const handleAccountConnection = async (
    accountId: string,
    publicKey?: string | null,
    network?: "mainnet" | "testnet",
  ) => {
    if (!accountId) return;
    if (network && network !== activeNetwork.get()) return;
    const net = network || activeNetwork.get();
    if (net !== activeNetwork.get()) return;
    nearState.set({
      accountId,
      publicKey: publicKey || null,
      networkId: net,
    });
    walletConnected.set(true);
  };

  const initClientForNetwork = async (
    network: "mainnet" | "testnet",
    $fetch?: BetterFetch,
  ): Promise<boolean> => {
    if (initializedNetworks.has(network)) return true;
    if (initPromises.has(network)) return initPromises.get(network)!;
    if (typeof (globalThis as any).window === "undefined") return false;

    const initPromise = (async () => {
      const NearConnector = await loadConnector();
      const connector = new NearConnector({ network, cspNonce: config.cspNonce });
      for (const manifest of config.wallets ?? []) {
        await connector.registerWallet(manifest).catch(() => {});
      }
      connectors.set(network, connector);

      const near = new Near({
        network,
        wallet: fromNearConnect(connector as unknown as Parameters<typeof fromNearConnect>[0]),
      });
      nearClients.set(network, near);

      connector.on("wallet:signIn", async (data: EventMap["wallet:signIn"]) => {
        const accountId = data.accounts?.[0]?.accountId;
        const publicKey = data.accounts?.[0]?.publicKey;
        if (accountId) {
          await handleAccountConnection(accountId, publicKey, network);
        }
      });

      connector.on("wallet:signOut", () => {
        if (activeNetwork.get() !== network) return;
        walletConnected.set(false);
        const state = nearState.get();
        if (state?.networkId === network) {
          nearState.set({
            accountId: state.accountId,
            publicKey: null,
            networkId: state.networkId,
          });
        }
      });

      void connector
        .getConnectedWallet()
        .then(({ accounts }) => {
          if (activeNetwork.get() !== network) return;
          const account = accounts?.[0];
          const state = nearState.get();
          if (account?.accountId && !state) {
            nearState.set({
              accountId: account.accountId,
              publicKey: account.publicKey ?? null,
              networkId: network,
            });
          }
          if (account?.accountId) {
            walletConnected.set(true);
          }
        })
        .catch(() => {});

      initializedNetworks.add(network);

      if ($fetch) {
        void restoreFromSession($fetch);
      }

      return true;
    })();

    initPromises.set(network, initPromise);

    try {
      return await initPromise;
    } finally {
      initPromises.delete(network);
    }
  };

  const initClient = async ($fetch?: BetterFetch): Promise<boolean> => {
    const network = activeNetwork.get();
    return initClientForNetwork(network, $fetch);
  };

  let sessionRestored = false;

  const restoreFromSession = async ($fetch: BetterFetch) => {
    if (sessionRestored) return;
    const restoringNetwork = activeNetwork.get();
    const state = nearState.get();
    if (state?.accountId) {
      sessionRestored = true;
      return;
    }

    try {
      const res = await $fetch<ListAccountsResponseT>("/near/list-accounts", { method: "GET" });
      if (activeNetwork.get() !== restoringNetwork) return;
      const accounts = res.data?.accounts;
      if (accounts?.length) {
        const primary =
          res.data?.activeAccount || accounts.find((a: NearAccount) => a.isPrimary) || accounts[0];
        if (primary) {
          nearState.set({
            accountId: primary.accountId,
            publicKey: primary.publicKey ?? null,
            networkId: primary.network,
          });
          activeNetwork.set(primary.network);
        }
      }
    } catch {}
    sessionRestored = true;
  };

  const requireConnector = async (network?: "mainnet" | "testnet") => {
    const net = network || activeNetwork.get();
    await initClientForNetwork(net);
    const connector = connectors.get(net);
    if (!connector)
      throw new Error(
        `Wallet not initialized for ${net} — this operation requires a browser environment`,
      );
    return connector;
  };

  const requireNear = (network?: "mainnet" | "testnet"): Near => {
    const net = network || activeNetwork.get();
    const client = nearClients.get(net);
    if (!client)
      throw new Error(
        `Wallet not initialized for ${net} — this operation requires a browser environment`,
      );
    return client;
  };

  const ensureWalletConnected = async (network?: "mainnet" | "testnet"): Promise<boolean> => {
    const net = network || activeNetwork.get();
    const conn = await requireConnector(net);
    if (walletConnected.get()) {
      try {
        const { accounts } = await conn.getConnectedWallet();
        if (accounts?.length) return true;
      } catch {}
    }

    return new Promise<boolean>((resolve) => {
      const signInHandler = (data: EventMap["wallet:signIn"]) => {
        const accountId = data.accounts?.[0]?.accountId;
        const publicKey = data.accounts?.[0]?.publicKey;
        if (accountId && activeNetwork.get() === net) {
          void handleAccountConnection(accountId, publicKey, net).then(() =>
            resolve(activeNetwork.get() === net),
          );
        } else if (activeNetwork.get() !== net) {
          resolve(false);
        }
      };

      conn.on("wallet:signIn", signInHandler);

      conn
        .connect()
        .catch(() => {})
        .finally(() => {
          conn.off("wallet:signIn", signInHandler);
          if (!walletConnected.get()) {
            resolve(false);
          }
        });
    });
  };

  const signWithWallet = async (): Promise<SignWithWalletResult> => {
    const net = activeNetwork.get();
    const conn = await requireConnector(net);
    const nearClient = requireNear(net);
    const recipient = getRecipient(net);

    const nonceBytes = generateNonce();
    const nonceHex = hex.encode(nonceBytes);
    const message = `Sign in to ${recipient}`;

    let connectedWallet: Awaited<ReturnType<typeof conn.getConnectedWallet>> | null = null;
    try {
      connectedWallet = await conn.getConnectedWallet();
    } catch {}

    if (activeNetwork.get() !== net) {
      throw new Error("NEAR network changed while connecting wallet");
    }

    if (connectedWallet?.accounts?.length) {
      const accountId: string = connectedWallet.accounts[0]!.accountId;
      const isTestnetAccount = accountId.endsWith(".testnet");
      const isExpectedNetwork = (net === "testnet") === isTestnetAccount;
      if (!isExpectedNetwork) {
        connectedWallet = null;
      }
    }

    if (connectedWallet?.accounts?.length) {
      const signedMessage = await nearClient.signMessage({
        message,
        recipient,
        nonce: nonceBytes,
      });

      if (!signedMessage?.accountId) {
        throw new Error("Wallet sign-in was cancelled or failed");
      }

      return {
        signedMessage,
        accountId: signedMessage.accountId,
        publicKey: signedMessage.publicKey,
        nonceHex,
      };
    }

    const result: {
      value: { signedMessage: SignedMessage; accountId: string; publicKey: string } | null;
    } = { value: null };
    const handler = (data: EventMap["wallet:signInAndSignMessage"]) => {
      if (activeNetwork.get() !== net) return;
      const account = data.accounts?.[0];
      if (account?.signedMessage) {
        result.value = {
          signedMessage: account.signedMessage,
          accountId: account.accountId,
          publicKey: account.signedMessage.publicKey,
        };
      }
    };

    conn.on("wallet:signInAndSignMessage", handler);

    try {
      await conn.connect({
        signMessageParams: {
          message,
          recipient,
          nonce: nonceBytes,
        },
      });
    } finally {
      conn.off("wallet:signInAndSignMessage", handler);
    }

    if (!result.value) {
      throw new Error("Wallet sign-in was cancelled or failed");
    }

    if (activeNetwork.get() !== net) {
      throw new Error("NEAR network changed while signing in");
    }

    return {
      signedMessage: result.value.signedMessage,
      accountId: result.value.accountId,
      publicKey: result.value.publicKey,
      nonceHex,
    };
  };

  const buildSignedDelegateActionInternal = async (
    receiverId: string,
    buildActions: (builder: TransactionBuilder, receiverId: string) => TransactionBuilder,
  ): Promise<string> => {
    const net = activeNetwork.get();
    const state = nearState.get();
    if (!state?.accountId) {
      throw new Error("No NEAR account found — please sign in with your NEAR wallet");
    }

    if (!walletConnected.get()) {
      const reconnected = await ensureWalletConnected(net);
      if (!reconnected) {
        throw new Error("Wallet connection required — please approve the connection to sign");
      }
    }

    const nearClient = requireNear(net);
    const builder = buildActions(nearClient.transaction(state.accountId), receiverId);

    const { payload } = await builder.delegate();
    return payload;
  };

  const fetchGasKeyScope = async ($fetch: BetterFetch): Promise<GasKeyScope> => {
    const response = await $fetch<GasKeyScope>("/near/gas-key/scope", { method: "GET" });
    if (response.error || !response.data) {
      throw new Error("Failed to fetch session gas key scope");
    }
    return response.data;
  };

  const currentGasKeyAccountId = (): string | null => {
    return nearState.get()?.accountId ?? null;
  };

  const requireGasKeySession = async (): Promise<{
    net: NearNetwork;
    accountId: string;
    privateKey: PrivateKey;
    publicKey: string;
  }> => {
    const net = activeNetwork.get();
    const accountId = currentGasKeyAccountId();
    if (!accountId) {
      throw new Error("No NEAR account found — please sign in with your NEAR wallet");
    }
    const stored = await loadSessionGasKey(net, accountId);
    if (!stored) {
      throw new Error(
        "No session gas key for this account — enable gasless writes first with addSessionGasKey()",
      );
    }
    return { net, accountId, privateKey: stored.privateKey, publicKey: stored.publicKey };
  };

  const addSessionGasKeyInternal = async (
    $fetch: BetterFetch,
    callbacks?: AuthCallbacks,
  ): Promise<void> => {
    try {
      const net = activeNetwork.get();
      const conn = await requireConnector(net);
      if (!walletConnected.get()) {
        const reconnected = await ensureWalletConnected(net);
        if (!reconnected) {
          throw new Error("Wallet connection required — please approve the connection to continue");
        }
      }
      const { wallet, accounts } = await conn.getConnectedWallet();
      if (!isGasKeyWallet(wallet.manifest?.features)) {
        throw new Error(
          "Wallet does not support gas keys — session gas keys need a wallet with gas-key support (e.g. Meteor)",
        );
      }
      const scope = await fetchGasKeyScope($fetch);
      if (!scope.enabled || !scope.receiverId) {
        throw new Error("Session gas keys are not enabled on this deployment");
      }
      const accountId = nearState.get()?.accountId ?? accounts[0]?.accountId ?? null;
      if (!accountId) {
        throw new Error("No NEAR account found — please sign in with your NEAR wallet");
      }

      const keyPair = generateKey();
      const publicKey = keyPair.publicKey.toString();
      await wallet.signAndSendTransaction({
        receiverId: accountId,
        actions: [
          {
            type: "AddKey",
            params: {
              publicKey,
              accessKey: {
                permission: {
                  receiverId: scope.receiverId,
                  methodNames: scope.methodNames ?? [],
                },
              },
              gasKeyInfo: { balance: "0", numNonces: scope.numNonces ?? 4 },
            },
          },
        ],
      });

      await saveSessionGasKey(net, accountId, {
        privateKey: keyPair.secretKey as PrivateKey,
        publicKey,
      });
      gasKeyState.set({
        accountId,
        publicKey,
        networkId: net,
        balance: null,
        numNonces: scope.numNonces ?? 4,
      });
      callbacks?.onSuccess?.();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      callbacks?.onError?.(err);
      throw err;
    }
  };

  const refreshGasKeyInfoInternal = async ($fetch: BetterFetch): Promise<GasKeyState> => {
    const net = activeNetwork.get();
    const accountId = currentGasKeyAccountId();
    if (!accountId) return null;
    const stored = await loadSessionGasKey(net, accountId);
    if (!stored) return null;

    const response = await $fetch<{
      balance: string;
      numNonces: number;
    }>("/near/gas-key/info", {
      method: "POST",
      body: { accountId, publicKey: stored.publicKey },
    });
    if (response.error || !response.data) {
      if (response.error?.status === 404) {
        gasKeyState.set(null);
        return null;
      }
      throw new Error(response.error?.message || "Gas key info lookup failed");
    }

    const state: GasKeyState = {
      accountId,
      publicKey: stored.publicKey,
      networkId: net,
      balance: response.data.balance,
      numNonces: response.data.numNonces,
    };
    gasKeyState.set(state);
    return state;
  };

  const ensureGasKeyFundedInternal = async (
    $fetch: BetterFetch,
    callbacks?: AuthCallbacks,
  ): Promise<boolean> => {
    try {
      const state = await refreshGasKeyInfoInternal($fetch);
      if (!state?.balance) return false;
      const scope = await fetchGasKeyScope($fetch);
      if (!scope.enabled || !scope.topUpThresholdYocto) return false;
      if (BigInt(state.balance) >= BigInt(scope.topUpThresholdYocto)) return true;

      const accountId = state.accountId;
      const response = await $fetch<{ txHash: string; amountFunded: string }>(
        "/near/gas-key/fund",
        {
          method: "POST",
          body: { accountId, publicKey: state.publicKey },
        },
      );
      if (response.error) {
        throw new Error(response.error.message || "Gas key funding failed");
      }
      await refreshGasKeyInfoInternal($fetch);
      return true;
    } catch (error) {
      callbacks?.onError?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  };

  const sendWithGasKeyInternal = async (params: {
    receiverId: string;
    methodName: string;
    args?: object | Uint8Array;
    gas?: string;
  }): Promise<{ txHash: string }> => {
    const session = await requireGasKeySession();
    const lane = nextLane(session.net, session.accountId, gasKeyState.get()?.numNonces ?? 4);
    const near = new Near({ network: session.net });
    const result = await near
      .transaction(session.accountId)
      .signWith(session.privateKey)
      .useGasKey(lane)
      .functionCall(params.receiverId, params.methodName, params.args ?? {}, {
        gas: resolveGasUnits(params.gas) ?? "30 Tgas",
      })
      .send({ waitUntil: "EXECUTED" });
    return { txHash: result.transaction.hash };
  };

  const plugin = {
    id: "siwn" as const,
    $InferServerPlugin: {},

    getAtoms: (_$fetch: BetterFetch): NearClientAtoms => ({
      nearState,
      walletConnected,
      activeNetwork,
      gasKeyState,
    }),

    getActions: (
      $fetch: BetterFetch,
      $store: ClientStore,
      _options: unknown,
    ): SIWNClientActions => {
      void initClient($fetch);

      const sessionAtom = $store.atoms?.session;
      if (sessionAtom) {
        sessionAtom.subscribe(() => {
          const sessionData = sessionAtom.get()?.data ?? null;
          if (sessionData === null) {
            for (const [_net, conn] of connectors) {
              void conn?.disconnect().catch(() => {});
            }
            walletConnected.set(false);
            nearState.set(null);
            gasKeyState.set(null);
            sessionRestored = false;
          }
        });
      }

      return {
        near: {
          nonce: async (params: NonceRequestT, fetchOptions?: BetterFetchOption) => {
            return await $fetch("/near/nonce", {
              method: "POST",
              body: params,
              ...fetchOptions,
            });
          },
          verify: async (params: VerifyRequestT, fetchOptions?: BetterFetchOption) => {
            return await $fetch("/near/verify", {
              method: "POST",
              body: params,
              ...fetchOptions,
            });
          },
          getProfile: async (accountId?: AccountId, fetchOptions?: BetterFetchOption) => {
            return await $fetch("/near/profile", {
              method: "POST",
              body: { accountId },
              ...fetchOptions,
            });
          },
          view: async (params: ViewContractRequestT, fetchOptions?: BetterFetchOption) => {
            return await $fetch("/near/view", {
              method: "POST",
              body: params,
              ...fetchOptions,
            });
          },
          getAccountId: () => {
            const state = nearState.get();
            if (state?.accountId) return state.accountId;
            return readSessionNearAccountId(sessionAtom?.get());
          },
          getState: () => nearState.get(),
          isWalletConnected: () => walletConnected.get(),
          detectNearAccount: async () => {
            const state = nearState.get();
            if (state?.accountId && walletConnected.get()) {
              return {
                accountId: state.accountId,
                publicKey: state.publicKey ?? null,
                networkId: state.networkId,
              };
            }
            for (const network of getSupportedNetworks()) {
              const initialized = await initClientForNetwork(network);
              if (!initialized) continue;
              const conn = connectors.get(network);
              if (!conn) continue;
              try {
                const { accounts } = await conn.getConnectedWallet();
                if (accounts?.length) {
                  const account = accounts[0]!;
                  return {
                    accountId: account.accountId,
                    publicKey: account.publicKey ?? null,
                    networkId: network,
                  };
                }
              } catch {}
            }
            return null;
          },
          ensureConnected: async () => {
            const net = activeNetwork.get();
            if (!initializedNetworks.has(net)) {
              if (!(await initClientForNetwork(net))) return false;
            }
            if (walletConnected.get()) {
              try {
                const conn = connectors.get(net);
                if (conn) {
                  const { accounts } = await conn.getConnectedWallet();
                  if (accounts?.length) return true;
                }
              } catch (err) {
                console.error(
                  "[siwn] restoreFromSession failed:",
                  err instanceof Error ? err.message : err,
                );
              }
            }
            return ensureWalletConnected(net);
          },
          disconnect: async () => {
            for (const [_net, conn] of connectors) {
              if (conn) {
                try {
                  await conn.disconnect();
                } catch {}
              }
            }
            walletConnected.set(false);
            nearState.set(null);
            gasKeyState.set(null);
            sessionRestored = false;
          },
          link: async (callbacks?: AuthCallbacks) => {
            const net = activeNetwork.get();
            const recipient = getRecipient(net);
            try {
              const { signedMessage, accountId, nonceHex } = await signWithWallet();
              const message = `Sign in to ${recipient}`;

              await handleAccountConnection(accountId, signedMessage.publicKey, net);

              const linkResponse = await $fetch<{
                success: boolean;
                accountId: string;
                network: string;
                message: string;
              }>("/near/link-account", {
                method: "POST",
                body: {
                  signedMessage,
                  message,
                  recipient,
                  nonce: nonceHex,
                  accountId,
                },
              });

              if (linkResponse.error) {
                throw new Error(linkResponse.error.message || "Failed to link NEAR account");
              }

              if (!linkResponse?.data?.success) {
                throw new Error("Account linking failed");
              }

              callbacks?.onSuccess?.();
              $store.notify("$sessionSignal");
            } catch (error) {
              const err = error instanceof Error ? error : new Error(String(error));
              callbacks?.onError?.(err);
            }
          },
          unlink: async (
            params: { accountId: string; network?: "mainnet" | "testnet" },
            fetchOptions?: BetterFetchOption,
          ) => {
            return await $fetch("/near/unlink-account", {
              method: "POST",
              body: params,
              ...fetchOptions,
            });
          },
          linkPasskeyWallet: async (callbacks?: AuthCallbacks) => {
            try {
              const net = activeNetwork.get();
              const recipient = getRecipient(net);
              const result = await linkPasskeyWallet({
                recipient,
                listCredentialIds: async () => {
                  const response = await $fetch<Array<{ credentialID: string }> | null>(
                    "/passkey/list-user-passkeys",
                    { method: "GET" },
                  );
                  return (response.data ?? []).map((passkey) => passkey.credentialID);
                },
                fetchLink: async (body) => {
                  const response = await $fetch<
                    { success: true; accountId: string } | { success: false; reason: string } | null
                  >("/near/link-passkey-wallet", {
                    method: "POST",
                    body,
                  });
                  if (response.error || !response.data) {
                    throw new Error(response.error?.message || "Failed to link passkey wallet");
                  }
                  if (!response.data.success) {
                    throw new Error(
                      response.data.reason === PASSKEY_WALLET_UNAVAILABLE
                        ? "A passkey wallet is not available on this network"
                        : "Failed to link passkey wallet",
                    );
                  }
                  return { accountId: response.data.accountId };
                },
              });

              nearState.set({
                accountId: result.accountId,
                publicKey: null,
                networkId: net,
              });
              $store.notify("$sessionSignal");
              callbacks?.onSuccess?.();
              return result;
            } catch (error) {
              callbacks?.onError?.(error instanceof Error ? error : new Error(String(error)));
              return null;
            }
          },
          listAccounts: async (): Promise<BetterFetchResponse<ListAccountsResponseT>> => {
            return await $fetch("/near/list-accounts", { method: "GET" });
          },
          setPrimaryAccount: async (params: SetPrimaryAccountRequestT) => {
            const response = await $fetch<SetPrimaryAccountResponseT>("/near/set-primary-account", {
              method: "POST",
              body: params,
            });
            const activeAccount = response.data?.activeAccount;
            if (activeAccount) {
              nearState.set({
                accountId: activeAccount.accountId,
                publicKey: activeAccount.publicKey ?? null,
                networkId: activeAccount.network,
              });
              activeNetwork.set(activeAccount.network);
              $store.notify("$sessionSignal");
            }
            return response;
          },
          buildSignedDelegateAction: async (
            receiverId: string,
            buildActions: (builder: TransactionBuilder, receiverId: string) => TransactionBuilder,
          ): Promise<string> => {
            return buildSignedDelegateActionInternal(receiverId, buildActions);
          },
          relayTransaction: async (params: { payload: string }) => {
            return await $fetch("/near/relay", {
              method: "POST",
              body: params,
            });
          },
          getRelayStatus: async (txHash: string) => {
            return await $fetch(`/near/relay-status/${txHash}`, {
              method: "GET",
            });
          },
          getRelayerInfo: async (params?: GetRelayerInfoRequestT) => {
            return await $fetch("/near/relayer-info", {
              method: "POST",
              body: { ...params, network: params?.network ?? activeNetwork.get() },
            });
          },
          relayHistory: async () => {
            return await $fetch("/near/relay-history", {
              method: "GET",
            });
          },
          createSubAccount: async (params: CreateSubAccountRequestT) => {
            return await $fetch("/near/create-sub-account", {
              method: "POST",
              body: { ...params, network: params.network ?? activeNetwork.get() },
            });
          },
          checkSubAccountAvailability: async (params: CheckSubAccountAvailabilityRequestT) => {
            if (
              !SUB_ACCOUNT_LABEL_REGEX.test(params.subAccountName) ||
              params.subAccountName.length < 2
            ) {
              return {
                data: { available: false, accountId: "", reason: "invalid" as const },
                error: null,
              } as BetterFetchResponse<CheckSubAccountAvailabilityResponseT>;
            }
            return await $fetch("/near/check-sub-account-availability", {
              method: "POST",
              body: { ...params, network: params.network ?? activeNetwork.get() },
            });
          },
          getGasKeyScope: async () => {
            return await $fetch("/near/gas-key/scope", { method: "GET" });
          },
          isGasKeyWalletSupported: async () => {
            try {
              if (!walletConnected.get()) return false;
              const conn = await requireConnector(activeNetwork.get());
              const { wallet } = await conn.getConnectedWallet();
              return isGasKeyWallet(wallet.manifest?.features);
            } catch {
              return false;
            }
          },
          addSessionGasKey: async (callbacks?: AuthCallbacks) => {
            await addSessionGasKeyInternal($fetch, callbacks);
          },
          sendWithGasKey: async (params) => {
            return await sendWithGasKeyInternal(params);
          },
          refreshGasKeyInfo: async () => {
            return await refreshGasKeyInfoInternal($fetch);
          },
          ensureGasKeyFunded: async (callbacks?: AuthCallbacks) => {
            return await ensureGasKeyFundedInternal($fetch, callbacks);
          },
          getGasKeyState: () => gasKeyState.get(),
          setNetwork: (network: "mainnet" | "testnet") => {
            const prev = activeNetwork.get();
            if (prev !== network) {
              const oldConn = connectors.get(prev);
              if (oldConn) {
                void oldConn.disconnect().catch(() => {});
              }
              walletConnected.set(false);
              nearState.set(null);
              gasKeyState.set(null);
            }
            activeNetwork.set(network);
            void initClientForNetwork(network);
          },
          getNetwork: () => activeNetwork.get(),
          getSupportedNetworks: () => getSupportedNetworks(),
          getRecipient: (network?: "mainnet" | "testnet") => getRecipient(network),
          getNearClient: (network?: "mainnet" | "testnet"): NearType => {
            const net = network || activeNetwork.get();
            // Public read-only view calls need no wallet: a network whose
            // connector-bound client isn't initialized (or a caller on the
            // other network) gets a wallet-less Near cached on demand —
            // initClientForNetwork upgrades the slot to the connector-bound
            // client when that network initializes.
            let client = nearClients.get(net);
            if (!client) {
              client = new Near({ network: net });
              nearClients.set(net, client);
            }
            return client;
          },
        },
        signIn: {
          near: async (callbacks?: AuthCallbacks) => {
            try {
              const { signedMessage, accountId, nonceHex } = await signWithWallet();
              const net = activeNetwork.get();
              const recipient = getRecipient(net);
              const message = `Sign in to ${recipient}`;

              await handleAccountConnection(accountId, signedMessage.publicKey, net);

              const verifyResponse: BetterFetchResponse<VerifyResponseT> = await $fetch(
                "/near/verify",
                {
                  method: "POST",
                  body: {
                    signedMessage,
                    message,
                    recipient,
                    nonce: nonceHex,
                    accountId,
                  },
                },
              );

              if (verifyResponse.error) {
                throw new Error(verifyResponse.error.message || "Failed to verify signature");
              }

              if (!verifyResponse?.data?.success) {
                throw new Error("Authentication verification failed");
              }

              callbacks?.onSuccess?.();
              $store.notify("$sessionSignal");
            } catch (error) {
              const err = error instanceof Error ? error : new Error(String(error));
              callbacks?.onError?.(err);
            }
          },
        },
      };
    },
  };

  return plugin;
};
