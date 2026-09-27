import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  adminClient,
  anonymousClient,
  deviceAuthorizationClient,
  inferAdditionalFields,
  organizationClient,
  phoneNumberClient,
} from "better-auth/client/plugins";
import { createAuthClient as createBetterAuthClient } from "better-auth/react";
import type { PasskeyWalletLink, RelayedTransactionT } from "better-near-auth";
import { DEFAULT_DEVICE_LINK_CLIENT_ID, siwnClient } from "better-near-auth/client";
import type { ClientRuntimeConfig } from "../types";
import { getRuntimeConfig } from "./runtime";

type RuntimeAuthVariables = {
  siwn: {
    recipient?: string;
    recipients?: {
      mainnet?: string;
      testnet?: string;
    };
  };
  deviceLink?: {
    clientId?: string;
  };
};

export type CreateAuthClientOptions = {
  runtimeConfig?: Partial<ClientRuntimeConfig>;
  headers?: HeadersInit;
  cspNonce?: string;
};

type SiwnClientConfig = Parameters<typeof siwnClient>[0] & {
  cspNonce?: string;
};

function hasAuthVariables(auth: ClientRuntimeConfig["auth"] | undefined): auth is NonNullable<
  ClientRuntimeConfig["auth"]
> & {
  variables: RuntimeAuthVariables;
} {
  return !!auth && typeof auth === "object" && typeof auth.variables === "object";
}

function readRuntimeConfig(config?: Partial<ClientRuntimeConfig>) {
  if (config) return config;
  if (typeof window === "undefined") return undefined;
  try {
    return getRuntimeConfig();
  } catch {
    return undefined;
  }
}

function getAuthVariables(config?: Partial<ClientRuntimeConfig>): RuntimeAuthVariables {
  const runtimeConfig = readRuntimeConfig(config);
  if (!runtimeConfig || !hasAuthVariables(runtimeConfig.auth)) {
    throw new Error("Missing auth runtime configuration");
  }
  return runtimeConfig.auth.variables;
}

function getSiwnClientConfig(options: CreateAuthClientOptions): SiwnClientConfig {
  const runtimeConfig = readRuntimeConfig(options.runtimeConfig);
  const variables = getAuthVariables(options.runtimeConfig);
  const siwn = variables.siwn;

  const mainnetRecipient = siwn.recipients?.mainnet ?? siwn.recipient;
  if (!mainnetRecipient) {
    throw new Error("Missing auth SIWN recipient");
  }

  const networkId =
    runtimeConfig?.networkId ?? (mainnetRecipient.endsWith(".testnet") ? "testnet" : "mainnet");
  const testnetRecipient = siwn.recipients?.testnet;

  if (testnetRecipient) {
    return {
      recipients: { mainnet: mainnetRecipient, testnet: testnetRecipient },
      networkId,
      cspNonce: options.cspNonce,
    };
  }

  return { recipient: mainnetRecipient, networkId, cspNonce: options.cspNonce };
}

function getHostUrl(config?: Partial<ClientRuntimeConfig>) {
  const runtimeConfig = readRuntimeConfig(config);
  if (runtimeConfig?.hostUrl) return runtimeConfig.hostUrl;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function getDeviceLinkClientId(config?: Partial<ClientRuntimeConfig>): string {
  const runtimeConfig = readRuntimeConfig(config);
  const variables = runtimeConfig?.auth?.variables as RuntimeAuthVariables | undefined;
  return variables?.deviceLink?.clientId ?? DEFAULT_DEVICE_LINK_CLIENT_ID;
}

export function createAuthClient(options: CreateAuthClientOptions = {}) {
  const nearAuthConfig = getSiwnClientConfig(options);

  return createBetterAuthClient({
    baseURL: getHostUrl(options.runtimeConfig),
    fetchOptions: {
      credentials: "include",
      ...(options.headers ? { headers: options.headers } : {}),
    },
    plugins: [
      inferAdditionalFields<any>(),
      siwnClient(nearAuthConfig),
      adminClient(),
      anonymousClient(),
      phoneNumberClient(),
      passkeyClient(),
      organizationClient({ teams: { enabled: true } }),
      apiKeyClient(),
      deviceAuthorizationClient(),
    ],
  });
}

export type { AuthContext } from "./auth-guards";
export {
  clearAuthenticatedQueries,
  requireAdmin,
  requireSession,
} from "./auth-guards";
export { pluginHref, pluginPath, pluginSearch } from "./plugin-path";

export type AuthClient = ReturnType<typeof createAuthClient>;
type OrganizationListResult = Awaited<ReturnType<AuthClient["organization"]["list"]>>;
type PasskeyListResult = Awaited<ReturnType<AuthClient["passkey"]["listUserPasskeys"]>>;

export type SessionData = AuthClient["$Infer"]["Session"];
export type Organization = NonNullable<OrganizationListResult["data"]>[number];
export type Passkey = NonNullable<PasskeyListResult["data"]>[number];

export function useAuthClient(): AuthClient {
  return useRouter().options.context.authClient as AuthClient;
}

export const sessionQueryKey = ["session"] as const;

export function sessionQueryOptions(authClient: AuthClient) {
  return {
    queryKey: sessionQueryKey,
    queryFn: async () => {
      const { data: session } = await authClient.getSession({
        query: { disableCookieCache: true },
      });
      return session ?? null;
    },
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  };
}

export async function refreshSessionCache(
  authClient: AuthClient,
  queryClient: QueryClient,
): Promise<SessionData | null> {
  return queryClient.fetchQuery({ ...sessionQueryOptions(authClient), staleTime: 0 });
}

/**
 * Resolves the session for the root route: the query cache wins (it is kept
 * authoritative by the single sessionQueryOptions read path), and a populated
 * router-context session — the host's SSR resolution — seeds an empty cache so
 * the dehydrated state carries it to the client.
 */
export function resolveSessionFromCache<T>(
  queryClient: QueryClient | undefined,
  contextSession: T | null | undefined,
): T | null | undefined {
  if (!queryClient) return contextSession;

  const cachedSession = queryClient.getQueryData<T | null>(sessionQueryKey);
  if (cachedSession !== undefined) return cachedSession;

  if (contextSession !== undefined) {
    queryClient.setQueryData(sessionQueryKey, contextSession);
  }
  return contextSession;
}

export function useRelayHistory(session: SessionData | null | undefined, authClient: AuthClient) {
  return useQuery({
    queryKey: ["relay-history"],
    queryFn: async (): Promise<RelayedTransactionT[]> => {
      const res = await authClient.near.relayHistory();
      return res?.data?.transactions ?? [];
    },
    enabled: !!session,
    refetchInterval: 2000,
  });
}

export type PasskeyWalletStatus = PasskeyWalletLink;

export type PasskeyCeremonyError = Error & { code?: string };

const UNSUPPORTED_AUTHENTICATOR_CODES = new Set([
  "PASSKEY_UNSUPPORTED_AUTHENTICATOR",
  "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG",
  "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT",
  "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT",
]);

export function isUnsupportedAuthenticatorError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  return typeof error.code === "string" && UNSUPPORTED_AUTHENTICATOR_CODES.has(error.code);
}

function toPasskeyError(
  error: { code?: string; message?: string } | null | undefined,
  fallback: string,
): PasskeyCeremonyError {
  return Object.assign(new Error(error?.message || fallback), { code: error?.code });
}

export async function isPasskeyAutofillAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
  try {
    return (await window.PublicKeyCredential.isConditionalMediationAvailable?.()) === true;
  } catch {
    return false;
  }
}

export async function createAccountWithPasskey(
  authClient: AuthClient,
  options?: {
    onSuccess?: (result: { passkeyWallet?: PasskeyWalletStatus }) => void;
    onError?: (error: PasskeyCeremonyError) => void;
  },
): Promise<void> {
  try {
    const { data, error } = await authClient.passkey.addPasskey();
    if (error || !data) {
      options?.onError?.(toPasskeyError(error, "Could not create your account"));
      return;
    }
    const { passkeyWallet } = data as { passkeyWallet?: PasskeyWalletStatus };
    options?.onSuccess?.({ passkeyWallet });
  } catch (error) {
    options?.onError?.(
      toPasskeyError(error instanceof Error ? error : null, "Could not create your account"),
    );
  }
}

export async function signInWithPasskey(
  authClient: AuthClient,
  options?: {
    autoFill?: boolean;
    onSuccess?: () => void;
    onError?: (error: PasskeyCeremonyError) => void;
  },
): Promise<void> {
  try {
    const { data, error } = await authClient.signIn.passkey({ autoFill: options?.autoFill });
    if (error || !data) {
      options?.onError?.(toPasskeyError(error, "Passkey sign-in failed"));
      return;
    }
    options?.onSuccess?.();
  } catch (error) {
    options?.onError?.(
      toPasskeyError(error instanceof Error ? error : null, "Passkey sign-in failed"),
    );
  }
}
