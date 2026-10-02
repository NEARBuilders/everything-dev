import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { Context } from "effect";
import * as schema from "../db/schema";
import { AuthServicesTag } from "../service-types";
import { canReadMemberEmails, createHeaders, safeAuthApi, visibleEmail } from "../utils";

export function createMemberHandlers(builder: any, requireAuth: any) {
  return {
    exportMembers: builder.exportMembers
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const emailAllowed = await canReadMemberEmails(services, context, input?.organizationId);
        if (!emailAllowed) {
          throw new ORPCError("FORBIDDEN", {
            message: "You do not have permission to export member emails",
          });
        }
        const result = await safeAuthApi(() =>
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

    getActiveMember: builder.getActiveMember
      .use(requireAuth)
      .handler(async ({ context, input }: { context: any; input: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const headers = createHeaders(context.reqHeaders);
        const member = await safeAuthApi(() =>
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

    getActiveMemberRole: builder.getActiveMemberRole
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const result = await safeAuthApi(() =>
          services.auth.api.getActiveMemberRole({
            headers: createHeaders(context.reqHeaders),
            query: input?.organizationId ? { organizationId: input.organizationId } : undefined,
          }),
        );
        const role = typeof result === "string" ? result : ((result as any)?.role ?? null);
        return { role };
      }),

    listMembers: builder.listMembers
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const result = await safeAuthApi(() =>
          services.auth.api.listMembers({
            headers: createHeaders(context.reqHeaders),
            query: {
              organizationId: input.organizationId,
              limit: input.limit,
              offset: input.offset,
            },
          }),
        );
        const emailAllowed = await canReadMemberEmails(services, context, input?.organizationId);
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

    addMember: builder.addMember
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const headers = createHeaders(context.reqHeaders);
        const session = input.organizationId
          ? null
          : await safeAuthApi(() => services.auth.api.getSession({ headers }));
        const activeSession = session
          ? await services.db.query.session.findFirst({
              where: eq(schema.session.id, session.session.id),
            })
          : null;
        const organizationId = input.organizationId ?? activeSession?.activeOrganizationId;
        if (!organizationId) {
          throw new ORPCError("BAD_REQUEST", { message: "No active organization" });
        }
        const organization = await services.db.query.organization.findFirst({
          where: eq(schema.organization.id, organizationId),
        });
        if (!organization) {
          throw new ORPCError("NOT_FOUND", { message: "Organization not found" });
        }
        if (organization.status !== "active") {
          throw new ORPCError("FORBIDDEN", { message: "Organization approval is required" });
        }
        const result = await safeAuthApi(() =>
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
          createdAt:
            result.createdAt instanceof Date ? result.createdAt : new Date(result.createdAt),
        };
      }),

    removeMember: builder.removeMember
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        await safeAuthApi(() =>
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

    updateMemberRole: builder.updateMemberRole
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const emailAllowed = await canReadMemberEmails(services, context, input?.organizationId);
        const result = await safeAuthApi(() =>
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
          createdAt:
            result.createdAt instanceof Date ? result.createdAt : new Date(result.createdAt),
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
