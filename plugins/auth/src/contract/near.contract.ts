import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { Errors } from "./errors";
import {
  nearAccountSchema,
  profileOutputSchema,
  relayedTransactionSchema,
  relayerInfoOutputSchema,
  signedMessageSchema,
} from "./schemas";

export const nearRoutes = {
  nearNonce: oc
    .route({ method: "POST", path: "/v1/near/nonce" })
    .input(
      z.object({
        accountId: z.string(),
        networkId: z.enum(["mainnet", "testnet"]),
      }),
    )
    .output(z.object({ nonce: z.string() }))
    .errors(Errors),

  nearVerify: oc
    .route({ method: "POST", path: "/v1/near/verify" })
    .input(
      z.object({
        signedMessage: signedMessageSchema,
        message: z.string(),
        recipient: z.string(),
        nonce: z.string(),
        accountId: z.string(),
      }),
    )
    .output(
      z.object({
        token: z.string(),
        success: z.literal(true),
        user: z.object({
          id: z.string(),
          accountId: z.string(),
          network: z.enum(["mainnet", "testnet"]),
        }),
      }),
    )
    .errors(Errors),

  nearProfile: oc
    .route({ method: "POST", path: "/v1/near/profile" })
    .input(
      z.object({
        accountId: z.string().optional(),
      }),
    )
    .output(profileOutputSchema)
    .errors(Errors),

  nearLinkAccount: oc
    .route({ method: "POST", path: "/v1/near/link-account" })
    .input(
      z.object({
        signedMessage: signedMessageSchema,
        message: z.string(),
        recipient: z.string(),
        nonce: z.string(),
        accountId: z.string(),
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        accountId: z.string(),
        network: z.string(),
        message: z.string(),
      }),
    )
    .errors(Errors),

  nearUnlinkAccount: oc
    .route({ method: "POST", path: "/v1/near/unlink-account" })
    .input(
      z.object({
        accountId: z.string(),
        network: z.enum(["mainnet", "testnet"]).optional(),
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        accountId: z.string(),
        network: z.string(),
        message: z.string(),
      }),
    )
    .errors(Errors),

  nearListAccounts: oc
    .route({ method: "GET", path: "/v1/near/accounts" })
    .output(
      z.object({
        accounts: z.array(nearAccountSchema),
        activeAccount: nearAccountSchema.nullable().optional(),
        availableAccounts: z.array(nearAccountSchema).optional(),
      }),
    )
    .errors(Errors),

  nearRelay: oc
    .route({ method: "POST", path: "/v1/near/relay" })
    .input(
      z.object({
        payload: z.string(),
      }),
    )
    .output(
      z.object({
        txHash: z.string(),
        status: z.enum(["pending", "completed", "failed"]),
      }),
    )
    .errors(Errors),

  nearRelayStatus: oc
    .route({ method: "GET", path: "/v1/near/relay-status/{txHash}" })
    .input(
      z.object({
        txHash: z.string(),
      }),
    )
    .output(
      z.object({
        status: z.enum(["pending", "completed", "failed"]),
        gasUsed: z.string().optional(),
        outcome: z.unknown().optional(),
      }),
    )
    .errors(Errors),

  nearRelayerInfo: oc
    .route({ method: "POST", path: "/v1/near/relayer-info" })
    .input(
      z.object({
        network: z.enum(["mainnet", "testnet"]).optional(),
      }),
    )
    .output(relayerInfoOutputSchema)
    .errors(Errors),

  nearRelayHistory: oc
    .route({ method: "GET", path: "/v1/near/relay-history" })
    .output(z.object({ transactions: z.array(relayedTransactionSchema) }))
    .errors(Errors),

  nearView: oc
    .route({ method: "POST", path: "/v1/near/view" })
    .input(
      z.object({
        contractId: z.string(),
        methodName: z.string(),
        args: z.record(z.string(), z.any()).optional(),
      }),
    )
    .output(z.object({ result: z.unknown() }))
    .errors(Errors),

  nearCheckSubAccountAvailability: oc
    .route({ method: "POST", path: "/v1/near/check-sub-account-availability" })
    .input(
      z.object({
        subAccountName: z.string(),
        network: z.enum(["mainnet", "testnet"]).optional(),
      }),
    )
    .output(
      z.object({
        available: z.boolean(),
        accountId: z.string(),
        parentAccount: z.string().optional(),
        reason: z.enum(["taken", "invalid", "too-long", "not-configured"]).optional(),
      }),
    )
    .errors(Errors),

  nearCreateSubAccount: oc
    .route({ method: "POST", path: "/v1/near/create-sub-account" })
    .input(
      z.object({
        subAccountName: z.string(),
        publicKey: z.string(),
        network: z.enum(["mainnet", "testnet"]).optional(),
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        accountId: z.string(),
        txHash: z.string().optional(),
      }),
    )
    .errors(Errors),
};
