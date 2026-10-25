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
    where: [
      { field: "accountId", operator: "eq", value: wallet.accountId },
      { field: "network", operator: "eq", value: network },
    ],
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

  try {
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
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new APIError("BAD_REQUEST", {
        message: "This NEAR account is already linked to another user",
        status: 400,
      });
    }
    throw error;
  }
  await context.internalAdapter.createAccount({
    userId,
    providerId: "siwn",
    accountId: `${wallet.accountId}:${network}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { status: "linked", accountId: wallet.accountId, network, isPrimary };
}

/**
 * The nearAccount table's `(accountId, network)` unique constraint is the
 * concurrent double-link gate — the check-then-insert above can race past
 * any pre-check, so the constraint violation maps to the same 400. Drizzle
 * wraps driver errors in a "Failed query" Error with the pg error as cause,
 * so the walk is needed to reach the SQLSTATE.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return (current as { code?: string } | undefined)?.code === "23505";
}
