import type {
  BetterFetch,
  BetterFetchOption,
  BetterFetchResponse,
  ClientStore,
} from "better-auth/client";
import type {
  AgentView,
  GenerateIntentResponse,
  GenerateIntentResponseOf,
  GrantView,
  SignedData,
  StatusResponse,
} from "./agent-api.js";
import type {
  AgentStatusRequestT,
  CreateAgentRequestT,
  IssueAgentGrantRequestT,
  ListAgentGrantsRequestT,
  RevokeAgentGrantRequestT,
  SubmitAgentIntentRequestT,
} from "./agent-connect.js";
import type { AuthCallbacks } from "./auth-callbacks.js";
import { getWalletSigner } from "./wallet-signer.js";

export interface AgentClientActions {
  agent: {
    create: (
      params: CreateAgentRequestT,
      fetchOptions?: BetterFetchOption,
    ) => Promise<BetterFetchResponse<GenerateIntentResponseOf<"agent_create">>>;
    submitIntent: (
      params: SubmitAgentIntentRequestT,
      fetchOptions?: BetterFetchOption,
    ) => Promise<BetterFetchResponse<StatusResponse>>;
    signIntent: (generated: GenerateIntentResponse) => Promise<SignedData>;
    signAndSubmitIntent: (
      generated: GenerateIntentResponse,
      callbacks?: AuthCallbacks,
    ) => Promise<BetterFetchResponse<StatusResponse>>;
    status: (
      params: AgentStatusRequestT,
      fetchOptions?: BetterFetchOption,
    ) => Promise<BetterFetchResponse<StatusResponse>>;
    listAgents: (
      fetchOptions?: BetterFetchOption,
    ) => Promise<BetterFetchResponse<{ data: AgentView[]; nextCursor: string | null }>>;
    issueGrant: (
      params: IssueAgentGrantRequestT,
      fetchOptions?: BetterFetchOption,
    ) => Promise<BetterFetchResponse<GenerateIntentResponse>>;
    revokeGrant: (
      params: RevokeAgentGrantRequestT,
      fetchOptions?: BetterFetchOption,
    ) => Promise<BetterFetchResponse<GenerateIntentResponse>>;
    listGrants: (
      params: ListAgentGrantsRequestT,
      fetchOptions?: BetterFetchOption,
    ) => Promise<BetterFetchResponse<{ data: GrantView[] }>>;
  };
}

async function signIntentWithWallet(generated: GenerateIntentResponse): Promise<SignedData> {
  const { standard, payload } = generated.intent;

  if (standard === "nep413") {
    const signer = getWalletSigner();
    if (!signer) {
      throw new Error("Connect your NEAR wallet first to sign this intent");
    }
    const nonce = Uint8Array.from(atob(payload.nonce), (c) => c.charCodeAt(0));
    const signedMessage = await signer.wallet.signMessage({
      message: payload.message,
      recipient: payload.recipient,
      nonce,
      network: signer.network,
    });
    return {
      standard,
      payload,
      public_key: signedMessage.publicKey,
      signature: signedMessage.signature,
    };
  }

  if (standard === "nep366") {
    const signer = getWalletSigner();
    if (!signer) {
      throw new Error("Connect your NEAR wallet first to sign this intent");
    }
    const result = await signer.wallet.signDelegateActions({ delegateActions: [payload] });
    const signedDelegate = result.signedDelegateActions[0];
    if (!signedDelegate) {
      throw new Error("Wallet returned no signed delegate action");
    }
    return { standard, payload, signed_delegate: signedDelegate };
  }

  if (standard === "webauthn") {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    const credential = await startAuthentication({
      optionsJSON: payload as Parameters<typeof startAuthentication>[0]["optionsJSON"],
    });
    return { standard, payload, credential } as SignedData;
  }

  throw new Error(`Unsupported intent signing standard: ${standard}`);
}

export const agentConnectClient = () => {
  const plugin = {
    id: "agentConnect" as const,
    $InferServerPlugin: {},

    getActions: (
      $fetch: BetterFetch,
      $store: ClientStore,
      _options: unknown,
    ): AgentClientActions => {
      void $store;

      return {
        agent: {
          create: async (params, fetchOptions?) => {
            return await $fetch("/agent/create", {
              method: "POST",
              body: params,
              ...fetchOptions,
            });
          },
          submitIntent: async (params, fetchOptions?) => {
            return await $fetch("/agent/intents/submit", {
              method: "POST",
              body: params,
              ...fetchOptions,
            });
          },
          signIntent: async (generated) => {
            return await signIntentWithWallet(generated);
          },
          signAndSubmitIntent: async (generated, callbacks?) => {
            try {
              const signedData = await signIntentWithWallet(generated);
              const response = await $fetch<StatusResponse>("/agent/intents/submit", {
                method: "POST",
                body: {
                  type: generated.type,
                  correlationId: generated.correlation_id,
                  signedData,
                },
              });
              if (response.error) {
                throw new Error(response.error.message || "Failed to submit signed intent");
              }
              callbacks?.onSuccess?.();
              return response;
            } catch (error) {
              const err = error instanceof Error ? error : new Error(String(error));
              callbacks?.onError?.(err);
              throw err;
            }
          },
          status: async (params, fetchOptions?) => {
            return await $fetch("/agent/status", {
              method: "POST",
              body: params,
              ...fetchOptions,
            });
          },
          listAgents: async (fetchOptions?) => {
            return await $fetch("/agent/list", { method: "GET", ...fetchOptions });
          },
          issueGrant: async (params, fetchOptions?) => {
            return await $fetch("/agent/grants/issue", {
              method: "POST",
              body: params,
              ...fetchOptions,
            });
          },
          revokeGrant: async (params, fetchOptions?) => {
            return await $fetch("/agent/grants/revoke", {
              method: "POST",
              body: params,
              ...fetchOptions,
            });
          },
          listGrants: async (params, fetchOptions?) => {
            return await $fetch("/agent/grants", {
              method: "POST",
              body: params,
              ...fetchOptions,
            });
          },
        },
      };
    },
  };

  return plugin;
};
