import type { Implementer } from "@orpc/server";
import { createAuthMiddleware } from "everything-dev/api";
import type { ContractType } from "../contract";
import type {
  AuthHandlerAuthedContext,
  AuthHandlerContext,
  RequireAuthMiddleware,
} from "../middleware";
import { AdminUsersService } from "../services/admin-users";

function headersOf(context: { reqHeaders?: Record<string, string> }): Headers {
  return new Headers(context.reqHeaders);
}

export function createAdminUsersHandlers(
  builder: Implementer<ContractType, AuthHandlerContext>,
  requireAuth: RequireAuthMiddleware,
) {
  const { requireAdmin } = createAuthMiddleware<AuthHandlerAuthedContext>(builder);
  return {
    adminListUsers: builder.adminListUsers
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input, context }) {
        const admin = yield* AdminUsersService;
        return yield* admin.listUsers(headersOf(context), {
          searchValue: input?.searchValue,
          searchField: input?.searchField,
          limit: input?.limit,
          offset: input?.offset,
        });
      }),

    adminGetUser: builder.adminGetUser
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input, context }) {
        const admin = yield* AdminUsersService;
        return yield* admin.getUser(headersOf(context), input.userId);
      }),

    adminSetRole: builder.adminSetRole
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input, context }) {
        const admin = yield* AdminUsersService;
        return yield* admin.setRole(headersOf(context), input.userId, input.role);
      }),

    adminBanUser: builder.adminBanUser
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input, context }) {
        const admin = yield* AdminUsersService;
        return yield* admin.banUser(headersOf(context), {
          userId: input.userId,
          banReason: input.banReason,
          banExpiresIn: input.banExpiresIn,
        });
      }),

    adminUnbanUser: builder.adminUnbanUser
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input, context }) {
        const admin = yield* AdminUsersService;
        return yield* admin.unbanUser(headersOf(context), input.userId);
      }),

    adminListUserSessions: builder.adminListUserSessions
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input, context }) {
        const admin = yield* AdminUsersService;
        return yield* admin.listUserSessions(headersOf(context), input.userId);
      }),

    adminRevokeUserSession: builder.adminRevokeUserSession
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input, context }) {
        const admin = yield* AdminUsersService;
        return yield* admin.revokeUserSession(headersOf(context), input.sessionToken);
      }),

    adminRevokeUserSessions: builder.adminRevokeUserSessions
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input, context }) {
        const admin = yield* AdminUsersService;
        return yield* admin.revokeUserSessions(headersOf(context), input.userId);
      }),

    adminSetUserPassword: builder.adminSetUserPassword
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input, context }) {
        const admin = yield* AdminUsersService;
        return yield* admin.setUserPassword(headersOf(context), input.userId, input.newPassword);
      }),

    adminRemoveUser: builder.adminRemoveUser
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input, context }) {
        const admin = yield* AdminUsersService;
        return yield* admin.removeUser(headersOf(context), input.userId);
      }),
  };
}
