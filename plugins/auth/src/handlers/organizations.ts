import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { Context } from "effect";
import * as schema from "../db/schema";
import { AuthServicesTag } from "../service-types";
import { createHeaders, parseTeamAreas, safeAuthApi, tryJsonParse } from "../utils";

function toOrganizationInfo(organization: {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  metadata?: unknown;
}) {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    logo: organization.logo ?? null,
    metadata:
      typeof organization.metadata === "string"
        ? tryJsonParse<Record<string, unknown>>(organization.metadata)
        : ((organization.metadata as Record<string, unknown> | null | undefined) ?? null),
  };
}

export function createOrganizationHandlers(builder: any, requireAuth: any) {
  return {
    listOrganizations: builder.listOrganizations
      .use(requireAuth)
      .handler(async ({ context }: { context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const result = await safeAuthApi(() =>
          services.auth.api.listOrganizations({
            headers: createHeaders(context.reqHeaders),
          }),
        );
        return result.map((org: any) => ({
          ...toOrganizationInfo(org),
          createdAt: org.createdAt instanceof Date ? org.createdAt : new Date(org.createdAt),
        }));
      }),

    getFullOrganization: builder.getFullOrganization
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        try {
          const result = await services.auth.api.getFullOrganization({
            headers: createHeaders(context.reqHeaders),
            query: {
              organizationId: input.organizationId,
              organizationSlug: input.organizationSlug,
              membersLimit: input.membersLimit,
            },
          });
          if (!result) return null;
          return {
            ...toOrganizationInfo(result),
            createdAt:
              result.createdAt instanceof Date ? result.createdAt : new Date(result.createdAt),
            members: (result.members ?? []).map((m: any) => ({
              id: m.id,
              userId: m.userId,
              organizationId: m.organizationId,
              role: m.role,
              createdAt: m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt),
            })),
            invitations: (result.invitations ?? []).map((inv: any) => ({
              id: inv.id,
              organizationId: inv.organizationId,
              email: inv.email,
              role: inv.role,
              status: inv.status,
              expiresAt: inv.expiresAt instanceof Date ? inv.expiresAt : new Date(inv.expiresAt),
              inviterId: inv.inviterId,
            })),
            teams: result.teams
              ? result.teams.map((t: any) => ({
                  id: t.id,
                  name: t.name,
                  organizationId: t.organizationId,
                  areas: parseTeamAreas(t.metadata),
                  createdAt: t.createdAt instanceof Date ? t.createdAt : new Date(t.createdAt),
                  updatedAt: t.updatedAt instanceof Date ? t.updatedAt : new Date(t.updatedAt),
                }))
              : undefined,
          };
        } catch {
          return null;
        }
      }),

    getOrganizationForAdmin: builder.getOrganizationForAdmin
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        if (context.user.role !== "admin") {
          throw new ORPCError("FORBIDDEN", {
            message: "Admin access required",
          });
        }
        const organization = await services.db.query.organization.findFirst({
          where: eq(schema.organization.id, input.organizationId),
        });
        if (!organization) return null;
        return toOrganizationInfo(organization);
      }),

    createOrganization: builder.createOrganization
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const result = await safeAuthApi(() =>
          services.auth.api.createOrganization({
            headers: createHeaders(context.reqHeaders),
            body: {
              name: input.name,
              slug: input.slug,
              logo: input.logo,
              metadata: input.metadata,
            },
          }),
        );
        return {
          ...toOrganizationInfo(result),
          createdAt:
            result.createdAt instanceof Date ? result.createdAt : new Date(result.createdAt),
        };
      }),

    setActiveOrganization: builder.setActiveOrganization
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        await safeAuthApi(() =>
          services.auth.api.setActiveOrganization({
            headers: createHeaders(context.reqHeaders),
            body: { organizationId: input.organizationId },
          }),
        );
        return { success: true };
      }),

    updateOrganization: builder.updateOrganization
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const result = await safeAuthApi(() =>
          services.auth.api.updateOrganization({
            headers: createHeaders(context.reqHeaders),
            body: {
              data: {
                name: input.data.name,
                slug: input.data.slug,
                logo: input.data.logo,
                metadata: input.data.metadata,
              },
              organizationId: input.organizationId,
            },
          }),
        );
        if (!result) {
          throw new ORPCError("NOT_FOUND", {
            message: "Organization not found",
          });
        }
        return toOrganizationInfo(result);
      }),

    leaveOrganization: builder.leaveOrganization
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        await safeAuthApi(() =>
          services.auth.api.leaveOrganization({
            headers: createHeaders(context.reqHeaders),
            body: { organizationId: input.organizationId },
          }),
        );
        return { success: true };
      }),

    deleteOrganization: builder.deleteOrganization
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        await safeAuthApi(() =>
          services.auth.api.deleteOrganization({
            headers: createHeaders(context.reqHeaders),
            body: { organizationId: input.organizationId },
          }),
        );
        return { success: true };
      }),

    checkSlug: builder.checkSlug.handler(
      async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        try {
          const result = await services.auth.api.checkOrganizationSlug({
            body: { slug: input.slug },
          });
          return { status: result.status };
        } catch {
          return { status: false };
        }
      },
    ),

    hasPermission: builder.hasPermission
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const result = await safeAuthApi(() =>
          services.auth.api.hasPermission({
            headers: createHeaders(context.reqHeaders),
            body: {
              organizationId: input.organizationId,
              permissions: input.permissions,
            },
          }),
        );
        return { success: result.success };
      }),

    linkDao: builder.linkDao
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const headers = createHeaders(context.reqHeaders);
        const org = await services.db.query.organization.findFirst({
          where: eq(schema.organization.id, input.organizationId),
        });
        if (!org)
          throw new ORPCError("NOT_FOUND", {
            message: "Organization not found",
          });

        const existingMetadata = tryJsonParse<Record<string, unknown>>(org.metadata) ?? {};
        existingMetadata.daoAccountId = input.daoAccountId;
        existingMetadata.daoNetwork = input.daoNetwork ?? "mainnet";

        await safeAuthApi(() =>
          services.auth.api.updateOrganization({
            headers,
            body: {
              data: { metadata: existingMetadata },
              organizationId: input.organizationId,
            },
          }),
        );
        return { success: true };
      }),

    unlinkDao: builder.unlinkDao
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const headers = createHeaders(context.reqHeaders);
        const org = await services.db.query.organization.findFirst({
          where: eq(schema.organization.id, input.organizationId),
        });
        if (!org)
          throw new ORPCError("NOT_FOUND", {
            message: "Organization not found",
          });

        const existingMetadata = tryJsonParse<Record<string, unknown>>(org.metadata) ?? {};
        delete existingMetadata.daoAccountId;
        delete existingMetadata.daoNetwork;

        await safeAuthApi(() =>
          services.auth.api.updateOrganization({
            headers,
            body: {
              data: { metadata: existingMetadata },
              organizationId: input.organizationId,
            },
          }),
        );
        return { success: true };
      }),

    getDao: builder.getDao
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const result = await safeAuthApi(() =>
          services.auth.api.getFullOrganization({
            headers: createHeaders(context.reqHeaders),
            query: { organizationId: input.organizationId },
          }),
        );
        if (!result)
          throw new ORPCError("NOT_FOUND", {
            message: "Organization not found",
          });
        const metadata =
          (typeof result.metadata === "string"
            ? tryJsonParse<Record<string, unknown>>(result.metadata)
            : (result.metadata as Record<string, unknown> | null | undefined)) ?? null;
        return {
          daoAccountId: (metadata?.daoAccountId as string) ?? null,
          daoNetwork: (metadata?.daoNetwork as "mainnet" | "testnet") ?? null,
        };
      }),
  };
}
