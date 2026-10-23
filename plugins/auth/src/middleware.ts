import type { WithEffectContext } from "@orpc/experimental-effect";
import type { DecoratedMiddleware, Implementer } from "@orpc/server";
import { ORPCError } from "@orpc/server";
import { Context } from "effect";
import type { AuthContextShape } from "everything-dev/api";
import type { ContractType, InferOutput } from "./contract";
import type { DatabaseTag } from "./db/layer";
import {
  AuthApiTag,
  type MembershipPolicyTag,
  type OnboardingCodeCipherTag,
  type PluginServices,
} from "./service-types";
import type { AdminUsersService } from "./services/admin-users";
import type { ApiKeysService } from "./services/api-keys";
import type { InvitationsService } from "./services/invitations";
import type { MembersService } from "./services/members";
import type { NearService } from "./services/near";
import type { OnboardingService } from "./services/onboarding";
import type { OrganizationsService } from "./services/organizations";
import type { PasskeysService } from "./services/passkeys";
import type { PermissionsService } from "./services/permissions";
import type { SessionService } from "./services/session";
import type { TeamsService } from "./services/teams";
import { createHeaders, getActiveOrganizationId } from "./utils";

export type AuthSessionUser = PluginServices["auth"]["$Infer"]["Session"]["user"];

export type AuthEffectServices =
  | AuthApiTag
  | ApiKeysService
  | AdminUsersService
  | DatabaseTag
  | OnboardingCodeCipherTag
  | MembershipPolicyTag
  | OrganizationsService
  | InvitationsService
  | MembersService
  | TeamsService
  | OnboardingService
  | PasskeysService
  | PermissionsService
  | NearService
  | SessionService;

export type AuthHandlerContext = AuthContextShape &
  WithEffectContext<AuthEffectServices> & {
    reqHeaders?: Record<string, string>;
    session?: NonNullable<InferOutput<"getContext">["session"]> | null;
  };

export type AuthHandlerAuthedContext = Omit<AuthHandlerContext, "user"> & {
  user: AuthSessionUser;
  userId: string;
  sessionId: string | null;
  activeOrganizationId: string | null;
};

export type RequireAuthMiddleware = DecoratedMiddleware<
  AuthHandlerContext,
  {
    userId: string;
    user: AuthSessionUser;
    sessionId: string | null;
    activeOrganizationId: string | null;
    reqHeaders?: Record<string, string>;
  },
  any,
  any,
  any
>;

export function createRequireAuth(
  builder: Implementer<ContractType, AuthHandlerContext>,
): RequireAuthMiddleware {
  return builder.middleware(async ({ context, next }) => {
    let user = (context.user as AuthSessionUser | null | undefined)?.id
      ? (context.user as AuthSessionUser)
      : null;
    let sessionId: string | null = null;
    let activeOrganizationId: string | null = null;

    if (user) {
      sessionId = context.session?.id ?? null;
      activeOrganizationId =
        getActiveOrganizationId(context.session) ??
        context.organization?.activeOrganizationId ??
        null;
    } else {
      const { auth } = Context.get(context["effect/context"], AuthApiTag);
      const headers = createHeaders(context.reqHeaders);
      const session = await auth.api.getSession({ headers });
      user = session?.user ?? null;
      if (session?.session) {
        sessionId = session.session.id;
        activeOrganizationId = getActiveOrganizationId(session.session);
      }
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
        sessionId,
        activeOrganizationId,
        reqHeaders: context.reqHeaders,
      },
    });
  }) as RequireAuthMiddleware;
}
