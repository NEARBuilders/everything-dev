import { Context, Effect } from "effect";
import { attemptAuth } from "../attempts";
import type { InferOutput } from "../contract";
import type { PluginServices } from "../service-types";
import type { AuthFailure } from "./domain-errors";

type Auth = PluginServices["auth"];

export interface SignedMessage {
  accountId: string;
  publicKey: string;
  signature: string;
  state?: string;
}

export type NearNetwork = "mainnet" | "testnet";

export class NearService extends Context.Service<
  NearService,
  {
    nearNonce: (input: {
      accountId: string;
      networkId: NearNetwork;
    }) => Effect.Effect<InferOutput<"nearNonce">, AuthFailure>;
    nearVerify: (
      headers: Headers,
      input: {
        signedMessage: SignedMessage;
        message: string;
        recipient: string;
        nonce: string;
        accountId: string;
      },
    ) => Effect.Effect<InferOutput<"nearVerify">, AuthFailure>;
    nearProfile: (
      headers: Headers,
      accountId: string | undefined,
    ) => Effect.Effect<InferOutput<"nearProfile">, AuthFailure>;
    nearLinkAccount: (
      reqHeaders: Headers,
      input: {
        signedMessage: SignedMessage;
        message: string;
        recipient: string;
        nonce: string;
        accountId: string;
      },
    ) => Effect.Effect<InferOutput<"nearLinkAccount">, AuthFailure>;
    nearUnlinkAccount: (
      headers: Headers,
      input: { accountId: string; network?: NearNetwork },
    ) => Effect.Effect<InferOutput<"nearUnlinkAccount">, AuthFailure>;
    nearListAccounts: (
      headers: Headers,
    ) => Effect.Effect<InferOutput<"nearListAccounts">, AuthFailure>;
    nearRelay: (
      headers: Headers,
      payload: string,
    ) => Effect.Effect<InferOutput<"nearRelay">, AuthFailure>;
    nearRelayStatus: (
      headers: Headers,
      txHash: string,
    ) => Effect.Effect<InferOutput<"nearRelayStatus">, AuthFailure>;
    nearRelayerInfo: (
      headers: Headers,
      network: NearNetwork | undefined,
    ) => Effect.Effect<InferOutput<"nearRelayerInfo">, AuthFailure>;
    nearRelayHistory: (
      headers: Headers,
    ) => Effect.Effect<InferOutput<"nearRelayHistory">, AuthFailure>;
    nearView: (
      headers: Headers,
      input: { contractId: string; methodName: string; args?: Record<string, any> },
    ) => Effect.Effect<InferOutput<"nearView">, AuthFailure>;
    nearCheckSubAccountAvailability: (
      headers: Headers,
      input: { subAccountName: string; network?: NearNetwork },
    ) => Effect.Effect<InferOutput<"nearCheckSubAccountAvailability">, AuthFailure>;
    nearCreateSubAccount: (
      headers: Headers,
      input: {
        subAccountName: string;
        publicKey: string;
        network?: NearNetwork;
      },
    ) => Effect.Effect<InferOutput<"nearCreateSubAccount">, AuthFailure>;
  }
>()("auth/NearService") {}

export const buildNearService = ({ auth }: { auth: Auth }) => {
  const siwnRequestUrl = (path: string) => `${auth.options.baseURL}/api/auth${path}`;

  return NearService.of({
    nearNonce: (input) =>
      attemptAuth(() =>
        auth.api.getSiwnNonce({
          body: { accountId: input.accountId, networkId: input.networkId },
        }),
      ),

    nearVerify: (headers, input) =>
      attemptAuth(() => {
        const req = new Request(siwnRequestUrl("/near/verify"), {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        });
        return auth.api.verifySiwnMessage({
          request: req,
          body: {
            signedMessage: input.signedMessage,
            message: input.message,
            recipient: input.recipient,
            nonce: input.nonce,
            accountId: input.accountId,
          },
        });
      }),

    nearProfile: (headers, accountId) =>
      attemptAuth(() =>
        auth.api.getSiwnProfile({
          headers,
          body: { accountId },
        }),
      ),

    nearLinkAccount: (reqHeaders, input) =>
      attemptAuth(() => {
        const req = new Request(siwnRequestUrl("/near/link"), {
          method: "POST",
          headers: reqHeaders,
          body: JSON.stringify(input),
        });
        return auth.api.linkNearAccount({
          request: req,
          headers: reqHeaders,
          body: {
            signedMessage: input.signedMessage,
            message: input.message,
            recipient: input.recipient,
            nonce: input.nonce,
            accountId: input.accountId,
          },
        });
      }),

    nearUnlinkAccount: (headers, input) =>
      attemptAuth(() =>
        auth.api.unlinkNearAccount({
          headers,
          body: { accountId: input.accountId, network: input.network },
        }),
      ),

    nearListAccounts: (headers) => attemptAuth(() => auth.api.listNearAccounts({ headers })),

    nearRelay: (headers, payload) =>
      attemptAuth(() =>
        auth.api.relayNearTransaction({
          headers,
          body: { payload },
        }),
      ),

    nearRelayStatus: (headers, txHash) =>
      attemptAuth(() =>
        auth.api.getRelayStatus({
          headers,
          params: { txHash },
        }),
      ),

    nearRelayerInfo: (headers, network) =>
      Effect.gen(function* () {
        const info = yield* attemptAuth(() =>
          auth.api.getRelayerInfo({
            headers,
            body: { network },
          }),
        );
        const serializeTimestamp = (value: unknown) =>
          value instanceof Date ? value.toISOString() : (value as string | undefined);
        const timestamps = info as { createdAt?: unknown; lastUsedAt?: unknown };
        return {
          ...info,
          createdAt: serializeTimestamp(timestamps.createdAt),
          lastUsedAt: serializeTimestamp(timestamps.lastUsedAt),
        };
      }),

    nearRelayHistory: (headers) => attemptAuth(() => auth.api.getRelayHistory({ headers })),

    nearView: (headers, input) =>
      attemptAuth(() =>
        auth.api.viewContract({
          headers,
          body: {
            contractId: input.contractId,
            methodName: input.methodName,
            args: input.args,
          },
        }),
      ),

    nearCheckSubAccountAvailability: (headers, input) =>
      attemptAuth(() =>
        auth.api.checkSubAccountAvailability({
          headers,
          body: {
            subAccountName: input.subAccountName,
            network: input.network,
          },
        }),
      ),

    nearCreateSubAccount: (headers, input) =>
      attemptAuth(() =>
        auth.api.createSubAccount({
          headers,
          body: {
            subAccountName: input.subAccountName,
            publicKey: input.publicKey,
            network: input.network,
          },
        }),
      ),
  });
};
