import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { Errors } from "./errors";
import { adminSessionSchema, adminUserSchema } from "./schemas";

export const adminUsersRoutes = {
  adminListUsers: oc
    .route({
      method: "GET",
      path: "/v1/auth/admin/users",
      summary: "List platform users",
      description:
        "Requires the platform admin role. Search by email or name and paginate with limit/offset.",
    })
    .input(
      z
        .object({
          searchValue: z.string().optional(),
          searchField: z.enum(["email", "name"]).optional(),
          limit: z.number().int().positive().max(100).optional(),
          offset: z.number().int().nonnegative().optional(),
        })
        .optional(),
    )
    .output(z.object({ users: z.array(adminUserSchema), total: z.number() }))
    .errors(Errors),

  adminGetUser: oc
    .route({ method: "GET", path: "/v1/auth/admin/users/{userId}" })
    .input(z.object({ userId: z.string() }))
    .output(adminUserSchema)
    .errors(Errors),

  adminSetRole: oc
    .route({ method: "POST", path: "/v1/auth/admin/users/set-role" })
    .input(
      z.object({
        userId: z.string(),
        role: z.enum(["admin", "user"]),
      }),
    )
    .output(adminUserSchema)
    .errors(Errors),

  adminBanUser: oc
    .route({ method: "POST", path: "/v1/auth/admin/users/ban" })
    .input(
      z.object({
        userId: z.string(),
        banReason: z.string().trim().max(2000).optional(),
        banExpiresIn: z.number().int().positive().optional(),
      }),
    )
    .output(adminUserSchema)
    .errors(Errors),

  adminUnbanUser: oc
    .route({ method: "POST", path: "/v1/auth/admin/users/unban" })
    .input(z.object({ userId: z.string() }))
    .output(adminUserSchema)
    .errors(Errors),

  adminListUserSessions: oc
    .route({ method: "GET", path: "/v1/auth/admin/users/sessions" })
    .input(z.object({ userId: z.string() }))
    .output(z.object({ sessions: z.array(adminSessionSchema) }))
    .errors(Errors),

  adminRevokeUserSession: oc
    .route({ method: "POST", path: "/v1/auth/admin/users/sessions/revoke" })
    .input(z.object({ sessionToken: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  adminRevokeUserSessions: oc
    .route({ method: "POST", path: "/v1/auth/admin/users/sessions/revoke-all" })
    .input(z.object({ userId: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  adminSetUserPassword: oc
    .route({ method: "POST", path: "/v1/auth/admin/users/set-password" })
    .input(
      z.object({
        userId: z.string(),
        newPassword: z.string().min(8),
      }),
    )
    .output(z.object({ status: z.boolean() }))
    .errors(Errors),

  adminRemoveUser: oc
    .route({
      method: "POST",
      path: "/v1/auth/admin/users/remove",
      summary: "Remove a user",
      description:
        "Requires the platform admin role. Permanently deletes the user, their sessions, " +
        "and their accounts. This cannot be undone.",
    })
    .input(z.object({ userId: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),
};
