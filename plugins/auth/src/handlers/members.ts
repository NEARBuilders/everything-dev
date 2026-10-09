import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import * as schema from "../db/schema";
import { AuthServicesTag } from "../service-types";
import {
  canReadMemberEmails,
  createHeaders,
  hasOrgPermission,
  parseMemberRoles,
  visibleEmail,
} from "../utils";
import { attemptAuth, attemptDb } from "./attempts";

export function createMemberHandlers(builder: any, requireAuth: any) {
  return {
    exportMembers: builder.exportMembers.use(requireAuth).effect(function* ({
      input,
      context,
    }: {
      input: any;
      context: any;
    }) {
      const services = yield* AuthServicesTag;
      const emailAllowed = yield* Effect.promise(() =>
        canReadMemberEmails(services, context, input?.organizationId),
      );
      if (!emailAllowed) {
        return yield* Effect.fail(
          new ORPCError("FORBIDDEN", {
            message: "You do not have permission to export member emails",
          }),
        );
      }
      const result = yield* attemptAuth(() =>
        services.auth.api.listMembers({
          headers: createHeaders(context.reqHeaders),
          query: {
            organizationId: input.organizationId,
            limit: 1000,
            offset: input.offset ?? 0,
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
    }: {
      context: any;
      input: any;
    }) {
      const services = yield* AuthServicesTag;
      const headers = createHeaders(context.reqHeaders);
      const member = yield* attemptAuth(() =>
        services.auth.api.getActiveMember({
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
    }: {
      input: any;
      context: any;
    }) {
      const services = yield* AuthServicesTag;
      const result = yield* attemptAuth(() =>
        services.auth.api.getActiveMemberRole({
          headers: createHeaders(context.reqHeaders),
          query: input?.organizationId ? { organizationId: input.organizationId } : undefined,
        }),
      );
      const role = typeof result === "string" ? result : ((result as any)?.role ?? null);
      return { role };
    }),

    listMembers: builder.listMembers.use(requireAuth).effect(function* ({
      input,
      context,
    }: {
      input: any;
      context: any;
    }) {
      const services = yield* AuthServicesTag;
      const result = yield* attemptAuth(() =>
        services.auth.api.listMembers({
          headers: createHeaders(context.reqHeaders),
          query: {
            organizationId: input.organizationId,
            limit: input.limit,
            offset: input.offset,
          },
        }),
      );
      const emailAllowed = yield* Effect.promise(() =>
        canReadMemberEmails(services, context, input?.organizationId),
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

    addMember: builder.addMember.use(requireAuth).effect(function* ({
      input,
      context,
    }: {
      input: any;
      context: any;
    }) {
      const services = yield* AuthServicesTag;
      const headers = createHeaders(context.reqHeaders);
      const session = input.organizationId
        ? null
        : yield* attemptAuth(() => services.auth.api.getSession({ headers }));
      const activeSession = session
        ? yield* attemptDb(() =>
            services.db.query.session.findFirst({
              where: eq(schema.session.id, session.session.id),
            }),
          )
        : null;
      const organizationId = input.organizationId ?? activeSession?.activeOrganizationId;
      if (!organizationId) {
        return yield* Effect.fail(
          new ORPCError("BAD_REQUEST", { message: "No active organization" }),
        );
      }
      if (context.user?.role !== "admin") {
        const { permitted, failure } = yield* Effect.promise(() =>
          hasOrgPermission(services, context, organizationId, { member: ["create"] }),
        );
        if (
          failure &&
          (failure.code === "INTERNAL_SERVER_ERROR" || failure.code === "SERVICE_UNAVAILABLE")
        ) {
          return yield* Effect.fail(failure);
        }
        if (!permitted) {
          return yield* Effect.fail(
            new ORPCError("FORBIDDEN", {
              message: "Only organization owners and admins can add members",
            }),
          );
        }
        if (input.role === "owner") {
          const caller = yield* attemptDb(() =>
            services.db.query.member.findFirst({
              where: and(
                eq(schema.member.organizationId, organizationId),
                eq(schema.member.userId, context.userId),
              ),
            }),
          );
          if (!parseMemberRoles(caller?.role).includes("owner")) {
            return yield* Effect.fail(
              new ORPCError("FORBIDDEN", { message: "Only organization owners can add owners" }),
            );
          }
        }
      }
      const organization = yield* attemptDb(() =>
        services.db.query.organization.findFirst({
          where: eq(schema.organization.id, organizationId),
        }),
      );
      if (!organization) {
        return yield* Effect.fail(
          new ORPCError("NOT_FOUND", { message: "Organization not found" }),
        );
      }
      if (organization.status !== "active") {
        return yield* Effect.fail(
          new ORPCError("FORBIDDEN", { message: "Organization approval is required" }),
        );
      }
      const result = yield* attemptAuth(() =>
        services.auth.api.addMember({
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

    removeMember: builder.removeMember.use(requireAuth).effect(function* ({
      input,
      context,
    }: {
      input: any;
      context: any;
    }) {
      const services = yield* AuthServicesTag;
      yield* attemptAuth(() =>
        services.auth.api.removeMember({
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
    }: {
      input: any;
      context: any;
    }) {
      const services = yield* AuthServicesTag;
      const emailAllowed = yield* Effect.promise(() =>
        canReadMemberEmails(services, context, input?.organizationId),
      );
      const result = yield* attemptAuth(() =>
        services.auth.api.updateMemberRole({
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
              image: result.user.image,
            }
          : null,
      };
    }),
  };
}
