import type { AuthContext } from "@better-auth/core";
import { base64 } from "@scure/base";
import { APIError } from "better-auth/api";
import {
  derivePasskeyAccountId,
  type PasskeyWalletNetwork,
  parseCosePublicKey,
  passkeyPublicKeyToString,
} from "./passkey.js";
import type { NearAccount } from "./types.js";

export { PASSKEY_WALLET_UNAVAILABLE } from "./constants.js";

export type PasskeyWalletLink =
  | { status: "linked"; accountId: string; network: PasskeyWalletNetwork; isPrimary: boolean }
  | { status: "unavailable"; network: PasskeyWalletNetwork };

export function passkeyWalletFromCredential(
  credentialPublicKey: string,
  network: PasskeyWalletNetwork,
): { accountId: string; publicKey: string } | null {
  let cose: Uint8Array;
  try {
    cose = base64.decode(credentialPublicKey);
  } catch {
    return null;
  }
  const key = parseCosePublicKey(cose);
  if (!key) return null;
  const publicKey = passkeyPublicKeyToString(key);
  const accountId = derivePasskeyAccountId(publicKey, network);
  return accountId ? { accountId, publicKey } : null;
}

export async function linkPasskeyWalletFromCredential(
  context: Pick<AuthContext, "adapter" | "internalAdapter">,
  args: { userId: string; credentialPublicKey: string; network: PasskeyWalletNetwork },
): Promise<PasskeyWalletLink> {
  const { userId, network } = args;
  const wallet = passkeyWalletFromCredential(args.credentialPublicKey, network);
  if (!wallet) return { status: "unavailable", network };

  const existing = await context.adapter.findOne<NearAccount>({
    model: "nearAccount",
    where: [{ field: "accountId", operator: "eq", value: wallet.accountId }],
  });
  if (existing && existing.userId !== userId) {
    throw new APIError("BAD_REQUEST", {
      message: "This NEAR account is already linked to another user",
      status: 400,
    });
  }
  if (existing) {
    return {
      status: "linked",
      accountId: wallet.accountId,
      network,
      isPrimary: existing.isPrimary,
    };
  }

  const primary = await context.adapter.findOne<NearAccount>({
    model: "nearAccount",
    where: [
      { field: "userId", operator: "eq", value: userId },
      { field: "isPrimary", operator: "eq", value: true },
    ],
  });
  const isPrimary = !primary;

  await context.adapter.create({
    model: "nearAccount",
    data: {
      userId,
      accountId: wallet.accountId,
      network,
      publicKey: wallet.publicKey,
      isPrimary,
      createdAt: new Date(),
    },
  });
  await context.internalAdapter.createAccount({
    userId,
    providerId: "siwn",
    accountId: `${wallet.accountId}:${network}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { status: "linked", accountId: wallet.accountId, network, isPrimary };
}
