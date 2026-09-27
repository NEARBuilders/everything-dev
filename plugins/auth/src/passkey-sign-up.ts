import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { linkPasskeyWalletFromCredential, parseCosePublicKey } from "better-near-auth";
import type { AuthNetwork } from "./auth-config";

export const PASSKEY_CHALLENGE_WINDOW_MS = 5 * 60 * 1000;
const PASSKEY_WALLET_ALGORITHMS = [-8, -7];
const UNSUPPORTED_AUTHENTICATOR = "PASSKEY_UNSUPPORTED_AUTHENTICATOR";

export const passkeyAuthenticatorSelection = {
  residentKey: "required",
  requireResidentKey: true,
  userVerification: "required",
} as const;

export function requireWalletCapablePasskey({
  verification,
}: {
  verification: {
    registrationInfo?: { userVerified: boolean; credential: { publicKey: Uint8Array } };
  };
}) {
  const info = verification.registrationInfo;
  if (!info?.userVerified) {
    throw new APIError("BAD_REQUEST", {
      message: "Passkey must verify the user",
      code: UNSUPPORTED_AUTHENTICATOR,
    });
  }
  if (!parseCosePublicKey(info.credential.publicKey)) {
    throw new APIError("BAD_REQUEST", {
      message: "Passkey must use an ES256 or EdDSA key",
      code: UNSUPPORTED_AUTHENTICATOR,
    });
  }
}

export function requireUserVerifiedSignIn({
  verification,
}: {
  verification: { authenticationInfo: { userVerified: boolean } };
}) {
  if (!verification.authenticationInfo.userVerified) {
    throw new APIError("BAD_REQUEST", {
      message: "Passkey must verify the user",
      code: "PASSKEY_USER_VERIFICATION_REQUIRED",
    });
  }
}

function signUpMarker(userId: string) {
  return `passkey-sign-up:${userId}`;
}

export async function createPasskeySignUpUser(
  { ctx }: { ctx: GenericEndpointContext },
  emailDomain: string | undefined,
) {
  const created = await ctx.context.internalAdapter.createUser({
    email: `passkey-${crypto.randomUUID().slice(0, 8)}@${emailDomain}`,
    name: "Passkey user",
    emailVerified: true,
  });
  if (!created) {
    throw new APIError("INTERNAL_SERVER_ERROR", { message: "Failed to create user" });
  }
  await ctx.context.internalAdapter.createVerificationValue({
    identifier: signUpMarker(created.id),
    value: created.id,
    expiresAt: new Date(Date.now() + PASSKEY_CHALLENGE_WINDOW_MS),
  });
  return { id: created.id, name: created.name, displayName: created.name };
}

function withWalletAlgorithms(options: unknown) {
  if (!options || typeof options !== "object" || !("pubKeyCredParams" in options)) return null;
  const params = (options as { pubKeyCredParams: Array<{ alg: number }> }).pubKeyCredParams;
  return {
    ...options,
    pubKeyCredParams: params.filter(({ alg }) => PASSKEY_WALLET_ALGORITHMS.includes(alg)),
  };
}

interface RegisteredPasskey {
  id: string;
  userId: string;
  publicKey: string;
}

function isRegisteredPasskey(value: unknown): value is RegisteredPasskey {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.userId === "string" &&
    typeof candidate.publicKey === "string"
  );
}

export function passkeySignUp(options: { network: AuthNetwork }) {
  return {
    id: "passkey-sign-up",
    hooks: {
      after: [
        {
          matcher: (ctx) => ctx.path === "/passkey/generate-register-options",
          handler: createAuthMiddleware(async (ctx) => {
            const options = withWalletAlgorithms(ctx.context.returned);
            if (options) return ctx.json(options);
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/passkey/verify-registration",
          handler: createAuthMiddleware(async (ctx) => {
            const passkey = ctx.context.returned;
            if (!isRegisteredPasskey(passkey)) return;
            if (await getSessionFromCtx(ctx)) return;

            const marker = await ctx.context.internalAdapter.consumeVerificationValue(
              signUpMarker(passkey.userId),
            );
            if (!marker || marker.expiresAt.getTime() < Date.now()) return;
            const user = await ctx.context.internalAdapter.findUserById(passkey.userId);
            if (!user) return;
            const passkeys = await ctx.context.adapter.findMany<{ id: string }>({
              model: "passkey",
              where: [{ field: "userId", operator: "eq", value: user.id }],
            });
            if (passkeys.length !== 1 || passkeys[0]?.id !== passkey.id) return;

            const passkeyWallet = await linkPasskeyWalletFromCredential(ctx.context, {
              userId: user.id,
              credentialPublicKey: passkey.publicKey,
              network: options.network,
            });
            const session = await ctx.context.internalAdapter.createSession(user.id);
            if (!session) {
              throw new APIError("INTERNAL_SERVER_ERROR", { message: "Unable to create session" });
            }
            await setSessionCookie(ctx, { session, user });
            return ctx.json({ ...passkey, passkeyWallet });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
