import type { Implementer } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import type { ContractType } from "../contract";
import { DatabaseTag } from "../db/layer";
import * as schema from "../db/schema";
import type { AuthHandlerContext, RequireAuthMiddleware } from "../middleware";
import { AuthApiTag } from "../service-types";
import {
  canReadMemberEmails,
  createHeaders,
  hasOrgPermission,
  parseMemberRoles,
  visibleEmail,
} from "../utils";
import { attemptAuth, attemptDb } from "./attempts";

export function createMemberHandlers(
  builder: Implementer<ContractType, AuthHandlerContext>,
  requireAuth: RequireAuthMiddleware,
) {
  return {
    exportMembers: builder.exportMembers.use(requireAuth).effect(function* ({
      input,
      context,
      errors,
    }) {
      const { auth } = yield* AuthApiTag;
      const emailAllowed = yield* Effect.promise(() =>
        canReadMemberEmails(auth, context, input?.organizationId),
      );
      if (!emailAllowed) {
        return yield* Effect.fail(
          errors.FORBIDDEN({
            message: "You do not have permission to export member emails",
            data: {},
          }),
        );
      }
      const result = yield* attemptAuth(() =>
        auth.api.listMembers({
          headers: createHeaders(context.reqHeaders),
          query: {
            organizationId: input.organizationId,
            limit: 1000,
          },
        }),
      );
      const rows = [
        "name,email,role",
        ...(result.members ?? []).map((m: any) => {
          const name = (m.user?.name ?? "").replace(/[\r\n,]/g, " ").trim();
          const email = m.user?.email ?? "";
          const safe = String(email).replace(/[\r\n]/g, "");
          return `${name},${safe},${m.role}`;
        }),
      ];
      return { csv: rows.join("\n") };
    }),

    getActiveMember: builder.getActiveMember.use(requireAuth).effect(function* ({
      context,
      input,
    }) {
      const { auth } = yield* AuthApiTag;
      const headers = createHeaders(context.reqHeaders);
      const member = yield* attemptAuth(() =>
        auth.api.getActiveMember({
          headers,
          query: input?.organizationId ? { organizationId: input.organizationId } : undefined,
        }),
      );

      if (!member) {
        return { id: null, role: null, organizationId: null };
      }

      return {
        id: member.id,
        role: member.role,
        organizationId: member.organizationId ?? null,
      };
    }),

    getActiveMemberRole: builder.getActiveMemberRole.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const { auth } = yield* AuthApiTag;
      const result = yield* attemptAuth(() =>
        auth.api.getActiveMemberRole({
          headers: createHeaders(context.reqHeaders),
          query: input?.organizationId ? { organizationId: input.organizationId } : undefined,
        }),
      );
      const role = typeof result === "string" ? result : ((result as any)?.role ?? null);
      return { role };
    }),

    listMembers: builder.listMembers.use(requireAuth).effect(function* ({ input, context }) {
      const { auth } = yield* AuthApiTag;
      const result = yield* attemptAuth(() =>
        auth.api.listMembers({
          headers: createHeaders(context.reqHeaders),
          query: {
            organizationId: input.organizationId,
            limit: input.limit,
            offset: input.offset,
          },
        }),
      );
      const emailAllowed = yield* Effect.promise(() =>
        canReadMemberEmails(auth, context, input?.organizationId),
      );
      return {
        members: (result.members ?? []).map((m: any) => ({
          id: m.id,
          userId: m.userId,
          organizationId: m.organizationId,
          role: m.role,
          createdAt: m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt),
          user: m.user
            ? {
                id: m.user.id,
                name: m.user.name,
                email: visibleEmail(m.user.email, {
                  allowed: emailAllowed,
                  isSelf: m.userId === (context.userId ?? context.user?.id),
                }),
                image: m.user.image,
              }
            : null,
        })),
        total: result.total,
      };
    }),

    addMember: builder.addMember.use(requireAuth).effect(function* ({ input, context, errors }) {
      const { auth } = yield* AuthApiTag;
      const db = yield* DatabaseTag;
      const headers = createHeaders(context.reqHeaders);
      const session = input.organizationId
        ? null
        : yield* attemptAuth(() => auth.api.getSession({ headers }));
      const activeSession = session
        ? yield* attemptDb(() =>
            db.query.session.findFirst({
              where: eq(schema.session.id, session.session.id),
            }),
          )
        : null;
      const organizationId = input.organizationId ?? activeSession?.activeOrganizationId;
      if (!organizationId) {
        return yield* Effect.fail(
          errors.BAD_REQUEST({ message: "No active organization", data: {} }),
        );
      }
      if (context.user?.role !== "admin") {
        const { permitted, failure } = yield* Effect.promise(() =>
          hasOrgPermission(auth, context, organizationId, { member: ["create"] }),
        );
        if (
          failure &&
          (failure.code === "INTERNAL_SERVER_ERROR" || failure.code === "SERVICE_UNAVAILABLE")
        ) {
          return yield* Effect.fail(failure);
        }
        if (!permitted) {
          return yield* Effect.fail(
            errors.FORBIDDEN({
              message: "Only organization owners and admins can add members",
              data: { requiredPermissions: ["member:create"] },
            }),
          );
        }
        if (input.role === "owner") {
          const caller = yield* attemptDb(() =>
            db.query.member.findFirst({
              where: and(
                eq(schema.member.organizationId, organizationId),
                eq(schema.member.userId, context.userId),
              ),
            }),
          );
          if (!parseMemberRoles(caller?.role).includes("owner")) {
            return yield* Effect.fail(
              errors.FORBIDDEN({
                message: "Only organization owners can add owners",
                data: { action: "add-owner" },
              }),
            );
          }
        }
      }
      const organization = yield* attemptDb(() =>
        db.query.organization.findFirst({
          where: eq(schema.organization.id, organizationId),
        }),
      );
      if (!organization) {
        return yield* Effect.fail(
          errors.NOT_FOUND({
            message: "Organization not found",
            data: { resource: "organization", resourceId: organizationId },
          }),
        );
      }
      if (organization.status !== "active") {
        return yield* Effect.fail(
          errors.FORBIDDEN({
            message: "Organization approval is required",
            data: { action: "add-member" },
          }),
        );
      }
      const result = yield* attemptAuth(() =>
        auth.api.addMember({
          headers,
          body: {
            userId: input.userId,
            role: input.role,
            organizationId,
          },
        }),
      );
      return {
        id: result.id,
        userId: result.userId,
        organizationId: result.organizationId,
        role: result.role,
        createdAt: result.createdAt instanceof Date ? result.createdAt : new Date(result.createdAt),
      };
    }),

    removeMember: builder.removeMember.use(requireAuth).effect(function* ({ input, context }) {
      const { auth } = yield* AuthApiTag;
      yield* attemptAuth(() =>
        auth.api.removeMember({
          headers: createHeaders(context.reqHeaders),
          body: {
            memberIdOrEmail: input.memberIdOrEmail,
            organizationId: input.organizationId,
          },
        }),
      );
      return { success: true };
    }),

    updateMemberRole: builder.updateMemberRole.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const { auth } = yield* AuthApiTag;
      const emailAllowed = yield* Effect.promise(() =>
        canReadMemberEmails(auth, context, input?.organizationId),
      );
      const result = yield* attemptAuth(() =>
        auth.api.updateMemberRole({
          headers: createHeaders(context.reqHeaders),
          body: {
            role: input.role,
            memberId: input.memberId,
            organizationId: input.organizationId,
          },
        }),
      );
      return {
        id: result.id,
        userId: result.userId,
        organizationId: result.organizationId,
        role: result.role,
        createdAt: result.createdAt instanceof Date ? result.createdAt : new Date(result.createdAt),
        user: result.user
          ? {
              id: result.user.id,
              name: result.user.name,
              email: visibleEmail(result.user.email, {
                allowed: emailAllowed,
                isSelf: result.userId === (context.userId ?? context.user?.id),
              }),
              image: result.user.image ?? null,
            }
          : null,
      };
    }),
  };
}
