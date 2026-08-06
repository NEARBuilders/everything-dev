import { createPlugin } from "every-plugin";
import { Effect, Layer } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { contract } from "./contract";
import { DatabaseLive } from "./db/layer";
import { createAuthMiddleware } from "./lib/auth";
import { ContextSchema } from "./lib/context";
import type { PluginsClient } from "./lib/plugins-types.gen";
import { TenantsLive, TenantsTag } from "./services/tenants";

const SUBDOMAIN_SEGMENT_REGEX = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const ACCOUNT_ID_REGEX =
  /^(?=.{2,64}$)([a-z0-9]+(?:[-_][a-z0-9]+)*)(\.([a-z0-9]+(?:[-_][a-z0-9]+)*))*$/;
const RESERVED_SUBDOMAINS = new Set([
  "root",
  "www",
  "admin",
  "api",
  "dashboard",
  "mail",
  "status",
  "help",
  "support",
  "docs",
  "blog",
  "dev",
  "test",
  "app",
  "beta",
  "demo",
  "staging",
  "internal",
  "moderation",
  "abuse",
]);

function validateSubdomain(subdomain: string): void {
  if (!SUBDOMAIN_SEGMENT_REGEX.test(subdomain)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Invalid subdomain format",
      data: { hint: "Lowercase alphanumeric with hyphens or underscores only" },
    });
  }
}

function validateAccountId(accountId: string): void {
  if (!ACCOUNT_ID_REGEX.test(accountId)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Invalid accountId format",
      data: { hint: "Must be a valid NEAR account ID" },
    });
  }
}

export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({}),

  secrets: z.object({
    API_DATABASE_URL: z.string().default("pglite:.bos/api/:memory:"),
  }),

  context: ContextSchema,

  contract,

  initialize: (config, _plugins, tools) =>
    Effect.gen(function* () {
      const database = DatabaseLive(config.secrets.API_DATABASE_URL);
      const tenantsLayer = TenantsLive.pipe(Layer.provide(database));

      const tenantsService = yield* tools.buildService(TenantsTag, tenantsLayer);

      console.log("[API] Services Initialized");

      return {
        tenants: tenantsService,
      };
    }),

  shutdown: () => Effect.log("[API] Shutdown"),

  createRouter: (services, builder) => {
    const { requireAuth, requireOrganization, requireOrgRole } = createAuthMiddleware(builder);

    const authorizedTenant = async (
      input: { tenantId: string },
      context: { organization: { activeOrganizationId: string } },
    ) => {
      const activeOrgId = context.organization.activeOrganizationId;
      const tenant = await services.tenants.resolveTenantById(input.tenantId);
      if (!tenant) {
        throw new ORPCError("NOT_FOUND", {
          message: "Tenant not found",
          data: { resource: "tenant", resourceId: input.tenantId },
        });
      }
      if (tenant.orgId !== activeOrgId) {
        throw new ORPCError("FORBIDDEN", {
          message: "You are not a member of this tenant's organization",
        });
      }
      return tenant;
    };

    return {
      ping: builder.ping.handler(async () => ({
        status: "ok",
        timestamp: new Date().toISOString(),
      })),

      authHealth: builder.authHealth.use(requireAuth).handler(async () => ({
        status: "ok",
        emailConfigured: !!process.env.EMAIL_PROVIDER,
        smsConfigured: !!process.env.SMS_PROVIDER,
      })),

      listTenants: builder.listTenants.use(requireAuth).handler(async ({ context }) => {
        const orgIds = (context as Record<string, unknown>).organizations as
          | { id: string }[]
          | undefined;
        return services.tenants.listTenantsByOrgIds((orgIds ?? []).map((o) => o.id));
      }),

      createTenant: builder.createTenant
        .use(requireAuth)
        .use(requireOrganization)
        .handler(async ({ input, context }) => {
          const orgId = context.organization.activeOrganizationId;
          validateSubdomain(input.subdomain);
          validateAccountId(input.accountId);
          if (!input.accountId.startsWith(`${input.subdomain}.`)) {
            throw new ORPCError("BAD_REQUEST", {
              message: "accountId must start with subdomain",
              data: { subdomain: input.subdomain, accountId: input.accountId },
            });
          }
          return await services.tenants.createTenant({
            subdomain: input.subdomain,
            name: input.name,
            accountId: input.accountId,
            orgId,
          });
        }),

      updateTenant: builder.updateTenant
        .use(requireAuth)
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) => {
          const tenant = await authorizedTenant(input, context);
          if (input.subdomain !== undefined) validateSubdomain(input.subdomain);
          return await services.tenants.updateTenant(tenant.id, {
            name: input.name,
            subdomain: input.subdomain,
          });
        }),

      deleteTenant: builder.deleteTenant
        .use(requireAuth)
        .use(requireOrgRole("owner"))
        .handler(async ({ input, context }) => {
          await authorizedTenant(input, context);
          const result = await services.tenants.softDeleteTenant(input.tenantId);
          if (!result) {
            throw new ORPCError("NOT_FOUND", {
              message: "Tenant not found",
              data: { resource: "tenant", resourceId: input.tenantId },
            });
          }
          return result;
        }),

      suspendTenant: builder.suspendTenant
        .use(requireAuth)
        .use(requireOrgRole("admin"))
        .handler(async ({ input, context }) => {
          await authorizedTenant(input, context);
          const result = await services.tenants.suspendTenant(input.tenantId);
          if (!result) {
            throw new ORPCError("NOT_FOUND", {
              message: "Tenant not found",
              data: { resource: "tenant", resourceId: input.tenantId },
            });
          }
          return result;
        }),

      reactivateTenant: builder.reactivateTenant
        .use(requireAuth)
        .use(requireOrgRole("admin"))
        .handler(async ({ input, context }) => {
          await authorizedTenant(input, context);
          const result = await services.tenants.reactivateTenant(input.tenantId);
          if (!result) {
            throw new ORPCError("NOT_FOUND", {
              message: "Tenant not found",
              data: { resource: "tenant", resourceId: input.tenantId },
            });
          }
          return result;
        }),

      resolveTenant: builder.resolveTenant.handler(async ({ input, errors }) => {
        const tenant = await services.tenants.resolveTenantByAccountId(input.accountId);
        if (!tenant) {
          throw errors.NOT_FOUND({
            message: "Tenant not found",
            data: { resource: "tenant", resourceId: input.accountId },
          });
        }
        return tenant;
      }),

      resolveTenantByOrgId: builder.resolveTenantByOrgId.handler(async ({ input, errors }) => {
        const tenant = await services.tenants.resolveTenantByOrgId(input.orgId);
        if (!tenant) {
          throw errors.NOT_FOUND({
            message: "Tenant not found",
            data: { resource: "tenant", resourceId: input.orgId },
          });
        }
        return tenant;
      }),

      tenantPreflight: builder.tenantPreflight
        .use(requireAuth)
        .handler(async ({ input }) => {
          const subdomainValid = SUBDOMAIN_SEGMENT_REGEX.test(input.subdomain);
          const accountId = `${input.subdomain}.${input.parentAccount}`;
          const accountFormat = ACCOUNT_ID_REGEX.test(accountId) ? ("valid" as const) : ("invalid" as const);

          const reserved = RESERVED_SUBDOMAINS.has(input.subdomain);
          const existingSubdomain = subdomainValid
            ? await services.tenants.resolveTenantBySubdomain(input.subdomain)
            : null;
          const subdomainAvailable = subdomainValid && !reserved && !existingSubdomain;

          const existingAccount = subdomainValid
            ? await services.tenants.resolveTenantByAccountId(accountId)
            : null;
          const accountAvailable = accountFormat === "valid" && !existingAccount;

          return {
            subdomain: { available: !reserved && !existingSubdomain, reserved },
            accountId: { format: accountFormat, available: accountAvailable },
          };
        }),
    };
  },
});