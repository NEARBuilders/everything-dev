import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { attemptAuth, attemptDb } from "../attempts";
import { DatabaseTag } from "../db/layer";
import * as schema from "../db/schema";
import { toOrganizationInfo } from "../serializers";
import { AuthApiTag, type PluginServices } from "../service-types";
import {
  type AuthFailure,
  AuthApiError,
  mapDomainError,
  OrgApprovalRequired,
  OrgNotFound,
  OrgRequiresApproval,
} from "./domain-errors";
import {
  canReadMemberEmails,
  parseTeamAreas,
  toAuthApiError,
  tryJsonParse,
} from "../utils";
import { isAuthFailure } from "./domain-errors";

type Auth = PluginServices["auth"];
type Db = PluginServices["db"];

export interface OrganizationCaller {
  headers: Headers;
  reqHeaders?: Record<string, string>;
  user?: { role?: string | null } | null;
}

export class OrganizationsService extends Context.Service<
  OrganizationsService,
  {
    listOrganizations: (headers: Headers) => Effect.Effect<any, AuthFailure>;
    getFullOrganization: (
      caller: OrganizationCaller,
      input: {
        organizationId?: string;
        organizationSlug?: string;
        membersLimit?: number;
      },
    ) => Effect.Effect<any, AuthFailure>;
    getOrganizationById: (organizationId: string) => Effect.Effect<any, AuthFailure>;
    createOrganization: (
      headers: Headers,
      input: {
        name: string;
        slug: string;
        logo?: string | null;
        metadata?: Record<string, unknown>;
      },
    ) => Effect.Effect<any, AuthFailure>;
    setActiveOrganization: (
      headers: Headers,
      organizationId: string | null,
    ) => Effect.Effect<void, AuthFailure>;
    updateOrganization: (
      headers: Headers,
      input: {
        data: {
          name?: string;
          slug?: string;
          logo?: string | null;
          metadata?: Record<string, unknown>;
        };
        organizationId?: string;
      },
    ) => Effect.Effect<any, AuthFailure>;
    leaveOrganization: (
      headers: Headers,
      organizationId: string,
    ) => Effect.Effect<void, AuthFailure>;
    deleteOrganization: (
      headers: Headers,
      organizationId: string,
    ) => Effect.Effect<void, AuthFailure>;
    checkSlug: (slug: string) => Effect.Effect<{ status: boolean }, AuthFailure>;
    hasPermission: (
      headers: Headers,
      input: {
        organizationId?: string;
        permissions?: Record<string, string[]>;
      },
    ) => Effect.Effect<{ success: boolean }, AuthFailure>;
    linkDao: (
      headers: Headers,
      input: { organizationId: string; daoAccountId: string; daoNetwork?: string },
    ) => Effect.Effect<void, AuthFailure>;
    unlinkDao: (
      headers: Headers,
      input: { organizationId: string },
    ) => Effect.Effect<void, AuthFailure>;
    getDao: (
      headers: Headers,
      organizationId: string,
    ) => Effect.Effect<
      { daoAccountId: string | null; daoNetwork: "mainnet" | "testnet" | null },
      AuthFailure
    >;
  }
>()("auth/OrganizationsService") {}

export const buildOrganizationsService = ({ auth, db }: { auth: Auth; db: Db }) => {
  const notFound = (organizationId: string | undefined) =>
    new OrgNotFound({ message: "Organization not found", organizationId });

  const updateMetadata = (
    headers: Headers,
    organizationId: string | undefined,
    metadata: Record<string, unknown>,
  ) =>
    attemptAuth(() =>
      auth.api.updateOrganization({
        headers,
        body: { data: { metadata }, organizationId },
      }),
    );

  return {
    listOrganizations: (headers: Headers) =>
      attemptAuth(() => auth.api.listOrganizations({ headers })).pipe(
        Effect.map((result: any) =>
          result.map((org: any) => ({
            ...toOrganizationInfo(org),
            createdAt: org.createdAt instanceof Date ? org.createdAt : new Date(org.createdAt),
          })),
        ),
      ),

    getFullOrganization: (
      caller: OrganizationCaller,
      input: {
        organizationId?: string;
        organizationSlug?: string;
        membersLimit?: number;
      },
    ) =>
      Effect.tryPromise({
        try: async () => {
          try {
            const emailAllowed = await canReadMemberEmails(auth, caller, input.organizationId);
            const result = await auth.api.getFullOrganization({
              headers: caller.headers,
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
            const mapped = toAuthApiError(error);
            if (mapped.code === "NOT_FOUND" || mapped.code === "BAD_REQUEST") return null;
            throw mapped;
          }
        },
        catch: (error) => (isAuthFailure(error) ? error : toAuthApiError(error)),
      }),

    getOrganizationById: (organizationId: string) =>
      attemptDb(() =>
        db.query.organization.findFirst({
          where: eq(schema.organization.id, organizationId),
        }),
      ).pipe(
        Effect.map((organization) => (organization ? toOrganizationInfo(organization) : null)),
      ),

    createOrganization: (
      headers: Headers,
      input: {
        name: string;
        slug: string;
        logo?: string | null;
        metadata?: Record<string, unknown>;
      },
    ) =>
      attemptAuth(() =>
        auth.api.createOrganization({
          headers,
          body: {
            name: input.name,
            slug: input.slug,
            logo: input.logo,
            metadata: input.metadata,
          },
        }),
      ).pipe(
        Effect.map((result: any) => ({
          ...toOrganizationInfo(result),
          createdAt:
            result.createdAt instanceof Date ? result.createdAt : new Date(result.createdAt),
        })),
      ),

    setActiveOrganization: (headers: Headers, organizationId: string | null) =>
      attemptAuth(() =>
        auth.api.setActiveOrganization({
          headers,
          body: { organizationId },
        }),
      ).pipe(Effect.asVoid),

    updateOrganization: (
      headers: Headers,
      input: {
        data: {
          name?: string;
          slug?: string;
          logo?: string | null;
          metadata?: Record<string, unknown>;
        };
        organizationId?: string;
      },
    ) =>
      attemptAuth(() =>
        auth.api.updateOrganization({
          headers,
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
      ).pipe(
        Effect.flatMap((result) =>
          result
            ? Effect.succeed(toOrganizationInfo(result))
            : Effect.fail(notFound(input.organizationId)),
        ),
      ),

    leaveOrganization: (headers: Headers, organizationId: string) =>
      attemptAuth(() =>
        auth.api.leaveOrganization({
          headers,
          body: { organizationId },
        }),
      ).pipe(Effect.asVoid),

    deleteOrganization: (headers: Headers, organizationId: string) =>
      attemptAuth(() =>
        auth.api.deleteOrganization({
          headers,
          body: { organizationId },
        }),
      ).pipe(Effect.asVoid),

    checkSlug: (slug: string) =>
      attemptAuth(() => auth.api.checkOrganizationSlug({ body: { slug } })).pipe(
        Effect.map((result) => ({ status: result.status })),
        Effect.catchIf(
          (error) => error instanceof AuthApiError && error.code === "BAD_REQUEST",
          () => Effect.succeed({ status: false } as const),
        ),
      ),

    hasPermission: (
      headers: Headers,
      input: { organizationId?: string; permissions?: Record<string, string[]> },
    ) =>
      attemptAuth(() =>
        (
          auth.api.hasPermission as (args: {
            headers: Headers;
            body: { organizationId?: string; permissions?: Record<string, string[]> };
          }) => Promise<{ success: boolean }>
        )({
          headers,
          body: {
            organizationId: input.organizationId,
            permissions: input.permissions,
          },
        }),
      ).pipe(Effect.map((result) => ({ success: result.success }))),

    linkDao: (
      headers: Headers,
      input: { organizationId: string; daoAccountId: string; daoNetwork?: string },
    ) =>
      Effect.gen(function* () {
        const org = yield* attemptDb(() =>
          db.query.organization.findFirst({
            where: eq(schema.organization.id, input.organizationId),
          }),
        );
        if (!org) return yield* Effect.fail(notFound(input.organizationId));

        const existingMetadata = tryJsonParse<Record<string, unknown>>(org.metadata) ?? {};
        existingMetadata.daoAccountId = input.daoAccountId;
        existingMetadata.daoNetwork = input.daoNetwork ?? "mainnet";

        yield* updateMetadata(headers, input.organizationId, existingMetadata);
      }),

    unlinkDao: (headers: Headers, input: { organizationId: string }) =>
      Effect.gen(function* () {
        const org = yield* attemptDb(() =>
          db.query.organization.findFirst({
            where: eq(schema.organization.id, input.organizationId),
          }),
        );
        if (!org) return yield* Effect.fail(notFound(input.organizationId));

        const existingMetadata = tryJsonParse<Record<string, unknown>>(org.metadata) ?? {};
        delete existingMetadata.daoAccountId;
        delete existingMetadata.daoNetwork;

        yield* updateMetadata(headers, input.organizationId, existingMetadata);
      }),

    getDao: (headers: Headers, organizationId: string) =>
      attemptAuth(() =>
        auth.api.getFullOrganization({
          headers,
          query: { organizationId },
        }),
      ).pipe(
        Effect.flatMap((result) => {
          if (!result) return Effect.fail(notFound(organizationId));
          const metadata =
            (typeof result.metadata === "string"
              ? tryJsonParse<Record<string, unknown>>(result.metadata)
              : (result.metadata as Record<string, unknown> | null | undefined)) ?? null;
          return Effect.succeed({
            daoAccountId: (metadata?.daoAccountId as string) ?? null,
            daoNetwork: (metadata?.daoNetwork as "mainnet" | "testnet") ?? null,
          });
        }),
      ),
  };
};

export type OrganizationsServiceShape = ReturnType<typeof buildOrganizationsService>;

export const OrganizationsServiceLive = Layer.effect(
  OrganizationsService,
  Effect.gen(function* () {
    const { auth } = yield* AuthApiTag;
    const db = yield* DatabaseTag;
    return buildOrganizationsService({ auth, db });
  }),
);
