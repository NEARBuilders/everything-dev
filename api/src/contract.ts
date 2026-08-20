import { BAD_REQUEST, FORBIDDEN, NOT_FOUND, UNAUTHORIZED } from "every-plugin/errors";
import { oc } from "every-plugin/orpc";
import { z } from "every-plugin/zod";

const ErrorTestKindSchema = z.enum([
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "bad_request",
  "internal",
]);

export const TenantStatusSchema = z.enum(["active", "pending", "suspended", "pending_deletion"]);

export const TenantSchema = z.object({
  id: z.string(),
  subdomain: z.string(),
  accountId: z.string(),
  orgId: z.string().nullable(),
  name: z.string(),
  status: TenantStatusSchema,
  allowUiOverrides: z.boolean(),
  allowBackendOverrides: z.boolean(),
  allowSsr: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

export type Tenant = z.infer<typeof TenantSchema>;

export const TenantBindingSchema = z.object({
  hostname: z
    .string()
    .describe("Subdomain hostname that routes to this tenant on the parent domain"),
  accountId: z.string(),
  allowUiOverrides: z.boolean(),
  allowBackendOverrides: z.boolean(),
  allowSsr: z.boolean(),
  status: TenantStatusSchema,
});

const ThingSchema = z.object({
  thingId: z.string().describe("Unique identifier for the thing"),
  type: z.string().describe("Plugin-derived thing type"),
  payload: z.unknown().describe("Plugin-owned thing payload"),
  createdAt: z.string().datetime().describe("ISO 8601 timestamp when the thing was created"),
  updatedAt: z.string().datetime().describe("ISO 8601 timestamp when the thing was last updated"),
});

const CreatedThingSchema = ThingSchema.extend({
  action: z.string().describe("Action emitted for the creation"),
});

const ListThingsSchema = z.object({
  data: z.array(ThingSchema).describe("List of things matching the query"),
  meta: z.object({
    total: z.number().describe("Total number of matching things"),
    hasMore: z.boolean().describe("Whether another page of results exists"),
    nextCursor: z.string().nullable().describe("Opaque cursor for the next page, or null if done"),
  }),
});

export const contract = oc.router({
  ping: oc.route({ method: "GET", path: "/ping" }).output(
    z.object({
      status: z.literal("ok"),
      timestamp: z.iso.datetime(),
    }),
  ),

  authHealth: oc
    .route({ method: "GET", path: "/auth/health" })
    .output(
      z.object({
        status: z.string(),
        emailConfigured: z.boolean(),
        smsConfigured: z.boolean(),
      }),
    )
    .errors({ UNAUTHORIZED }),

  listTenants: oc
    .route({ method: "GET", path: "/tenants" })
    .output(z.array(TenantSchema))
    .errors({ UNAUTHORIZED, FORBIDDEN }),

  createTenant: oc
    .route({ method: "POST", path: "/tenants" })
    .input(
      z.object({
        subdomain: z.string(),
        name: z.string(),
        accountId: z.string(),
        status: z.enum(["active", "pending"]).optional(),
        allowUiOverrides: z.boolean().default(true),
        allowBackendOverrides: z.boolean().default(false),
        allowSsr: z.boolean().default(false),
      }),
    )
    .output(TenantSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST }),

  updateTenant: oc
    .route({ method: "PATCH", path: "/tenants/{tenantId}" })
    .input(
      z.object({
        tenantId: z.string(),
        name: z.string().optional(),
        subdomain: z.string().optional(),
        accountId: z.string().optional(),
        status: TenantStatusSchema.optional(),
        allowUiOverrides: z.boolean().optional(),
        allowBackendOverrides: z.boolean().optional(),
        allowSsr: z.boolean().optional(),
      }),
    )
    .output(TenantSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

  deleteTenant: oc
    .route({ method: "POST", path: "/tenants/{tenantId}/delete" })
    .input(z.object({ tenantId: z.string() }))
    .output(TenantSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  suspendTenant: oc
    .route({ method: "POST", path: "/tenants/{tenantId}/suspend" })
    .input(z.object({ tenantId: z.string() }))
    .output(TenantSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  reactivateTenant: oc
    .route({ method: "POST", path: "/tenants/{tenantId}/reactivate" })
    .input(z.object({ tenantId: z.string() }))
    .output(TenantSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  resolveTenant: oc
    .route({ method: "GET", path: "/tenants/account/{accountId}" })
    .input(z.object({ accountId: z.string() }))
    .output(TenantSchema.nullable()),

  resolveTenantByOrgId: oc
    .route({ method: "GET", path: "/tenants/org/{orgId}" })
    .input(z.object({ orgId: z.string() }))
    .output(TenantSchema)
    .errors({ NOT_FOUND }),

  listTenantBindings: oc
    .route({
      method: "GET",
      path: "/tenants/bindings",
      summary: "List all active tenant domain bindings",
      description:
        "Public — returns the subdomain-to-config mapping used by the host's BindingResolver.",
    })
    .output(z.array(TenantBindingSchema)),

  tenantPreflight: oc
    .route({ method: "POST", path: "/tenants/preflight" })
    .input(
      z.object({
        subdomain: z.string(),
        parentAccount: z.string(),
      }),
    )
    .output(
      z.object({
        subdomain: z.object({
          available: z.boolean(),
          reserved: z.boolean(),
        }),
        accountId: z.object({
          format: z.enum(["valid", "invalid"]),
          available: z.boolean(),
        }),
      }),
    )
    .errors({ UNAUTHORIZED, BAD_REQUEST }),

  createThing: oc
    .route({
      method: "POST",
      path: "/things",
      summary: "Create a thing",
      description: "Creates a DB-backed thing via the template plugin.",
      tags: ["Things"],
    })
    .input(
      z.object({
        thingId: z.string().min(1, "Thing ID is required"),
        payload: z.unknown(),
      }),
    )
    .output(CreatedThingSchema)
    .errors({
      UNAUTHORIZED,
      CONFLICT: { status: 409, message: "A thing with this ID already exists" },
    }),

  getThing: oc
    .route({
      method: "GET",
      path: "/things/{thingId}",
      summary: "Get a thing",
      description: "Returns a DB-backed thing by ID via the template plugin.",
      tags: ["Things"],
    })
    .input(
      z.object({
        thingId: z.string().min(1, "Thing ID is required"),
      }),
    )
    .output(ThingSchema)
    .errors({ NOT_FOUND }),

  listThings: oc
    .route({
      method: "GET",
      path: "/things",
      summary: "List things",
      description:
        "Lists things from the template plugin with optional type filtering and cursor pagination.",
      tags: ["Things"],
    })
    .input(
      z.object({
        type: z.string().optional().describe("Filter by thing type"),
        limit: z
          .number()
          .min(1)
          .max(100)
          .default(10)
          .describe("Maximum number of results to return"),
        cursor: z.string().optional().describe("Opaque cursor for the next page"),
      }),
    )
    .output(ListThingsSchema),

  deleteThing: oc
    .route({
      method: "DELETE",
      path: "/things/{thingId}",
      summary: "Delete a thing",
      description: "Removes a DB-backed thing by ID via the template plugin.",
      tags: ["Things"],
    })
    .input(
      z.object({
        thingId: z.string().min(1, "Thing ID is required"),
      }),
    )
    .output(z.object({ success: z.literal(true) }))
    .errors({ UNAUTHORIZED, NOT_FOUND }),

  testError: oc
    .route({
      method: "GET",
      path: "/errors",
      summary: "Trigger a specific error kind",
      description:
        "Regression-test helper that throws the requested error kind so the host error surface can be validated.",
      tags: ["Testing"],
    })
    .input(
      z.object({
        kind: ErrorTestKindSchema.describe("Which error kind to trigger"),
      }),
    )
    .output(
      z.object({
        ok: z.literal(true).describe("Always true when no error is thrown"),
      }),
    )
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),
});

export type ContractType = typeof contract;
