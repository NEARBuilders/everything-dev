import type { ContractedRouter } from "@orpc/server";
import { ORPCError } from "@orpc/server";
import { Cause, Context, DateTime, Effect, Exit, Layer } from "effect";
import { buildScopedContext, createPlugin } from "every-plugin";
import { createAuthMiddleware } from "everything-dev/api";
import { suppressPgQueryQueueDeprecation } from "everything-dev/db";
import { z } from "zod";
import { contract, type EventOnboardingCodeSchema } from "./contract";
import { DatabaseLive } from "./db/layer";
import type { AuthPluginContext as AuthContext } from "./lib/auth-types.gen";
import { ContextSchema } from "./lib/context";
import type { PluginsClient } from "./lib/plugins-types.gen";
import { verifyDaoMembership } from "./services/dao";
import type { DiscoveryService } from "./services/discovery";
import { DiscoveryLive, DiscoveryTag } from "./services/discovery";
import { GeocodeLive } from "./services/discovery-geocode";
import type { NodeEffect, NodeRecord, NodesService } from "./services/nodes";
import { NodesLive, NodesTag } from "./services/nodes";
import {
  buildBundleKey,
  bundleCacheControl,
  bundleContentType,
  computeObjectIntegrity,
  maxBundleUploadBytes,
  StorageLive,
  type StorageService,
  StorageTag,
  validateNamespacePart,
  validateObjectPath,
  validateUploadSize,
} from "./services/storage";
import type { TenantRecord, TenantsService } from "./services/tenants";
import { TenantsConfigLive, TenantsLive, TenantsTag } from "./services/tenants";
import type { ValidatorsService } from "./services/validators";
import { ValidatorsLive, ValidatorsTag } from "./services/validators";
import { createRequireTeamArea } from "./team-access-policy";

class ApiServices extends Context.Service<
  ApiServices,
  {
    tenants: TenantsService;
    nodes: NodesService;
    validators: ValidatorsService;
    discovery: DiscoveryService;
    storage: StorageService;
  }
>()("api/ApiServices") {}

const ONBOARDING_GRACE_MS = 48 * 3_600_000;

const ACCOUNT_ID_REGEX =
  /^(?=.{2,64}$)([a-z0-9]+(?:[-_][a-z0-9]+)*)(\.([a-z0-9]+(?:[-_][a-z0-9]+)*))*$/;

suppressPgQueryQueueDeprecation();

const HOSTNAME_REGEX =
  /^(?=.{1,253}$)(?=.{1,64}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.?$/;

const validateAccountId = (accountId: string): NodeEffect<void> =>
  ACCOUNT_ID_REGEX.test(accountId)
    ? Effect.void
    : Effect.fail(
        new ORPCError("BAD_REQUEST", {
          message: "Invalid accountId format",
          data: { hint: "Must be a valid NEAR account ID" },
        }),
      );

const validateHostname = (hostname: string): NodeEffect<void> => {
  const normalized = hostname.toLowerCase();
  return HOSTNAME_REGEX.test(normalized)
    ? Effect.void
    : Effect.fail(
        new ORPCError("BAD_REQUEST", {
          message: "Invalid hostname format",
          data: { hint: "Must be a valid DNS hostname" },
        }),
      );
};

function publishStatusFor(ownerAccountId: string): "pending_funding" | "ready" {
  return ownerAccountId.startsWith("0s") ? "pending_funding" : "ready";
}

interface NodeAccessContext {
  user?: { role?: string | null };
  organization?: { activeOrganizationId: string | null };
}

const resolveNodeForAccess = (
  services: { nodes: NodesService },
  nodeId: string,
): NodeEffect<NodeRecord> =>
  Effect.gen(function* () {
    const node = yield* services.nodes.getById(nodeId);
    if (!node) {
      return yield* Effect.fail(
        new ORPCError("NOT_FOUND", {
          message: "Node not found",
          data: { resource: "node", resourceId: nodeId },
        }),
      );
    }
    return node;
  });

const authorizeNodeAccess = (
  services: { tenants: TenantsService },
  node: NodeRecord,
  context: NodeAccessContext,
  options: { adminBypassOrg: boolean; resource: "node" | "validators" },
): NodeEffect<void> =>
  Effect.gen(function* () {
    if (!node.tenantId) {
      if (context.user?.role !== "admin") {
        return yield* Effect.fail(
          new ORPCError("FORBIDDEN", {
            message: "Standalone nodes can only be managed by platform admins",
          }),
        );
      }
      return;
    }
    const tenant = yield* services.tenants.resolveTenantById(node.tenantId!);
    if (!tenant) {
      return yield* Effect.fail(
        new ORPCError("NOT_FOUND", {
          message: "Tenant not found",
          data: { resource: "node", resourceId: node.tenantId },
        }),
      );
    }
    const ownsOrg =
      !!context.organization?.activeOrganizationId &&
      tenant.orgId === context.organization.activeOrganizationId;
    if (options.adminBypassOrg ? context.user?.role !== "admin" && !ownsOrg : !ownsOrg) {
      return yield* Effect.fail(
        new ORPCError("FORBIDDEN", {
          message:
            options.resource === "validators"
              ? "This node's validators do not belong to your organization"
              : "This node does not belong to your organization",
        }),
      );
    }
  });

const requireTenantOwnedByOrg = (
  services: { tenants: TenantsService },
  tenantId: string,
  context: NodeAccessContext,
): NodeEffect<TenantRecord> =>
  Effect.gen(function* () {
    const tenant = yield* services.tenants.resolveTenantById(tenantId);
    if (!tenant) {
      return yield* Effect.fail(
        new ORPCError("NOT_FOUND", {
          message: "Tenant not found",
          data: { resource: "tenant", resourceId: tenantId },
        }),
      );
    }
    if (tenant.orgId !== context.organization?.activeOrganizationId) {
      return yield* Effect.fail(
        new ORPCError("FORBIDDEN", {
          message: "This tenant does not belong to your organization",
          data: {},
        }),
      );
    }
    return tenant;
  });

const authorizedTenant = (
  services: { tenants: TenantsService },
  input: { tenantId: string },
  context: {
    user?: { id?: string; role?: string | null };
    organization?: { activeOrganizationId: string | null };
    near?: { primaryAccountId: string | null };
  },
): NodeEffect<TenantRecord> =>
  Effect.gen(function* () {
    const tenant = yield* services.tenants.resolveTenantById(input.tenantId);
    if (!tenant) {
      return yield* Effect.fail(
        new ORPCError("NOT_FOUND", {
          message: "Tenant not found",
          data: { resource: "tenant", resourceId: input.tenantId },
        }),
      );
    }
    if (context.user?.role === "admin") return tenant;
    if (tenant.ownerKind === "user") {
      if (!context.user?.id || tenant.ownerUserId !== context.user.id) {
        return yield* Effect.fail(
          new ORPCError("FORBIDDEN", {
            message: "You do not own this tenant",
          }),
        );
      }
      return tenant;
    }
    if (tenant.orgId === null) {
      const isOwner =
        !!context.near?.primaryAccountId && context.near.primaryAccountId === tenant.accountId;
      if (!isOwner) {
        return yield* Effect.fail(
          new ORPCError("FORBIDDEN", {
            message: "You do not own this personal tenant",
          }),
        );
      }
      return tenant;
    }
    const activeOrgId = context.organization?.activeOrganizationId;
    if (!activeOrgId || tenant.orgId !== activeOrgId) {
      return yield* Effect.fail(
        new ORPCError("FORBIDDEN", {
          message: "You are not a member of this tenant's organization",
        }),
      );
    }
    return tenant;
  });

const authorizedNodeForValidators = (
  services: { nodes: NodesService; tenants: TenantsService },
  nodeId: string,
  context: NodeAccessContext,
): NodeEffect<NodeRecord> =>
  Effect.gen(function* () {
    const node = yield* resolveNodeForAccess(services, nodeId);
    yield* authorizeNodeAccess(services, node, context, {
      adminBypassOrg: true,
      resource: "validators",
    });
    return node;
  });

export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({
    platformAccount: z.string().optional(),
    gatewayDomains: z
      .string()
      .default("")
      .describe(
        "Comma-separated domains whose subdomains the platform controls (auto-verified bindings)",
      ),
    domain: z
      .string()
      .default("localhost")
      .describe("Runtime domain used to identify outbound geocode requests"),
    repository: z
      .string()
      .default("")
      .describe("Repository URL included in the Nominatim User-Agent"),
  }),

  secrets: z.object({
    LUMA_CALENDAR_API_KEYS: z.string().default(""),
    API_DATABASE_URL: z.string().default("pglite:.bos/api/:memory:"),
  }),

  context: ContextSchema,

  contract,

  initialize: (config) =>
    Effect.gen(function* () {
      const database = DatabaseLive(config.secrets.API_DATABASE_URL);
      const gatewayDomains = config.variables.gatewayDomains
        .split(",")
        .map((domain) => domain.trim().toLowerCase())
        .filter((domain) => domain.length > 0);
      const services = yield* buildScopedContext(
        Layer.mergeAll(
          TenantsLive,
          NodesLive,
          ValidatorsLive,
          DiscoveryLive(config.secrets.LUMA_CALENDAR_API_KEYS).pipe(
            Layer.provide(
              GeocodeLive({
                domain: config.variables.domain,
                repository: config.variables.repository,
              }),
            ),
          ),
          StorageLive,
        ).pipe(Layer.provide(database), Layer.provide(TenantsConfigLive(gatewayDomains))),
      );

      yield* Effect.log("[API] Services Initialized");

      return Layer.mergeAll(
        Layer.succeed(ApiServices, {
          tenants: Context.get(services, TenantsTag),
          nodes: Context.get(services, NodesTag),
          validators: Context.get(services, ValidatorsTag),
          discovery: Context.get(services, DiscoveryTag),
          storage: Context.get(services, StorageTag),
        }),
      );
    }),

  createRouter: (builder, plugins) => {
    const { requireAuth, requireAdmin, requireOrganization, requireOrgRole } =
      createAuthMiddleware<AuthContext>(builder);
    const requireNodeOperations = createRequireTeamArea(builder)("node-operations");
    const resolveProposalOrganization = builder.middleware(
      async ({ context, next }, input: { orgId: string }) => {
        const authPlugin = plugins.auth;
        if (!authPlugin) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "The auth plugin is not available",
          });
        }
        const organization = await authPlugin
          .client({ reqHeaders: Object.fromEntries(new Headers(context.reqHeaders).entries()) })
          .getOrganizationForAdmin({ organizationId: input.orgId });
        const organizationContext: NonNullable<AuthContext["organization"]> = {
          activeOrganizationId: organization?.id ?? null,
          organization,
          member: null,
          isPersonal: false,
          hasOrganization: !!organization,
          teams: [],
          activeTeamId: null,
        };
        return next({
          context: {
            organization: organizationContext,
          },
        });
      },
    );

    const router = {
      trackDiscovery: builder.trackDiscovery.effect(function* ({ input, context }) {
        const services = yield* ApiServices;
        return yield* services.discovery.track(input, context);
      }),
      getDiscoveryMetrics: builder.getDiscoveryMetrics.effect(function* ({ context }) {
        const services = yield* ApiServices;
        return yield* services.discovery.metrics(context);
      }),
      getDiscoveryStudio: builder.getDiscoveryStudio.effect(function* ({ context }) {
        const services = yield* ApiServices;
        return yield* services.discovery.studio(context);
      }),
      setDiscoveryCurator: builder.setDiscoveryCurator.effect(function* ({ input, context }) {
        const services = yield* ApiServices;
        return yield* services.discovery.setCurator(input, context);
      }),
      featureDiscoveryNode: builder.featureDiscoveryNode.effect(function* ({ input, context }) {
        const services = yield* ApiServices;
        return yield* services.discovery.feature(input, context);
      }),
      reportDiscoveryContent: builder.reportDiscoveryContent.effect(function* ({ input }) {
        const services = yield* ApiServices;
        return yield* services.discovery.report(input);
      }),
      moderateDiscoveryReport: builder.moderateDiscoveryReport.effect(function* ({
        input,
        context,
      }) {
        const services = yield* ApiServices;
        return yield* services.discovery.moderate(input, context);
      }),
      getDiscoveryHistory: builder.getDiscoveryHistory.effect(function* ({ input, context }) {
        const services = yield* ApiServices;
        return yield* services.discovery.history(input.nodeId, context);
      }),
      listDiscoveryLumaCalendars: builder.listDiscoveryLumaCalendars.effect(function* ({
        input,
        context,
      }) {
        const services = yield* ApiServices;
        return yield* services.discovery.lumaCalendars(input.nodeId, context);
      }),
      disconnectDiscoveryLuma: builder.disconnectDiscoveryLuma.effect(function* ({
        input,
        context,
      }) {
        const services = yield* ApiServices;
        return yield* services.discovery.disconnectLuma(input.nodeId, context);
      }),
      importDiscoveryLuma: builder.importDiscoveryLuma.effect(function* ({ input, context }) {
        const services = yield* ApiServices;
        return yield* services.discovery.importLuma(input, context);
      }),
      saveDiscoveryActivity: builder.saveDiscoveryActivity.effect(function* ({ input, context }) {
        const services = yield* ApiServices;
        return yield* services.discovery.saveActivity(input, context);
      }),
      listDiscoveryActivities: builder.listDiscoveryActivities.effect(function* ({
        input,
        context,
      }) {
        const services = yield* ApiServices;
        return yield* services.discovery.activities(input.nodeId, context);
      }),
      getDiscoveryActivity: builder.getDiscoveryActivity.effect(function* ({ input }) {
        const services = yield* ApiServices;
        return yield* services.discovery.activity(input.id);
      }),
      createEventOnboardingCode: builder.createEventOnboardingCode.effect(function* ({
        input,
        context,
        errors,
      }) {
        if (!context.userId) {
          return yield* Effect.fail(
            errors.UNAUTHORIZED({
              message: "Authentication required",
              data: { apiKeyProvided: !!context.apiKey },
            }),
          );
        }
        const services = yield* ApiServices;
        const record = yield* services.discovery.eventOrganization(input.eventId);
        if (!record) {
          return yield* Effect.fail(errors.NOT_FOUND({ message: "Event not found", data: {} }));
        }
        const { event, organizationId } = record;
        const endsAt = event.endsAt;
        if (event.kind !== "event" || !endsAt) {
          return yield* Effect.fail(
            errors.BAD_REQUEST({ message: "Only events can have onboarding codes", data: {} }),
          );
        }
        if (!organizationId) {
          return yield* Effect.fail(
            errors.BAD_REQUEST({
              message:
                "This event's node has no organization, so there is nothing for attendees to join",
              data: {},
            }),
          );
        }
        if (context.organization?.activeOrganizationId !== organizationId) {
          return yield* Effect.fail(
            errors.FORBIDDEN({
              message:
                "This event belongs to another organization than your active one — switch organizations to onboard for it",
              data: {},
            }),
          );
        }
        const authPlugin = plugins.auth;
        if (!authPlugin) {
          return yield* Effect.fail(
            new ORPCError("INTERNAL_SERVER_ERROR", { message: "The auth plugin is not available" }),
          );
        }
        const auth = authPlugin.client({
          reqHeaders: Object.fromEntries(new Headers(context.reqHeaders).entries()),
        });
        const expiresAt = input.expiresAt
          ? DateTime.toDateUtc(DateTime.makeUnsafe(input.expiresAt))
          : DateTime.toDateUtc(DateTime.makeUnsafe(Date.parse(endsAt) + ONBOARDING_GRACE_MS));
        return yield* Effect.tryPromise<
          z.infer<typeof EventOnboardingCodeSchema>,
          ORPCError<string, unknown>
        >({
          try: () =>
            auth.createOnboardingCode({
              organizationId,
              eventId: event.id,
              eventName: event.title,
              ...(input.maxUses ? { maxUses: input.maxUses } : {}),
              expiresAt,
            }),
          catch: (error) =>
            error instanceof ORPCError
              ? error
              : new ORPCError("INTERNAL_SERVER_ERROR", {
                  message: "Could not create the onboarding code",
                }),
        });
      }),
      listDiscovery: builder.listDiscovery.effect(function* ({ input }) {
        const services = yield* ApiServices;
        return yield* services.discovery.list(input);
      }),
      getDiscoveryNode: builder.getDiscoveryNode.effect(function* ({ input }) {
        const services = yield* ApiServices;
        return yield* services.discovery.get(input.nodeId);
      }),
      getDiscoveryProfile: builder.getDiscoveryProfile.effect(function* ({ input, context }) {
        const services = yield* ApiServices;
        return yield* services.discovery.profile(input.nodeId, context);
      }),
      saveDiscoveryProfile: builder.saveDiscoveryProfile.effect(function* ({ input, context }) {
        const services = yield* ApiServices;
        return yield* services.discovery.saveProfile(input, context);
      }),
      ping: builder.ping.handler(async () => ({
        status: "ok",
        timestamp: new Date().toISOString(),
      })),

      listTenants: builder.listTenants.use(requireAuth).effect(function* ({ context }) {
        const services = yield* ApiServices;
        if (context.user?.role === "admin") {
          return yield* services.tenants.listAllTenants;
        }
        const ownerTenants = yield* services.tenants.listTenantsByOwnerUserId(context.user.id);
        const orgId = context.organization?.activeOrganizationId;
        if (!orgId) {
          return ownerTenants;
        }
        const orgTenants = yield* services.tenants.listTenantsByOrgIds([orgId]);
        return [...ownerTenants, ...orgTenants.filter((t) => t.ownerUserId === null)];
      }),

      spawnTenant: builder.spawnTenant.use(requireAuth).effect(function* ({ input, context }) {
        const services = yield* ApiServices;
        const ownerAccountId = context.near?.primaryAccountId;
        if (!ownerAccountId) {
          return yield* Effect.fail(
            new ORPCError("FORBIDDEN", {
              message: "Link a NEAR account to your session before spawning a tenant",
            }),
          );
        }
        yield* validateAccountId(ownerAccountId);
        yield* validateHostname(input.hostname);
        const { tenant, binding } = yield* services.tenants.spawnTenant({
          name: input.name,
          hostname: input.hostname.toLowerCase(),
          ownerAccountId,
          ownerUserId: context.user.id,
        });
        return { tenant, binding, ownerAccountId, publishStatus: publishStatusFor(ownerAccountId) };
      }),

      getSpawnStatus: builder.getSpawnStatus.use(requireAuth).effect(function* ({
        input,
        context,
      }) {
        const services = yield* ApiServices;
        const tenant = yield* authorizedTenant(services, input, context);
        const bindings = yield* services.tenants.listBindingsForTenant(tenant.id);
        return {
          tenant,
          bindings,
          ownerAccountId: tenant.accountId,
          publishStatus: publishStatusFor(tenant.accountId),
        };
      }),

      createTenant: builder.createTenant
        .use(requireAuth)
        .use(requireAdmin)
        .use(requireOrganization)
        .effect(function* ({ input, context }) {
          const services = yield* ApiServices;
          yield* validateAccountId(input.accountId);
          const result = yield* verifyDaoMembership({
            daoAccountId: input.accountId,
            memberAccountId: context.near?.primaryAccountId ?? null,
          });
          if (!result.isMember) {
            return yield* Effect.fail(
              new ORPCError("FORBIDDEN", {
                message: "Your connected NEAR account is not a member of this DAO",
                data: {
                  daoAccountId: input.accountId,
                  primaryAccountId: context.near?.primaryAccountId ?? null,
                },
              }),
            );
          }
          return yield* services.tenants.createTenant({
            name: input.name,
            accountId: input.accountId,
            orgId: context.organization?.activeOrganizationId ?? null,
            status: input.status,
            ownerKind: "dao",
            allowUiOverrides: input.allowUiOverrides,
            allowBackendOverrides: input.allowBackendOverrides,
            allowSsr: input.allowSsr,
          });
        }),

      updateTenant: builder.updateTenant
        .use(requireAuth)
        .use(requireOrgRole("owner"))
        .effect(function* ({ input, context }) {
          const services = yield* ApiServices;
          const tenant = yield* authorizedTenant(services, input, context);
          if (input.accountId !== undefined) yield* validateAccountId(input.accountId);
          return yield* services.tenants.updateTenant(tenant.id, {
            name: input.name,
            accountId: input.accountId,
            status: input.status,
            allowUiOverrides: input.allowUiOverrides,
            allowBackendOverrides: input.allowBackendOverrides,
            allowSsr: input.allowSsr,
          });
        }),

      deleteTenant: builder.deleteTenant
        .use(requireAuth)
        .use(requireOrgRole("owner"))
        .effect(function* ({ input, context, errors }) {
          const services = yield* ApiServices;
          yield* authorizedTenant(services, input, context);
          const result = yield* services.tenants.softDeleteTenant(input.tenantId);
          if (!result) {
            return yield* Effect.fail(
              errors.NOT_FOUND({
                message: "Tenant not found",
                data: { resource: "tenant", resourceId: input.tenantId },
              }),
            );
          }
          return result;
        }),

      suspendTenant: builder.suspendTenant
        .use(requireAuth)
        .use(requireOrgRole("admin"))
        .effect(function* ({ input, context, errors }) {
          const services = yield* ApiServices;
          yield* authorizedTenant(services, input, context);
          const result = yield* services.tenants.suspendTenant(input.tenantId);
          if (!result) {
            return yield* Effect.fail(
              errors.NOT_FOUND({
                message: "Tenant not found",
                data: { resource: "tenant", resourceId: input.tenantId },
              }),
            );
          }
          return result;
        }),

      reactivateTenant: builder.reactivateTenant
        .use(requireAuth)
        .use(requireOrgRole("admin"))
        .effect(function* ({ input, context, errors }) {
          const services = yield* ApiServices;
          yield* authorizedTenant(services, input, context);
          const result = yield* services.tenants.reactivateTenant(input.tenantId);
          if (!result) {
            return yield* Effect.fail(
              errors.NOT_FOUND({
                message: "Tenant not found",
                data: { resource: "tenant", resourceId: input.tenantId },
              }),
            );
          }
          return result;
        }),

      resolveTenant: builder.resolveTenant.effect(function* ({ input }) {
        const services = yield* ApiServices;
        const tenant = yield* services.tenants.resolveTenantByAccountId(input.accountId);
        if (!tenant) return null;
        const { ownerUserId: _ownerUserId, ...publicTenant } = tenant;
        return publicTenant;
      }),

      resolveTenantByOrgId: builder.resolveTenantByOrgId.effect(function* ({ input, errors }) {
        const services = yield* ApiServices;
        const tenant = yield* services.tenants.resolveTenantByOrgId(input.orgId);
        if (!tenant) {
          return yield* Effect.fail(
            errors.NOT_FOUND({
              message: "Tenant not found",
              data: { resource: "tenant", resourceId: input.orgId },
            }),
          );
        }
        const { ownerUserId: _ownerUserId, ...publicTenant } = tenant;
        return publicTenant;
      }),

      listTenantBindings: builder.listTenantBindings.effect(function* () {
        const services = yield* ApiServices;
        return yield* services.tenants.listBindings;
      }),

      listTenantApps: builder.listTenantApps.effect(function* () {
        const services = yield* ApiServices;
        return yield* services.tenants.listTenantApps();
      }),

      listStakeCommunities: builder.listStakeCommunities.effect(function* ({ context }) {
        const services = yield* ApiServices;
        if (!context.user || context.user.isAnonymous === true) {
          return yield* services.tenants.listTenantApps();
        }
        const activeOrganizationId = context.organization?.activeOrganizationId;
        const organizationIds = activeOrganizationId
          ? [activeOrganizationId]
          : (context.organizations ?? []).map((organization) => organization.id);
        return yield* services.tenants.listTenantApps(organizationIds);
      }),

      listTenantBindingsForTenant: builder.listTenantBindingsForTenant
        .use(requireAuth)
        .effect(function* ({ input, context }) {
          const services = yield* ApiServices;
          const tenant = yield* authorizedTenant(services, input, context);
          return yield* services.tenants.listBindingsForTenant(tenant.id);
        }),

      createBinding: builder.createBinding.use(requireAuth).effect(function* ({ input, context }) {
        const services = yield* ApiServices;
        yield* authorizedTenant(services, input, context);
        yield* validateHostname(input.hostname);
        return yield* services.tenants.createBinding({
          tenantId: input.tenantId,
          hostname: input.hostname.toLowerCase(),
          isPrimary: input.isPrimary,
        });
      }),

      verifyCustomDomain: builder.verifyCustomDomain.use(requireAuth).effect(function* ({
        input,
        context,
      }) {
        const services = yield* ApiServices;
        yield* authorizedTenant(services, input, context);
        return yield* services.tenants.verifyCustomDomain(input.tenantId, input.bindingId);
      }),

      deleteBinding: builder.deleteBinding.use(requireAuth).effect(function* ({ input, context }) {
        const services = yield* ApiServices;
        yield* authorizedTenant(services, input, context);
        yield* services.tenants.deleteBinding(input.tenantId, input.bindingId);
        return { success: true as const };
      }),

      setPrimaryBinding: builder.setPrimaryBinding
        .use(requireAuth)
        .use(requireOrgRole("admin"))
        .effect(function* ({ input, context }) {
          const services = yield* ApiServices;
          yield* authorizedTenant(services, input, context);
          return yield* services.tenants.setPrimaryBinding(input.tenantId, input.bindingId);
        }),

      resolveBindingByHostname: builder.resolveBindingByHostname.effect(function* ({ input }) {
        const services = yield* ApiServices;
        const binding = yield* services.tenants.resolveBindingByHostname(input.hostname);
        if (!binding) return null;
        const { verificationToken: _verificationToken, ...publicBinding } = binding;
        return publicBinding;
      }),

      bindingPreflight: builder.bindingPreflight.use(requireAuth).effect(function* ({ input }) {
        const services = yield* ApiServices;
        const format = HOSTNAME_REGEX.test(input.hostname.toLowerCase())
          ? ("valid" as const)
          : ("invalid" as const);
        const existing =
          format === "valid"
            ? yield* services.tenants.resolveBindingByHostname(input.hostname.toLowerCase())
            : null;
        return {
          hostname: { available: format === "valid" && !existing, format },
        };
      }),

      applyNodeProposal: builder.applyNodeProposal
        .use(requireAdmin)
        .use(resolveProposalOrganization)
        .use(requireOrganization)
        .effect(function* ({ input }) {
          const services = yield* ApiServices;
          yield* validateAccountId(input.accountId);
          yield* validateAccountId(input.submitterAccountId);
          if (input.poolAccountId) yield* validateAccountId(input.poolAccountId);
          yield* validateHostname(input.hostname);
          const result = yield* verifyDaoMembership({
            daoAccountId: input.accountId,
            memberAccountId: input.submitterAccountId,
          });
          if (!result.isMember) {
            return yield* Effect.fail(
              new ORPCError("FORBIDDEN", {
                message: `${input.submitterAccountId} is not a member of ${input.accountId} — add it under the DAO's members at https://trezu.app/${input.accountId}/members`,
                data: {
                  daoAccountId: input.accountId,
                  submitterAccountId: input.submitterAccountId,
                },
              }),
            );
          }
          return yield* services.tenants.applyNodeProposal({
            kind: input.kind,
            name: input.name,
            slug: input.slug,
            parentId: input.parentId,
            orgId: input.orgId,
            accountId: input.accountId,
            hostname: input.hostname.toLowerCase(),
            ...(input.poolAccountId ? { poolAccountId: input.poolAccountId } : {}),
          });
        }),

      listNodes: builder.listNodes.effect(function* ({ input }) {
        const services = yield* ApiServices;
        return yield* services.nodes.list({
          ...(input.kind !== undefined && { kind: input.kind }),
          ...(input.parentId !== undefined && { parentId: input.parentId }),
          ...(input.tenantId !== undefined && { tenantId: input.tenantId }),
        });
      }),

      listNodeSummaries: builder.listNodeSummaries.effect(function* ({ input }) {
        const services = yield* ApiServices;
        return yield* services.nodes.listSummaries({
          ...(input.scope === "roots" && { parentId: null }),
          ...(input.kind !== undefined && { kind: input.kind }),
        });
      }),

      getNode: builder.getNode.effect(function* ({ input }) {
        const services = yield* ApiServices;
        return yield* services.nodes.getById(input.nodeId);
      }),

      createNode: builder.createNode
        .use(requireAuth)
        .use(requireOrganization)
        .use(requireNodeOperations)
        .effect(function* ({ input, context }) {
          const services = yield* ApiServices;
          yield* requireTenantOwnedByOrg(services, input.tenantId, context);
          return yield* services.nodes.spawn({
            kind: input.kind,
            slug: input.slug,
            name: input.name,
            parentId: input.parentId ?? null,
            tenantId: input.tenantId,
            ...(input.metadata !== undefined && { metadata: input.metadata }),
          });
        }),

      spawnNode: builder.spawnNode
        .use(requireAuth)
        .use(requireOrganization)
        .use(requireNodeOperations)
        .effect(function* ({ input, context, errors }) {
          const services = yield* ApiServices;
          if (!input.tenantId && context.user?.role !== "admin") {
            return yield* Effect.fail(
              errors.FORBIDDEN({
                message: "Standalone nodes can only be spawned by platform admins",
                data: {},
              }),
            );
          }
          if (input.tenantId) {
            yield* requireTenantOwnedByOrg(services, input.tenantId, context);
          }
          if (input.parentId) {
            const parentId = input.parentId;
            const parent = yield* services.nodes.getById(parentId);
            if (!parent) {
              return yield* Effect.fail(
                errors.NOT_FOUND({
                  message: "Parent node not found",
                  data: { resource: "node", resourceId: parentId },
                }),
              );
            }
            yield* authorizeNodeAccess(services, parent, context, {
              adminBypassOrg: true,
              resource: "node",
            });
          }
          return yield* services.nodes.spawn({
            ...(input.kind !== undefined && { kind: input.kind }),
            slug: input.slug,
            name: input.name,
            parentId: input.parentId ?? null,
            ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
            ...(input.metadata !== undefined && { metadata: input.metadata }),
          });
        }),

      updateNode: builder.updateNode
        .use(requireAuth)
        .use(requireNodeOperations)
        .effect(function* ({ input, context }) {
          const services = yield* ApiServices;
          const node = yield* resolveNodeForAccess(services, input.nodeId);
          yield* authorizeNodeAccess(services, node, context, {
            adminBypassOrg: true,
            resource: "node",
          });
          return yield* services.nodes.update(input.nodeId, {
            ...(input.kind !== undefined && { kind: input.kind }),
            ...(input.slug !== undefined && { slug: input.slug }),
            ...(input.name !== undefined && { name: input.name }),
            ...(input.parentId !== undefined && { parentId: input.parentId }),
            ...(input.metadata !== undefined && { metadata: input.metadata }),
          });
        }),

      setNodeBulletin: builder.setNodeBulletin
        .use(requireAuth)
        .use(requireNodeOperations)
        .effect(function* ({ input, context }) {
          const services = yield* ApiServices;
          const node = yield* resolveNodeForAccess(services, input.nodeId);
          yield* authorizeNodeAccess(services, node, context, {
            adminBypassOrg: true,
            resource: "node",
          });
          return yield* services.nodes.setBulletin(input.nodeId, input.bulletin);
        }),

      deleteNode: builder.deleteNode
        .use(requireAuth)
        .use(requireOrgRole("admin"))
        .use(requireNodeOperations)
        .effect(function* ({ input, context, errors }) {
          const services = yield* ApiServices;
          const node = yield* resolveNodeForAccess(services, input.nodeId);
          yield* authorizeNodeAccess(services, node, context, {
            adminBypassOrg: false,
            resource: "node",
          });
          const deleted = yield* services.nodes.delete(input.nodeId);
          if (!deleted) {
            return yield* Effect.fail(
              errors.NOT_FOUND({
                message: "Node not found",
                data: { resource: "node", resourceId: input.nodeId },
              }),
            );
          }
          return { success: true as const };
        }),

      listRootNodes: builder.listRootNodes.effect(function* () {
        const services = yield* ApiServices;
        return yield* services.nodes.listRootNodes;
      }),

      listChildren: builder.listChildren.effect(function* ({ input }) {
        const services = yield* ApiServices;
        return yield* services.nodes.listChildren(input.nodeId);
      }),

      getSubtree: builder.getSubtree.effect(function* ({ input, errors }) {
        const services = yield* ApiServices;
        const subtree = yield* services.nodes.subtreeWithValidators(input.nodeId);
        if (subtree.length === 0) {
          return yield* Effect.fail(
            errors.NOT_FOUND({
              message: "Node not found",
              data: { resource: "node", resourceId: input.nodeId },
            }),
          );
        }
        return subtree;
      }),

      getNodeSummary: builder.getNodeSummary.effect(function* ({ input }) {
        const services = yield* ApiServices;
        const node = yield* resolveNodeForAccess(services, input.nodeId);

        const [children, subtree, validators, stakingValidators] = yield* Effect.all([
          services.nodes.listChildren(input.nodeId),
          services.nodes.subtreeWithValidators(input.nodeId),
          services.validators.listByNode(input.nodeId),
          services.validators.resolveForStaking(input.nodeId),
        ]);
        const subtreeValidators = subtree.flatMap((entry) => entry.validators);
        const subtreeValidatorCountsByRole = { official: 0, community: 0 };
        for (const validator of subtreeValidators) {
          if (validator.role === "official") {
            subtreeValidatorCountsByRole.official += 1;
          } else if (validator.role === "community") {
            subtreeValidatorCountsByRole.community += 1;
          }
        }

        return {
          node,
          childrenCount: children.length,
          subtreeNodeCount: subtree.length,
          validators,
          subtreeValidatorCount: subtreeValidators.length,
          subtreeValidatorCountsByRole,
          stakingValidators,
          children: children.map(({ id, kind, slug, name }) => ({
            id,
            kind,
            slug,
            name,
          })),
        };
      }),

      resolveNodeBySlug: builder.resolveNodeBySlug.effect(function* ({ input }) {
        const services = yield* ApiServices;
        return yield* services.nodes.resolveBySlug(
          input.slug,
          input.parentId === undefined ? undefined : input.parentId,
        );
      }),

      listValidators: builder.listValidators.effect(function* ({ input }) {
        const services = yield* ApiServices;
        return yield* services.validators.list({
          ...(input.nodeId !== undefined && { nodeId: input.nodeId }),
          ...(input.role !== undefined && { role: input.role }),
        });
      }),

      listValidatorsByNode: builder.listValidatorsByNode.effect(function* ({ input }) {
        const services = yield* ApiServices;
        return yield* services.validators.listByNode(input.nodeId);
      }),

      getValidator: builder.getValidator.effect(function* ({ input }) {
        const services = yield* ApiServices;
        const validator = yield* services.validators.getById(input.validatorId);
        return validator ?? null;
      }),

      resolveValidatorByAccountId: builder.resolveValidatorByAccountId.effect(function* ({
        input,
      }) {
        const services = yield* ApiServices;
        const validator = yield* services.validators.resolveByAccountId(input.accountId);
        return validator ?? null;
      }),

      resolveStakingValidators: builder.resolveStakingValidators.effect(function* ({ input }) {
        const services = yield* ApiServices;
        return yield* services.validators.resolveForStaking(input.nodeId);
      }),

      createValidator: builder.createValidator
        .use(requireAuth)
        .use(requireNodeOperations)
        .effect(function* ({ input, context }) {
          const services = yield* ApiServices;
          yield* authorizedNodeForValidators(services, input.nodeId, context);
          return yield* services.validators.create({
            nodeId: input.nodeId,
            accountId: input.accountId,
            network: input.network,
            protocol: input.protocol,
            role: input.role,
            isDefault: input.isDefault,
            ...(input.metadata !== undefined && { metadata: input.metadata }),
          });
        }),

      updateValidator: builder.updateValidator
        .use(requireAuth)
        .use(requireNodeOperations)
        .effect(function* ({ input, context, errors }) {
          const services = yield* ApiServices;
          const validator = yield* services.validators.getById(input.validatorId);
          if (!validator) {
            return yield* Effect.fail(
              errors.NOT_FOUND({
                message: "Validator not found",
                data: { resource: "validator", resourceId: input.validatorId },
              }),
            );
          }
          yield* authorizedNodeForValidators(services, validator.nodeId, context);
          return yield* services.validators.update(input.validatorId, {
            ...(input.accountId !== undefined && {
              accountId: input.accountId,
            }),
            ...(input.network !== undefined && { network: input.network }),
            ...(input.protocol !== undefined && { protocol: input.protocol }),
            ...(input.role !== undefined && { role: input.role }),
            ...(input.isDefault !== undefined && {
              isDefault: input.isDefault,
            }),
            ...(input.metadata !== undefined && { metadata: input.metadata }),
          });
        }),

      deleteValidator: builder.deleteValidator
        .use(requireAuth)
        .use(requireNodeOperations)
        .effect(function* ({ input, context, errors }) {
          const services = yield* ApiServices;
          const validator = yield* services.validators.getById(input.validatorId);
          if (!validator) {
            return yield* Effect.fail(
              errors.NOT_FOUND({
                message: "Validator not found",
                data: { resource: "validator", resourceId: input.validatorId },
              }),
            );
          }
          yield* authorizedNodeForValidators(services, validator.nodeId, context);
          const ok = yield* services.validators.delete(input.validatorId);
          return { success: ok as true };
        }),

      setDefaultValidator: builder.setDefaultValidator
        .use(requireAuth)
        .use(requireNodeOperations)
        .effect(function* ({ input, context, errors }) {
          const services = yield* ApiServices;
          const target = yield* services.validators.getById(input.validatorId);
          if (!target) {
            return yield* Effect.fail(
              errors.NOT_FOUND({
                message: "Validator not found",
                data: { resource: "validator", resourceId: input.validatorId },
              }),
            );
          }
          yield* authorizedNodeForValidators(services, target.nodeId, context);
          return yield* services.validators.setDefault(target.nodeId, input.validatorId);
        }),

      testError: builder.testError.handler(async ({ input }) => {
        switch (input.kind) {
          case "unauthorized":
            throw new ORPCError("UNAUTHORIZED", {
              message: "test unauthorized error",
            });
          case "forbidden":
            throw new ORPCError("FORBIDDEN", {
              message: "test forbidden error",
            });
          case "not_found":
            throw new ORPCError("NOT_FOUND", {
              message: "test not found error",
            });
          case "conflict":
            throw new ORPCError("CONFLICT", { message: "test conflict error" });
          case "bad_request":
            throw new ORPCError("BAD_REQUEST", {
              message: "test bad request error",
            });
          default:
            throw new Error("test internal server error");
        }
      }),

      uploadStorageBundle: builder.uploadStorageBundle.effect(function* ({
        input,
        context,
        errors,
      }) {
        const services = yield* ApiServices;

        if (!context.user && !context.userId && !context.apiKey) {
          return yield* Effect.fail(
            errors.UNAUTHORIZED({
              message: "Authentication required — sign in or provide an API key",
              data: { apiKeyProvided: Boolean(context.apiKey) },
            }),
          );
        }

        const invalidFields = [
          !validateNamespacePart(input.account, "account") ? "account" : null,
          !validateNamespacePart(input.gateway, "gateway") ? "gateway" : null,
          !validateNamespacePart(input.workspace, "workspace") ? "workspace" : null,
        ].filter((field): field is string => field !== null);
        if (invalidFields.length > 0) {
          return yield* Effect.fail(
            errors.BAD_REQUEST({
              message: "Invalid bundle namespace",
              data: { invalidFields },
            }),
          );
        }

        const principal = context.near?.primaryAccountId ?? null;
        const isSession = Boolean(context.user || context.userId);
        if (isSession && !principal) {
          return yield* Effect.fail(
            errors.FORBIDDEN({
              message: "Link a NEAR account to your session to publish bundles",
              data: { action: "storage.bundles.write" },
            }),
          );
        }
        if (principal && principal !== input.account) {
          return yield* Effect.fail(
            errors.FORBIDDEN({
              message: `Bundle uploads are pinned to the authenticated account (${principal})`,
              data: { action: "storage.bundles.write" },
            }),
          );
        }

        const maxBytes = maxBundleUploadBytes();
        const decoded: Array<{ objectPath: string; name: string; bytes: Uint8Array }> = [];
        for (const file of input.files) {
          const objectPath = validateObjectPath(file.path);
          if (!objectPath) {
            return yield* Effect.fail(
              errors.BAD_REQUEST({
                message: `Invalid bundle object path: ${file.path}`,
                data: { invalidFields: ["files"] },
              }),
            );
          }
          const buffer = Buffer.from(file.contentBase64, "base64");
          if (buffer.length === 0) {
            return yield* Effect.fail(
              errors.BAD_REQUEST({
                message: `Empty bundle file: ${file.path}`,
                data: { invalidFields: ["files"] },
              }),
            );
          }
          decoded.push({
            objectPath,
            name: objectPath.split("/").pop() ?? objectPath,
            bytes: new Uint8Array(buffer),
          });
        }

        const totalBytes = decoded.reduce((sum, file) => sum + file.bytes.byteLength, 0);
        if (!validateUploadSize(decoded, maxBytes)) {
          return yield* Effect.fail(
            errors.BAD_REQUEST({
              message: `Bundle upload exceeds the ${maxBytes} byte ceiling (${totalBytes})`,
              data: { invalidFields: ["files"] },
            }),
          );
        }

        // Bounded pool: 736 sequential PUTs are minutes of pure round-trip
        // latency; 4-way concurrency cuts wall time ~4x with no extra memory
        // (all file bytes are already decoded in memory).
        const integrityEntries = yield* Effect.forEach(
          decoded,
          (file) =>
            Effect.gen(function* () {
              // Exit + squash: the storage layer's put is typed never-error
              // (Effect.promise rejections are defects) — this catches both
              // defects and typed failures so the cause reaches the client
              // as a CONNECTION_ERROR instead of a bare INTERNAL_SERVER_ERROR.
              const put = yield* Effect.exit(
                services.storage.put({
                  key: buildBundleKey(
                    input.account,
                    input.gateway,
                    input.workspace,
                    file.objectPath,
                  ),
                  bytes: file.bytes,
                  contentType: bundleContentType(file.name),
                  cacheControl: bundleCacheControl(file.name),
                }),
              );
              if (Exit.isFailure(put)) {
                const cause = Cause.squash(put.cause);
                return yield* Effect.fail(
                  errors.CONNECTION_ERROR({
                    message: `Bundle storage failed for ${file.objectPath}: ${
                      cause instanceof Error ? cause.message : String(cause)
                    }`,
                    data: {
                      errorCode: "STORAGE_PUT_FAILED",
                      suggestion:
                        "Check BOS_STORAGE_* (R2/MinIO) credentials and reachability on the API host",
                    },
                  }),
                );
              }
              return [file.objectPath, computeObjectIntegrity(file.bytes)] as const;
            }),
          { concurrency: 4 },
        );
        const integrity = Object.fromEntries(integrityEntries);

        return { stored: decoded.length, totalBytes, integrity, storage: services.storage.backend };
      }),
    };

    const templateRouter = (plugins as Record<string, { router?: unknown }>).template?.router;
    if (templateRouter) {
      (router as Record<string, unknown>).things = templateRouter;
    }

    return router as ContractedRouter<typeof contract, any>;
  },
});
