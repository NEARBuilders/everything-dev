import type { WithEffectContext } from "@orpc/experimental-effect";
import type { DecoratedMiddleware } from "@orpc/server";
import { ORPCError } from "@orpc/server";
import { Context } from "effect";
import type { AuthContextShape } from "everything-dev/api";
import type { DatabaseTag } from "./db/layer";
import {
  AuthApiTag,
  type MembershipPolicyTag,
  type OnboardingCodeCipherTag,
  type PluginServices,
} from "./service-types";
import type { OrganizationsService } from "./services/organizations";
import { ApiKeysService } from "./services/api-keys";
import { InvitationsService } from "./services/invitations";
import { MembersService } from "./services/members";
import { NearService } from "./services/near";
import { SessionService } from "./services/session";
import { OnboardingService } from "./services/onboarding";
import { PermissionsService } from "./services/permissions";
import { TeamsService } from "./services/teams";
import { createHeaders } from "./utils";

export type AuthSessionUser = PluginServices["auth"]["$Infer"]["Session"]["user"];

export type AuthEffectServices =
  | AuthApiTag
  | ApiKeysService
  | DatabaseTag
  | OnboardingCodeCipherTag
  | MembershipPolicyTag
  | OrganizationsService
  | InvitationsService
  | MembersService
  | TeamsService
  | OnboardingService
  | PermissionsService
  | NearService
  | SessionService;

export type AuthHandlerContext = AuthContextShape &
  WithEffectContext<AuthEffectServices> & {
    reqHeaders?: Record<string, string>;
  };

export type AuthHandlerAuthedContext = Omit<AuthHandlerContext, "user"> & {
  user: AuthSessionUser;
};

export type RequireAuthMiddleware = DecoratedMiddleware<
  AuthHandlerContext,
  { userId: string; user: AuthSessionUser; reqHeaders?: Record<string, string> },
  any,
  any,
  any
>;

export function createRequireAuth(builder: any): RequireAuthMiddleware {
  return builder.middleware(
    async ({ context, next }: { context: AuthHandlerContext; next: any }) => {
      let user = (context.user as AuthSessionUser | null | undefined)?.id
        ? (context.user as AuthSessionUser)
        : null;
      if (!user) {
        const { auth } = Context.get(context["effect/context"], AuthApiTag);
        const headers = createHeaders(context.reqHeaders);
        const session = await auth.api.getSession({ headers });
        user = session?.user ?? null;
      }

      if (!user?.id) {
        const { apiKeyHeaders } = Context.get(context["effect/context"], AuthApiTag);
        const apiKeyProvided = (apiKeyHeaders ?? []).some(
          (headerName) => context.reqHeaders?.[headerName] !== undefined,
        );
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { apiKeyProvided },
        });
      }

      return next({
        context: {
          userId: user.id,
          user,
          reqHeaders: context.reqHeaders,
        },
      });
    },
  ) as RequireAuthMiddleware;
}
