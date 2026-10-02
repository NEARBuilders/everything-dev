import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import {
  BAD_REQUEST,
  CONNECTION_ERROR,
  FORBIDDEN,
  NOT_FOUND,
  UNAUTHORIZED,
} from "every-plugin/errors";
import { z } from "zod";
import { discoveryContract } from "./discovery-contract";

const ErrorTestKindSchema = z.enum([
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "bad_request",
  "internal",
]);

export const TenantStatusSchema = z.enum(["active", "pending", "suspended", "pending_deletion"]);

export const GeoNodeKindSchema = z.enum(["country", "state", "city"]);

export const NodeKindSchema = z.string().nullable();

export const NodeProposalPayloadSchema = z
  .object({
    kind: GeoNodeKindSchema,
    name: z.string().trim().min(1),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/),
    parentId: z.string().nullable(),
    orgId: z.string().min(1),
    motivation: z.string().trim().min(1),
    accountId: z.string().min(1),
    submitterAccountId: z.string().min(1),
  })
  .superRefine((value, context) => {
    if (value.kind === "country" && value.parentId !== null) {
      context.addIssue({
        code: "custom",
        path: ["parentId"],
        message: "Country cannot have a parent",
      });
    }
    if (value.kind !== "country" && !value.parentId) {
      context.addIssue({
        code: "custom",
        path: ["parentId"],
        message: "Parent is required",
      });
    }
  });

export type NodeProposalPayload = z.infer<typeof NodeProposalPayloadSchema>;

export const EventOnboardingCodeSchema = z.object({
  id: z.string(),
  code: z.string(),
  eventId: z.string().nullable(),
  eventName: z.string(),
  teamId: z.string(),
  role: z.string(),
  maxUses: z.number(),
  usedCount: z.number(),
  expiresAt: z.date(),
  revokedAt: z.date().nullable(),
  createdAt: z.date(),
});

export const ValidatorRoleSchema = z.enum(["official", "community"]);

export const ProtocolSchema = z.string().default("near");

export const ValidatorSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  accountId: z.string(),
  network: z.string(),
  protocol: z.string(),
  role: ValidatorRoleSchema,
  isDefault: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Validator = z.infer<typeof ValidatorSchema>;

export const StakingValidatorsSchema = z.object({
  validators: z.array(ValidatorSchema),
  sourceNodeId: z.string(),
});

export type StakingValidators = z.infer<typeof StakingValidatorsSchema>;

export const TenantSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  orgId: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  name: z.string(),
  status: TenantStatusSchema,
  ownerKind: z.string(),
  allowUiOverrides: z.boolean(),
  allowBackendOverrides: z.boolean(),
  allowSsr: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

export type Tenant = z.infer<typeof TenantSchema>;

export const PublicTenantSchema = TenantSchema.omit({ ownerUserId: true });

export type PublicTenant = z.infer<typeof PublicTenantSchema>;

export const TenantBindingSchema = z.object({
  hostname: z
    .string()
    .describe("Hostname that routes to this tenant (subdomain, custom domain, or alias)"),
  tenantId: z.string().describe("ID of the tenant that owns this binding"),
  accountId: z.string(),
  allowUiOverrides: z.boolean(),
  allowBackendOverrides: z.boolean(),
  allowSsr: z.boolean(),
  status: TenantStatusSchema,
});

export const TenantAppSchema = z.object({
  accountId: z.string().describe("NEAR account that owns the tenant runtime"),
  name: z.string(),
  status: TenantStatusSchema,
  ownerKind: z
    .string()
    .describe("'dao' for DAO-owned tenants, 'user' for personal spawns, 'platform' otherwise"),
  hostname: z
    .string()
    .nullable()
    .describe("Primary domain binding hostname, or null when the tenant has none"),
  node: z
    .object({
      id: z.string(),
      slug: z.string(),
      kind: z.string().nullable(),
      name: z.string(),
    })
    .nullable()
    .describe("Node attached to this tenant, or null"),
  createdAt: z.string(),
});

export const TenantBindingRecordSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  hostname: z.string(),
  isPrimary: z.boolean(),
  isVerified: z.boolean(),
  verificationToken: z.string(),
  verifiedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const TenantBindingPublicSchema = TenantBindingRecordSchema.omit({
  verificationToken: true,
});

export type TenantBindingPublic = z.infer<typeof TenantBindingPublicSchema>;

export const NodeSchema = z.object({
  id: z.string(),
  kind: NodeKindSchema,
  slug: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  tenantId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Node = z.infer<typeof NodeSchema>;

export const SubtreeValidatorSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  network: z.string(),
  protocol: z.string(),
  role: ValidatorRoleSchema,
  isDefault: z.boolean(),
});

export const SubtreeNodeSchema = z.object({
  id: z.string(),
  kind: NodeKindSchema,
  slug: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  validators: z.array(SubtreeValidatorSchema),
});

export const NodeSummarySchema = z.object({
  node: NodeSchema,
  childrenCount: z.number().int().nonnegative(),
  subtreeNodeCount: z.number().int().nonnegative(),
  validators: z.array(ValidatorSchema),
  subtreeValidatorCount: z.number().int().nonnegative(),
  subtreeValidatorCountsByRole: z.object({
    official: z.number().int().nonnegative(),
    community: z.number().int().nonnegative(),
  }),
  stakingValidators: StakingValidatorsSchema,
  children: z.array(
    z.object({
      id: z.string(),
      kind: NodeKindSchema,
      slug: z.string(),
      name: z.string(),
    }),
  ),
});

export type NodeSummary = z.infer<typeof NodeSummarySchema>;

export const NodeListSummarySchema = z.object({
  node: NodeSchema,
  childrenCount: z.number().int().nonnegative(),
  validatorCount: z.number().int().nonnegative(),
});

export const BundleFileSchema = z.object({
  path: z.string().min(1).max(512),
  contentBase64: z.string().min(1),
});

export const StorageUploadResultSchema = z.object({
  stored: z.number().int(),
  totalBytes: z.number().int(),
  integrity: z.record(z.string(), z.string()),
  storage: z
    .enum(["s3", "memory"])
    .describe(
      "Resolved bundle-storage backend: `s3` (R2/MinIO, persistent) or `memory` (ephemeral — bytes are lost on restart)",
    ),
});

export const contract = oc.router({
  ...discoveryContract,

  ping: oc.route({ method: "GET", path: "/ping" }).output(
    z.object({
      status: z.literal("ok"),
      timestamp: z.iso.datetime(),
    }),
  ),

  listTenants: oc
    .route({ method: "GET", path: "/tenants" })
    .output(z.array(TenantSchema))
    .errors({ UNAUTHORIZED, FORBIDDEN }),

  createTenant: oc
    .route({ method: "POST", path: "/tenants" })
    .input(
      z.object({
        name: z.string(),
        accountId: z.string(),
        status: z.enum(["active", "pending"]).optional(),
        allowUiOverrides: z.boolean().default(true),
        allowBackendOverrides: z.boolean().default(false),
        allowSsr: z.boolean().default(false),
      }),
    )
    .output(TenantSchema)
    .errors({
      UNAUTHORIZED,
      FORBIDDEN,
      BAD_REQUEST,
      CONFLICT: {
        status: 409,
        message: "Tenant with this accountId already exists",
      },
    }),

  spawnTenant: oc
    .route({
      method: "POST",
      path: "/tenants/spawn",
      summary: "Spawn a user-owned tenant with a primary binding",
      description:
        "Session-gated — creates a tenant owned by the signed-in user's linked NEAR account " +
        "(wallet or passkey-derived), with the hostname as its primary binding. Hostnames under " +
        "a configured gateway zone are verified automatically.",
    })
    .input(
      z.object({
        name: z.string().min(1),
        hostname: z.string().min(1),
      }),
    )
    .output(
      z.object({
        tenant: TenantSchema,
        binding: TenantBindingRecordSchema,
        ownerAccountId: z.string(),
        publishStatus: z.enum(["pending_funding", "ready"]),
      }),
    )
    .errors({
      UNAUTHORIZED,
      FORBIDDEN,
      BAD_REQUEST,
      CONFLICT: { status: 409, message: "Tenant or hostname already exists" },
    }),

  getSpawnStatus: oc
    .route({
      method: "GET",
      path: "/tenants/spawn/{tenantId}",
      summary: "Spawn status for a user-owned tenant",
      description:
        "Returns the tenant, its bindings, and whether the owner account still needs on-chain " +
        "funding before the tenant config can be published.",
    })
    .input(z.object({ tenantId: z.string() }))
    .output(
      z.object({
        tenant: TenantSchema,
        bindings: z.array(TenantBindingRecordSchema),
        ownerAccountId: z.string(),
        publishStatus: z.enum(["pending_funding", "ready"]),
      }),
    )
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  updateTenant: oc
    .route({ method: "PATCH", path: "/tenants/{tenantId}" })
    .input(
      z.object({
        tenantId: z.string(),
        name: z.string().optional(),
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
    .output(PublicTenantSchema.nullable()),

  resolveTenantByOrgId: oc
    .route({ method: "GET", path: "/tenants/org/{orgId}" })
    .input(z.object({ orgId: z.string() }))
    .output(PublicTenantSchema)
    .errors({ NOT_FOUND }),

  listTenantBindings: oc
    .route({
      method: "GET",
      path: "/tenants/bindings",
      summary: "List all active tenant domain bindings",
      description:
        "Public — returns hostname-to-tenant mapping used by the host's BindingResolver.",
    })
    .output(z.array(TenantBindingSchema)),

  listTenantApps: oc
    .route({
      method: "GET",
      path: "/tenants/apps",
      summary: "List active tenants for discovery",
      description:
        "Public — DB-backed discovery listing of active tenants with their primary hostname and attached node. Replaces FastKV registry scans for tenant discovery.",
    })
    .output(z.array(TenantAppSchema)),

  listStakeCommunities: oc
    .route({
      method: "GET",
      path: "/stake/communities",
      summary: "List communities available for staking",
      description:
        "Session-aware — active organization first, organization memberships as fallback, and the full public directory for anonymous visitors.",
    })
    .output(z.array(TenantAppSchema)),

  listTenantBindingsForTenant: oc
    .route({
      method: "GET",
      path: "/tenants/{tenantId}/bindings",
      summary: "List domain bindings for a specific tenant",
    })
    .input(z.object({ tenantId: z.string() }))
    .output(z.array(TenantBindingRecordSchema))
    .errors({ UNAUTHORIZED, NOT_FOUND }),

  createBinding: oc
    .route({ method: "POST", path: "/tenants/{tenantId}/bindings" })
    .input(
      z.object({
        tenantId: z.string(),
        hostname: z.string(),
        isPrimary: z.boolean().default(false),
      }),
    )
    .output(TenantBindingRecordSchema)
    .errors({
      UNAUTHORIZED,
      FORBIDDEN,
      BAD_REQUEST,
      NOT_FOUND,
      CONFLICT: { status: 409, message: "Hostname already in use" },
    }),

  verifyCustomDomain: oc
    .route({
      method: "POST",
      path: "/tenants/{tenantId}/bindings/{bindingId}/verify",
    })
    .input(z.object({ tenantId: z.string(), bindingId: z.string() }))
    .output(TenantBindingRecordSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

  deleteBinding: oc
    .route({
      method: "POST",
      path: "/tenants/{tenantId}/bindings/{bindingId}/delete",
    })
    .input(z.object({ tenantId: z.string(), bindingId: z.string() }))
    .output(z.object({ success: z.literal(true) }))
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  setPrimaryBinding: oc
    .route({
      method: "POST",
      path: "/tenants/{tenantId}/bindings/{bindingId}/primary",
    })
    .input(z.object({ tenantId: z.string(), bindingId: z.string() }))
    .output(TenantBindingRecordSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  resolveBindingByHostname: oc
    .route({
      method: "GET",
      path: "/tenants/bindings/resolve",
      summary: "Resolve a binding by hostname",
      description:
        "Public — returns the binding record for a hostname (used by the host resolver). " +
        "The DNS verification token is never included.",
    })
    .input(z.object({ hostname: z.string() }))
    .output(TenantBindingPublicSchema.nullable()),

  bindingPreflight: oc
    .route({
      method: "POST",
      path: "/tenants/bindings/preflight",
      summary: "Check hostname availability for a new domain binding",
    })
    .input(z.object({ hostname: z.string() }))
    .output(
      z.object({
        hostname: z.object({
          available: z.boolean(),
          format: z.enum(["valid", "invalid"]),
        }),
      }),
    )
    .errors({ UNAUTHORIZED, BAD_REQUEST }),

  applyNodeProposal: oc
    .route({ method: "POST", path: "/nodes/proposals/apply" })
    .input(
      NodeProposalPayloadSchema.extend({
        hostname: z.string().min(1),
        poolAccountId: z.string().min(1).optional(),
      }),
    )
    .output(z.object({ nodeId: z.string() }))
    .errors({
      UNAUTHORIZED,
      FORBIDDEN,
      BAD_REQUEST,
      NOT_FOUND,
      CONFLICT: {
        status: 409,
        message: "Node proposal resources already exist",
      },
    }),

  listNodes: oc
    .route({ method: "GET", path: "/nodes" })
    .input(
      z.object({
        kind: z.string().min(1).optional(),
        parentId: z.string().nullable().optional(),
        tenantId: z.string().optional(),
      }),
    )
    .output(z.array(NodeSchema)),

  listNodeSummaries: oc
    .route({
      method: "GET",
      path: "/nodes/summaries",
      summary: "List nodes with direct child and validator counts",
    })
    .input(
      z.object({
        scope: z.enum(["roots", "all"]),
        kind: z.string().min(1).optional(),
      }),
    )
    .output(z.array(NodeListSummarySchema)),

  getNode: oc
    .route({ method: "GET", path: "/nodes/{nodeId}" })
    .input(z.object({ nodeId: z.string() }))
    .output(NodeSchema.nullable()),

  createNode: oc
    .route({ method: "POST", path: "/nodes" })
    .input(
      z.object({
        kind: z.string().min(1),
        slug: z.string(),
        name: z.string(),
        parentId: z.string().nullable().optional(),
        tenantId: z.string(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .output(NodeSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST, NOT_FOUND }),

  spawnNode: oc
    .route({
      method: "POST",
      path: "/nodes/spawn",
      summary: "Spawn a node of any kind under a parent",
      description:
        "Org-scoped — spawns a node with an optional kind label (geo kinds are legacy labels in metadata), optional tenant attachment, and no kind-validated parentage. parentId is the only hierarchy axis.",
    })
    .input(
      z.object({
        kind: z.string().min(1).optional(),
        slug: z.string(),
        name: z.string(),
        parentId: z.string().nullable().optional(),
        tenantId: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .output(NodeSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST, NOT_FOUND }),

  updateNode: oc
    .route({ method: "PATCH", path: "/nodes/{nodeId}" })
    .input(
      z.object({
        nodeId: z.string(),
        kind: z.string().min(1).optional(),
        slug: z.string().optional(),
        name: z.string().optional(),
        parentId: z.string().nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .output(NodeSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

  setNodeBulletin: oc
    .route({
      method: "PUT",
      path: "/nodes/{nodeId}/bulletin",
      summary: "Set or clear a community's dashboard bulletin",
      description:
        "Merges into node metadata rather than replacing it, unlike updateNode — safe against clobbering poolAccountId or other metadata keys.",
    })
    .input(
      z.object({
        nodeId: z.string(),
        bulletin: z.string().max(2000).nullable(),
      }),
    )
    .output(NodeSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  deleteNode: oc
    .route({ method: "POST", path: "/nodes/{nodeId}/delete" })
    .input(z.object({ nodeId: z.string() }))
    .output(z.object({ success: z.literal(true) }))
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  listRootNodes: oc
    .route({
      method: "GET",
      path: "/nodes/roots",
      summary: "List root nodes (no parent)",
      description: "Public — returns top-level nodes such as countries or city-states.",
    })
    .output(z.array(NodeSchema)),

  listChildren: oc
    .route({ method: "GET", path: "/nodes/{nodeId}/children" })
    .input(z.object({ nodeId: z.string() }))
    .output(z.array(NodeSchema)),

  getSubtree: oc
    .route({
      method: "GET",
      path: "/nodes/{nodeId}/subtree",
      summary: "Get a node subtree with validators",
      description: "Public — returns the node and all descendants with validators per node.",
    })
    .input(z.object({ nodeId: z.string() }))
    .output(z.array(SubtreeNodeSchema))
    .errors({ NOT_FOUND }),

  getNodeSummary: oc
    .route({
      method: "GET",
      path: "/nodes/{nodeId}/summary",
      summary: "Get an aggregated node summary",
      description: "Public — returns node structure, validator totals, and staking resolution.",
    })
    .input(z.object({ nodeId: z.string() }))
    .output(NodeSummarySchema)
    .errors({ NOT_FOUND }),

  resolveNodeBySlug: oc
    .route({ method: "GET", path: "/nodes/resolve" })
    .input(
      z.object({
        slug: z.string(),
        parentId: z.string().nullable().optional(),
      }),
    )
    .output(NodeSchema.nullable()),

  listValidators: oc
    .route({
      method: "GET",
      path: "/validators",
      summary: "List validators with optional filters",
    })
    .input(
      z.object({
        nodeId: z.string().optional(),
        role: ValidatorRoleSchema.optional(),
      }),
    )
    .output(z.array(ValidatorSchema)),

  listValidatorsByNode: oc
    .route({
      method: "GET",
      path: "/validators/by-node/{nodeId}",
      summary: "List all validators directly attached to a node",
    })
    .input(z.object({ nodeId: z.string() }))
    .output(z.array(ValidatorSchema)),

  getValidator: oc
    .route({ method: "GET", path: "/validators/{validatorId}" })
    .input(z.object({ validatorId: z.string() }))
    .output(ValidatorSchema.nullable()),

  resolveValidatorByAccountId: oc
    .route({
      method: "GET",
      path: "/validators/resolve",
      summary: "Resolve a validator by accountId",
    })
    .input(z.object({ accountId: z.string() }))
    .output(ValidatorSchema.nullable()),

  resolveStakingValidators: oc
    .route({
      method: "GET",
      path: "/validators/staking/{nodeId}",
      summary: "Resolve validators for staking from a node (subtree + ancestor walk-up)",
      description:
        "Returns the validators that should be used for staking from this node. First searches the node's subtree (self + descendants). If empty, walks up parent_id until validators are found.",
    })
    .input(z.object({ nodeId: z.string() }))
    .output(StakingValidatorsSchema),

  createValidator: oc
    .route({ method: "POST", path: "/validators" })
    .input(
      z.object({
        nodeId: z.string(),
        accountId: z.string(),
        network: z.string().default("mainnet"),
        protocol: ProtocolSchema,
        role: ValidatorRoleSchema.default("official"),
        isDefault: z.boolean().default(false),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .output(ValidatorSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

  updateValidator: oc
    .route({ method: "PATCH", path: "/validators/{validatorId}" })
    .input(
      z.object({
        validatorId: z.string(),
        accountId: z.string().optional(),
        network: z.string().optional(),
        protocol: z.string().optional(),
        role: ValidatorRoleSchema.optional(),
        isDefault: z.boolean().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .output(ValidatorSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

  deleteValidator: oc
    .route({ method: "POST", path: "/validators/{validatorId}/delete" })
    .input(z.object({ validatorId: z.string() }))
    .output(z.object({ success: z.literal(true) }))
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  setDefaultValidator: oc
    .route({ method: "POST", path: "/validators/{validatorId}/default" })
    .input(z.object({ validatorId: z.string() }))
    .output(ValidatorSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

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

  createEventOnboardingCode: oc
    .route({ method: "POST", path: "/onboarding/event-codes" })
    .input(
      z.object({
        eventId: z.uuid(),
        maxUses: z.number().int().min(1).max(500).optional(),
        expiresAt: z.iso.datetime().optional(),
      }),
    )
    .output(EventOnboardingCodeSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

  uploadStorageBundle: oc
    .route({ method: "POST", path: "/storage/bundles" })
    .input(
      z.object({
        account: z.string().min(1),
        gateway: z.string().min(1),
        workspace: z.string().min(1),
        files: z.array(BundleFileSchema).min(1).max(10_000),
      }),
    )
    .output(StorageUploadResultSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST, CONNECTION_ERROR }),
});

export type ContractType = typeof contract;
