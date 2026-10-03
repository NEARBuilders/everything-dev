import { APIError, createAuthEndpoint, sensitiveSessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { isSyntheticEmail } from "./synthetic-email";

export function setEmail() {
  return {
    id: "set-email",
    endpoints: {
      setEmail: createAuthEndpoint(
        "/set-email",
        {
          method: "POST",
          body: z.object({ email: z.string().email() }),
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
          await ctx.context.internalAdapter.updateUserByEmail(user.email, {
            email: newEmail,
            emailVerified: true,
          });
          await setSessionCookie(ctx, {
            session,
            user: { ...user, email: newEmail, emailVerified: true },
          });
          return ctx.json({ status: true });
        },
      ),
    },
  } satisfies import("better-auth").BetterAuthPlugin;
}
