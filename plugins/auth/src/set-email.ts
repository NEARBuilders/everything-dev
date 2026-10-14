import {
  APIError,
  createAuthEndpoint,
  sendVerificationEmailFn,
  sensitiveSessionMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { isSyntheticEmail } from "./synthetic-email";

export interface SetEmailOptions {
  requireVerification: boolean;
}

export function setEmail(options: SetEmailOptions) {
  return {
    id: "set-email",
    endpoints: {
      setEmail: createAuthEndpoint(
        "/set-email",
        {
          method: "POST",
          body: z.object({
            email: z.string().email(),
            callbackURL: z.string().optional(),
          }),
          use: [sensitiveSessionMiddleware],
        },
        async (ctx) => {
          const { session, user } = ctx.context.session;
          const newEmail = ctx.body.email.trim().toLowerCase();
          if (newEmail === user.email) {
            throw new APIError("BAD_REQUEST", { message: "Email is the same" });
          }
          if (user.emailVerified && !isSyntheticEmail(user.email)) {
            throw new APIError("FORBIDDEN", {
              message: "Email is already verified",
            });
          }
          if (await ctx.context.internalAdapter.findUserByEmail(newEmail)) {
            throw new APIError("BAD_REQUEST", { message: "Email is already in use" });
          }

          if (options.requireVerification) {
            const updatedUser = { ...user, email: newEmail, emailVerified: false };
            await ctx.context.internalAdapter.updateUserByEmail(user.email, {
              email: newEmail,
              emailVerified: false,
            });
            await sendVerificationEmailFn(ctx, updatedUser);
            await setSessionCookie(ctx, { session, user: updatedUser });
            return ctx.json({ status: true, verificationRequired: true });
          }

          await ctx.context.internalAdapter.updateUserByEmail(user.email, {
            email: newEmail,
            emailVerified: true,
          });
          await setSessionCookie(ctx, {
            session,
            user: { ...user, email: newEmail, emailVerified: true },
          });
          return ctx.json({ status: true, verificationRequired: false });
        },
      ),
    },
  } satisfies import("better-auth").BetterAuthPlugin;
}
