import { type Implementer, ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import type { ContractType, InferInput } from "../contract";
import { DatabaseTag } from "../db/layer";
import * as schema from "../db/schema";
import type { AuthHandlerContext, AuthSessionUser, RequireAuthMiddleware } from "../middleware";
import { toOrganizationInfo } from "../serializers";
import { AuthApiTag, type PluginServices } from "../service-types";
import {
  canReadMemberEmails,
  createHeaders,
  parseTeamAreas,
  toORPCError,
  tryJsonParse,
} from "../utils";
import { attemptAuth, attemptDb } from "./attempts";

async function getFullOrganizationOrNull(
  auth: PluginServices["auth"],
  context: AuthHandlerContext & { userId: string; user: AuthSessionUser },
  input: InferInput<"getFullOrganization">,
) {
  try {
    const emailAllowed = await canReadMemberEmails(auth, context, input?.organizationId);
    const result = await auth.api.getFullOrganization({
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
      createdAt: result.createdAt instanceof Date ? result.createdAt : new Date(result.createdAt),
      members: (result.members ?? []).map((m: any) => ({
        id: m.id,
        userId: m.userId,
        organizationId: m.organizationId,
        role: m.role,
        createdAt: m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt),
      })),
      invitations: (result.invitations ?? []).map((inv: any) => ({
        ...inv,
        email: emailAllowed ? inv.email : null,
        expiresAt: inv.expiresAt instanceof Date ? inv.expiresAt : new Date(inv.expiresAt),
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
  } catch (error) {
    const mapped = toORPCError(error);
    if (mapped.code === "NOT_FOUND" || mapped.code === "BAD_REQUEST") return null;
    throw mapped;
  }
}

export function createOrganizationHandlers(
  builder: Implementer<ContractType, AuthHandlerContext>,
  requireAuth: RequireAuthMiddleware,
) {
  return {
    listOrganizations: builder.listOrganizations.use(requireAuth).effect(function* ({ context }) {
      const { auth } = yield* AuthApiTag;
      const result = yield* attemptAuth(() =>
        auth.api.listOrganizations({
          headers: createHeaders(context.reqHeaders),
        }),
      );
      return result.map((org: any) => ({
        ...toOrganizationInfo(org),
        createdAt: org.createdAt instanceof Date ? org.createdAt : new Date(org.createdAt),
      }));
    }),

    getFullOrganization: builder.getFullOrganization.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const { auth } = yield* AuthApiTag;
      return yield* attemptAuth(() => getFullOrganizationOrNull(auth, context, input));
    }),

    getOrganizationForAdmin: builder.getOrganizationForAdmin.use(requireAuth).effect(function* ({
      input,
      context,
      errors,
    }) {
      const db = yield* DatabaseTag;
      if (context.user.role !== "admin") {
        return yield* Effect.fail(
          errors.FORBIDDEN({ message: "Admin access required", data: { action: "admin-access" } }),
        );
      }
      const organization = yield* attemptDb(() =>
        db.query.organization.findFirst({
          where: eq(schema.organization.id, input.organizationId),
        }),
      );
      if (!organization) return null;
      return toOrganizationInfo(organization);
    }),

    createOrganization: builder.createOrganization.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const { auth } = yield* AuthApiTag;
      const result = yield* attemptAuth(() =>
        auth.api.createOrganization({
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
        createdAt: result.createdAt instanceof Date ? result.createdAt : new Date(result.createdAt),
      };
    }),

    setActiveOrganization: builder.setActiveOrganization.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const { auth } = yield* AuthApiTag;
      yield* attemptAuth(() =>
        auth.api.setActiveOrganization({
          headers: createHeaders(context.reqHeaders),
          body: { organizationId: input.organizationId },
        }),
      );
      return { success: true };
    }),

    updateOrganization: builder.updateOrganization.use(requireAuth).effect(function* ({
      input,
      context,
      errors,
    }) {
      const { auth } = yield* AuthApiTag;
      const result = yield* attemptAuth(() =>
        auth.api.updateOrganization({
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
        return yield* Effect.fail(
          errors.NOT_FOUND({
            message: "Organization not found",
            data: { resource: "organization", resourceId: input.organizationId },
          }),
        );
      }
      return toOrganizationInfo(result);
    }),

    leaveOrganization: builder.leaveOrganization.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const { auth } = yield* AuthApiTag;
      yield* attemptAuth(() =>
        auth.api.leaveOrganization({
          headers: createHeaders(context.reqHeaders),
          body: { organizationId: input.organizationId },
        }),
      );
      return { success: true };
    }),

    deleteOrganization: builder.deleteOrganization.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const { auth } = yield* AuthApiTag;
      yield* attemptAuth(() =>
        auth.api.deleteOrganization({
          headers: createHeaders(context.reqHeaders),
          body: { organizationId: input.organizationId },
        }),
      );
      return { success: true };
    }),

    checkSlug: builder.checkSlug.effect(function* ({ input }) {
      const { auth } = yield* AuthApiTag;
      return yield* attemptAuth(() =>
        auth.api.checkOrganizationSlug({
          body: { slug: input.slug },
        }),
      ).pipe(
        Effect.map((result) => ({ status: result.status })),
        Effect.catchIf(
          (error) => error instanceof ORPCError && error.code === "BAD_REQUEST",
          () => Effect.succeed({ status: false } as const),
        ),
      );
    }),

    hasPermission: builder.hasPermission.use(requireAuth).effect(function* ({ input, context }) {
      const { auth } = yield* AuthApiTag;
      const result = yield* attemptAuth(() =>
        (
          auth.api.hasPermission as (args: {
            headers: Headers;
            body: { organizationId?: string; permissions?: Record<string, string[]> };
          }) => Promise<{ success: boolean }>
        )({
          headers: createHeaders(context.reqHeaders),
          body: {
            organizationId: input.organizationId,
            permissions: input.permissions,
          },
        }),
      );
      return { success: result.success };
    }),

    linkDao: builder.linkDao.use(requireAuth).effect(function* ({ input, context, errors }) {
      const { auth } = yield* AuthApiTag;
      const db = yield* DatabaseTag;
      const headers = createHeaders(context.reqHeaders);
      const org = yield* attemptDb(() =>
        db.query.organization.findFirst({
          where: eq(schema.organization.id, input.organizationId),
        }),
      );
      if (!org) {
        return yield* Effect.fail(
          errors.NOT_FOUND({
            message: "Organization not found",
            data: { resource: "organization", resourceId: input.organizationId },
          }),
        );
      }

      const existingMetadata = tryJsonParse<Record<string, unknown>>(org.metadata) ?? {};
      existingMetadata.daoAccountId = input.daoAccountId;
      existingMetadata.daoNetwork = input.daoNetwork ?? "mainnet";

      yield* attemptAuth(() =>
        auth.api.updateOrganization({
          headers,
          body: {
            data: { metadata: existingMetadata },
            organizationId: input.organizationId,
          },
        }),
      );
      return { success: true };
    }),

    unlinkDao: builder.unlinkDao.use(requireAuth).effect(function* ({ input, context, errors }) {
      const { auth } = yield* AuthApiTag;
      const db = yield* DatabaseTag;
      const headers = createHeaders(context.reqHeaders);
      const org = yield* attemptDb(() =>
        db.query.organization.findFirst({
          where: eq(schema.organization.id, input.organizationId),
        }),
      );
      if (!org) {
        return yield* Effect.fail(
          errors.NOT_FOUND({
            message: "Organization not found",
            data: { resource: "organization", resourceId: input.organizationId },
          }),
        );
      }

      const existingMetadata = tryJsonParse<Record<string, unknown>>(org.metadata) ?? {};
      delete existingMetadata.daoAccountId;
      delete existingMetadata.daoNetwork;

      yield* attemptAuth(() =>
        auth.api.updateOrganization({
          headers,
          body: {
            data: { metadata: existingMetadata },
            organizationId: input.organizationId,
          },
        }),
      );
      return { success: true };
    }),

    getDao: builder.getDao.use(requireAuth).effect(function* ({ input, context, errors }) {
      const { auth } = yield* AuthApiTag;
      const result = yield* attemptAuth(() =>
        auth.api.getFullOrganization({
          headers: createHeaders(context.reqHeaders),
          query: { organizationId: input.organizationId },
        }),
      );
      if (!result) {
        return yield* Effect.fail(
          errors.NOT_FOUND({
            message: "Organization not found",
            data: { resource: "organization", resourceId: input.organizationId },
          }),
        );
      }
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
