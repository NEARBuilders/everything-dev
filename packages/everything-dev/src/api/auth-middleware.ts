/**
 * Server-side auth middleware factory — framework home for the factory that
 * used to live as five near-identical copies (`api/src/lib/auth.ts` and each
 * plugin's `src/lib/auth.ts`). See citynode.app#207.
 *
 * Generic over the workspace's auth context (the generated `AuthPluginContext`
 * satisfies `AuthContextShape`), so each workspace imports the same factory and
 * passes its own context type for precise middleware narrowing:
 *
 *   const { requireAuth, requireAdmin, ... } = createAuthMiddleware<AuthContext>(builder);
 */
import type { DecoratedMiddleware } from "@orpc/server";
import { ORPCError } from "@orpc/server";
import type { z } from "zod";

/** Structural minimum the middlewares read — the generated `AuthPluginContext` satisfies it. */
export interface AuthContextShape {
  user?: { role?: string | null } | null;
  userId?: string | null;
  apiKey?: { permissions?: Record<string, string[]> | null } | null;
  organization?: {
    activeOrganizationId?: string | null;
    member?: { id?: string | null; role?: string | null } | null;
    organization?: { metadata?: Record<string, unknown> | null } | null;
  } | null;
}

type OrgMetaType<TSchema extends z.ZodType | undefined> = TSchema extends z.ZodType
  ? z.infer<TSchema>
  : Record<string, unknown>;

export function createAuthMiddleware<
  TContext extends AuthContextShape = AuthContextShape,
  TOrgMetaSchema extends z.ZodType | undefined = undefined,
>(builder: any, options?: { orgMetaSchema?: TOrgMetaSchema }) {
  // TContext is used as-is (no intersection) so the narrowed middleware
  // outputs stay exactly the workspace's own types when it passes its
  // AuthPluginContext — the constraint only guarantees the guards can read
  // the structural props.
  type Ctx = TContext;
  type TOrgMeta = OrgMetaType<TOrgMetaSchema>;
  type UserMiddleware = DecoratedMiddleware<
    Ctx,
    { userId: string; user: NonNullable<Ctx["user"]> },
    any,
    any,
    any
  >;
  type OrgMiddleware = DecoratedMiddleware<
    Ctx,
    {
      userId: string;
      user: NonNullable<Ctx["user"]>;
      organization: NonNullable<Ctx["organization"]> & {
        activeOrganizationId: string;
        organization:
          | (NonNullable<NonNullable<Ctx["organization"]>["organization"]> & {
              metadata: TOrgMeta | null;
            })
          | null;
      };
    },
    any,
    any,
    any
  >;
  type MemberMiddleware = DecoratedMiddleware<
    Ctx,
    {
      userId: string;
      user: NonNullable<Ctx["user"]>;
      organization: NonNullable<Ctx["organization"]> & {
        activeOrganizationId: string;
        member: NonNullable<NonNullable<Ctx["organization"]>["member"]>;
        organization:
          | (NonNullable<NonNullable<Ctx["organization"]>["organization"]> & {
              metadata: TOrgMeta | null;
            })
          | null;
      };
    },
    any,
    any,
    any
  >;
  type ApiKeyMiddleware = DecoratedMiddleware<
    Ctx,
    { apiKey: NonNullable<Ctx["apiKey"]> },
    any,
    any,
    any
  >;

  const requireAuth = builder.middleware(async ({ context, next }: { context: Ctx; next: any }) => {
    if (!context.user || !context.userId) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Authentication required",
        data: { hint: "Sign in to continue" },
      });
    }
    return next({ context: { userId: context.userId, user: context.user } });
  }) as UserMiddleware;

  const requireAuthOrApiKey = builder.middleware(
    async ({ context, next }: { context: Ctx; next: any }) => {
      if (!context.user && !context.userId && !context.apiKey) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { hint: "Sign in or provide an API key" },
        });
      }
      return next({ context });
    },
  ) as DecoratedMiddleware<Ctx, Record<string, never>, any, any, any>;

  const requireRole = <TRoles extends readonly string[]>(...roles: TRoles) =>
    builder.middleware(async ({ context, next }: { context: Ctx; next: any }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { authType: "session", hint: "Sign in to continue" },
        });
      }
      const currentRole = context.user.role;
      if (!currentRole || !roles.includes(currentRole)) {
        throw new ORPCError("FORBIDDEN", {
          message: `Requires role: ${roles.join(" or ")}`,
          data: { requiredRoles: roles, currentRole },
        });
      }
      return next({ context: { userId: context.userId, user: context.user } });
    }) as UserMiddleware;

  const requireAdmin = requireRole("admin");

  const requireOrganization = builder.middleware(
    async ({ context, next }: { context: Ctx; next: any }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { authType: "session", hint: "Sign in to continue" },
        });
      }
      if (!context.organization?.activeOrganizationId) {
        throw new ORPCError("FORBIDDEN", {
          message: "Active organization required",
          data: { hint: "Select or create an organization" },
        });
      }
      const org = context.organization;
      return next({
        context: {
          userId: context.userId,
          user: context.user,
          organization: {
            ...org,
            activeOrganizationId: org.activeOrganizationId,
            organization: org.organization
              ? {
                  ...org.organization,
                  metadata: parseOrgMetadata(org.organization.metadata, options?.orgMetaSchema),
                }
              : null,
          },
        },
      });
    },
  ) as OrgMiddleware;

  const requireOrgRole = <TRoles extends readonly string[]>(...roles: TRoles) =>
    builder.middleware(async ({ context, next }: { context: Ctx; next: any }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { authType: "session", hint: "Sign in to continue" },
        });
      }
      if (!context.organization?.activeOrganizationId) {
        throw new ORPCError("FORBIDDEN", {
          message: "Active organization required",
          data: { hint: "Select or create an organization" },
        });
      }
      const member = context.organization?.member;
      if (!member?.id || !member?.role || !roles.includes(member.role)) {
        throw new ORPCError("FORBIDDEN", {
          message: `Requires organization role: ${roles.join(" or ")}`,
          data: { requiredRoles: roles, currentRole: member?.role ?? null },
        });
      }
      const org = context.organization;
      return next({
        context: {
          userId: context.userId,
          user: context.user,
          organization: {
            ...org,
            activeOrganizationId: org.activeOrganizationId,
            member: { id: member.id, role: member.role },
            organization: org.organization
              ? {
                  ...org.organization,
                  metadata: parseOrgMetadata(org.organization.metadata, options?.orgMetaSchema),
                }
              : null,
          },
        },
      });
    }) as MemberMiddleware;

  const requireApiKey = (requiredPermissions?: Record<string, string[]>) =>
    builder.middleware(async ({ context, next }: { context: Ctx; next: any }) => {
      if (!context.apiKey) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "API key required",
          data: { authType: "apiKey", hint: "Provide a valid API key via x-api-key header" },
        });
      }
      if (requiredPermissions) {
        const keyPerms = context.apiKey.permissions ?? {};
        for (const [resource, actions] of Object.entries(requiredPermissions)) {
          const allowed = keyPerms[resource] ?? [];
          const missing = actions.filter((a: string) => !allowed.includes(a));
          if (missing.length > 0) {
            throw new ORPCError("FORBIDDEN", {
              message: `API key lacks permission: ${resource}:${missing.join(",")}`,
              data: { requiredPermissions, keyPermissions: keyPerms },
            });
          }
        }
      }
      return next({ context: { apiKey: context.apiKey } });
    }) as ApiKeyMiddleware;

  return {
    requireAuth,
    requireAuthOrApiKey,
    requireRole,
    requireAdmin,
    requireOrganization,
    requireOrgRole,
    requireApiKey,
  };
}

function parseOrgMetadata<TSchema extends z.ZodType | undefined>(
  raw: Record<string, unknown> | null | undefined,
  schema: TSchema | undefined,
): OrgMetaType<TSchema> | null {
  if (!raw) return null;
  if (!schema) return raw as OrgMetaType<TSchema>;
  const result = schema.safeParse(raw);
  if (result.success) return result.data as OrgMetaType<TSchema>;
  throw new ORPCError("INTERNAL_SERVER_ERROR", {
    message: "Invalid organization metadata",
    data: { errors: result.error.issues },
  });
}
