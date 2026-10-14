import type { ORPCError } from "@orpc/server";
import { Context, Effect, Layer } from "effect";
import { attemptAuth } from "../attempts";
import { AuthApiTag, type PluginServices } from "../service-types";
import { createHeaders } from "../utils";

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
    }) => Effect.Effect<any, ORPCError<string, unknown>>;
    nearVerify: (
      headers: Headers,
      input: {
        signedMessage: SignedMessage;
        message: string;
        recipient: string;
        nonce: string;
        accountId: string;
      },
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    nearProfile: (
      headers: Headers,
      accountId: string | undefined,
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    nearLinkAccount: (
      reqHeaders: Headers,
      input: {
        signedMessage: SignedMessage;
        message: string;
        recipient: string;
        nonce: string;
        accountId: string;
      },
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    nearUnlinkAccount: (
      headers: Headers,
      input: { accountId: string; network?: NearNetwork },
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    nearListAccounts: (headers: Headers) => Effect.Effect<any, ORPCError<string, unknown>>;
    nearRelay: (
      headers: Headers,
      payload: string,
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    nearRelayStatus: (
      headers: Headers,
      txHash: string,
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    nearRelayerInfo: (
      headers: Headers,
      network: NearNetwork | undefined,
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    nearRelayHistory: (headers: Headers) => Effect.Effect<any, ORPCError<string, unknown>>;
    nearView: (
      headers: Headers,
      input: { contractId: string; methodName: string; args?: Record<string, any> },
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    nearCheckSubAccountAvailability: (
      headers: Headers,
      input: { subAccountName: string; network?: NearNetwork },
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    nearCreateSubAccount: (
      headers: Headers,
      input: {
        subAccountName: string;
        publicKey: string;
        network?: NearNetwork;
      },
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
  }
>()("auth/NearService") {}

export const buildNearService = ({ auth }: { auth: Auth }) =>
  NearService.of({
    nearNonce: (input) =>
      attemptAuth(() =>
        auth.api.getSiwnNonce({
          body: { accountId: input.accountId, networkId: input.networkId },
        }),
      ),

    nearVerify: (headers, input) =>
      attemptAuth(() => {
        const req = new Request("http://localhost:3000/api/auth/near/verify", {
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
        const req = new Request("http://localhost:3000/api/auth/near/link", {
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

export const NearServiceLive = Layer.effect(
  NearService,
  Effect.gen(function* () {
    const { auth } = yield* AuthApiTag;
    return buildNearService({ auth });
  }),
);
