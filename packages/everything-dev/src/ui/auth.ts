import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { WebAuthnAbortService } from "@simplewebauthn/browser";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import type { BetterFetch } from "better-auth/client";
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

export interface CustodyWalletRegistration {
  registered: boolean;
  network?: string;
  walletId: string;
  nearAccountId: string;
  handoffUrl: string | null;
}

export interface ReferralDashboard {
  code: string;
  stats: { completed: number; joinedToday: number; pending: number; total: number };
}

export interface ReferralListResult {
  code: string;
  total: number;
  limit: number;
  offset: number;
  referrals: Array<{
    id: string;
    status: "pending" | "completed";
    completedAt: Date | string | null;
    createdAt: Date | string;
    progress: {
      requiredSteps: string[];
      completedSteps: string[];
      remainingSteps: string[];
      completed: number;
      total: number;
      isCompleted: boolean;
    };
    referredUser: { id: string; name: string; email: string; image: string | null };
  }>;
}

/**
 * Typed client surface for the auth plugin's referral endpoints — a local
 * plugin (like custodyClient) instead of the upstream client plugin, whose
 * single-module entry drags its server-side nanoid → node:crypto imports
 * into every browser bundle that includes this file.
 */
function referralClient() {
  return {
    id: "better-auth-referral" as const,
    $InferServerPlugin: {},
    getActions: ($fetch: BetterFetch) => ({
      referrals: {
        dashboard: async () => {
          return await $fetch<ReferralDashboard>("/referrals", { method: "GET" });
        },
        list: async (params?: { limit?: number; offset?: number }) => {
          return await $fetch<ReferralListResult>("/referrals/list-referrals", {
            method: "GET",
            query: params,
          });
        },
      },
    }),
  };
}

/**
 * Typed client surface for the auth plugin's custody endpoints — the
 * escape-hatch replacement for raw `auth.$fetch("/custody/register")` on the
 * device approval page.
 */
function custodyClient() {
  return {
    id: "custody" as const,
    $InferServerPlugin: {},
    getActions: ($fetch: BetterFetch) => ({
      custody: {
        register: async (params: { network: "mainnet" | "testnet" }) => {
          return await $fetch<CustodyWalletRegistration>("/custody/register", {
            method: "POST",
            body: params,
          });
        },
      },
    }),
  };
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
      inferAdditionalFields({
        user: {
          locale: { type: "string", required: false, input: true },
        },
      }),
      siwnClient(nearAuthConfig),
      adminClient(),
      anonymousClient(),
      phoneNumberClient(),
      passkeyClient(),
      organizationClient({ teams: { enabled: true } }),
      apiKeyClient(),
      deviceAuthorizationClient(),
      custodyClient(),
      referralClient(),
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

export type SessionData = AuthClient["$Infer"]["Session"];

/**
 * Explicit shapes for the organization/passkey records — better-auth's client
 * inference collapses to `any` for these plugin endpoints, which would leak
 * `any` into every consumer union.
 */
export interface Organization {
  id: string;
  name: string;
  slug?: string | null;
  logo?: string | null;
  createdAt?: Date | string | null;
  metadata?: Record<string, unknown> | null;
}

export interface Passkey {
  id: string;
  name?: string | null;
  createdAt?: Date | string | null;
  lastUsedAt?: Date | string | null;
}

export function useAuthClient(): AuthClient {
  return useRouter().options.context.authClient as AuthClient;
}

export const sessionQueryKey = ["session"] as const;

export function sessionQueryOptions(authClient: AuthClient) {
  return {
    queryKey: sessionQueryKey,
    queryFn: async () => {
      const { data: session, error } = await authClient.getSession({
        query: { disableCookieCache: true },
      });
      if (error) {
        const record = error as { message?: string; detail?: string; detailFull?: string };
        throw Object.assign(new Error(record.message || "Unable to load your session"), {
          detail: [record.detail, record.detailFull].find(
            (value) => typeof value === "string" && value.trim() !== "",
          ),
        });
      }
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
 *
 * A null context session is "the host did not resolve one", not a verified
 * sign-out: seeding it handed requireSession a freshly-cached null and the
 * guard 307'd to /login without ever running the fetch (#527). The explicit
 * signed-out entry still wins — clearAuthenticatedQueries writes it itself.
 */
export function resolveSessionFromCache<T>(
  queryClient: QueryClient | undefined,
  contextSession: T | null | undefined,
): T | null | undefined {
  if (!queryClient) return contextSession;

  const cachedSession = queryClient.getQueryData<T | null>(sessionQueryKey);
  if (cachedSession !== undefined) return cachedSession;

  if (contextSession !== null && contextSession !== undefined) {
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

export type PasskeyCeremonyError = Error & { code?: string; status?: number };

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
  error: { code?: string; message?: string; status?: number } | null | undefined,
  fallback: string,
): PasskeyCeremonyError {
  return Object.assign(new Error(error?.message || fallback), {
    code: error?.code,
    status: error?.status,
  });
}

export async function isPasskeyAutofillAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
  try {
    return (await window.PublicKeyCredential.isConditionalMediationAvailable?.()) === true;
  } catch {
    return false;
  }
}

/**
 * Aborts any pending passkey ceremony (modal or conditional-mediation).
 * Targets the same `WebAuthnAbortService` singleton instance
 * `@better-auth/passkey` resolves, so the abort reaches the request the
 * browser is holding.
 */
export function cancelPasskeyCeremony(): void {
  WebAuthnAbortService.cancelCeremony();
}

export function isPasskeyCeremonyAborted(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ERROR_CEREMONY_ABORTED";
}

export async function createAccountWithPasskey(
  authClient: AuthClient,
  options?: {
    onSuccess?: (result: { passkeyWallet?: PasskeyWalletStatus }) => void;
    onError?: (error: PasskeyCeremonyError) => void;
    referralCode?: string;
  },
): Promise<void> {
  try {
    const headers = options?.referralCode ? { "x-referral-code": options.referralCode } : undefined;
    const { data, error } = await authClient.passkey.addPasskey(undefined, { headers });
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
