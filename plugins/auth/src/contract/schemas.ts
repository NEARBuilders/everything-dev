import { z } from "zod";

export const nearIdentitySchema = z.object({
  accountId: z.string(),
  network: z.string(),
  publicKey: z.string(),
  isPrimary: z.boolean(),
});

export const nearCapabilitiesSchema = z.object({
  primaryAccountId: z.string().nullable(),
  linkedAccounts: z.array(nearIdentitySchema),
  hasNearAccount: z.boolean(),
});

export const organizationMemberSchema = z.object({
  id: z.string(),
  role: z.string(),
});

export const organizationInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.enum(["active", "pending", "rejected"]).default("active"),
  requestedBy: z.string().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
});

export const teamContextSchema = z.object({
  id: z.string(),
  name: z.string(),
  areas: z.array(z.string()),
});

export const organizationContextSchema = z.object({
  activeOrganizationId: z.string().nullable(),
  organization: organizationInfoSchema.nullable(),
  member: organizationMemberSchema.nullable(),
  isPersonal: z.boolean(),
  hasOrganization: z.boolean(),
  teams: z.array(teamContextSchema),
  activeTeamId: z.string().nullable(),
});

export const sessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  role: z.string().nullable(),
  isAnonymous: z.boolean().nullable(),
  locale: z.string().nullable(),
});

export const sessionDataSchema = z.object({
  session: z
    .object({
      id: z.string(),
      token: z.string(),
      userId: z.string(),
      expiresAt: z.date(),
      activeOrganizationId: z.string().nullable(),
    })
    .nullable(),
  user: sessionUserSchema.nullable(),
});

export const userPrincipalSchema = z.object({
  type: z.literal("user"),
  userId: z.string(),
  user: sessionUserSchema,
});

export const organizationPrincipalSchema = z.object({
  type: z.literal("organization"),
  organizationId: z.string(),
});

export const anonymousPrincipalSchema = z.object({
  type: z.literal("anonymous"),
  userId: z.string(),
  user: sessionUserSchema.nullable(),
});

export const principalSchema = z.union([
  userPrincipalSchema,
  organizationPrincipalSchema,
  anonymousPrincipalSchema,
]);

export const apiKeyContextSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  permissions: z.record(z.string(), z.array(z.string())).nullable(),
});

export const requestContextSchema = z.object({
  user: sessionUserSchema.nullable(),
  userId: z.string().nullable(),
  isAuthenticated: z.boolean(),
  authMethod: z.enum(["session", "apiKey", "anonymous", "none"]),
  principal: principalSchema.nullable(),
  apiKey: apiKeyContextSchema.nullable(),
  permissions: z.record(z.string(), z.array(z.string())).nullable(),
  near: nearCapabilitiesSchema,
  organization: organizationContextSchema,
  organizations: z
    .array(
      z.object({
        id: z.string(),
        role: z.string(),
        name: z.string().optional(),
        slug: z.string().optional(),
      }),
    )
    .optional(),
});

export const apiKeySchema = z.object({
  id: z.string(),
  configId: z.string(),
  referenceId: z.string(),
  name: z.string().nullable(),
  prefix: z.string().nullable(),
  start: z.string().nullable(),
  enabled: z.boolean(),
  rateLimitEnabled: z.boolean(),
  rateLimitMax: z.number().nullable(),
  rateLimitTimeWindow: z.number().nullable(),
  remaining: z.number().nullable(),
  requestCount: z.number(),
  lastRequest: z.date().nullable(),
  expiresAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  metadata: z.unknown().nullable(),
  permissions: z.record(z.string(), z.array(z.string())).nullable(),
});

export const apiKeyRateLimitSchema = z.object({
  enabled: z.boolean().optional(),
  timeWindow: z.number().int().positive().optional(),
  max: z.number().int().positive().optional(),
});

export const memberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  organizationId: z.string(),
  role: z.string(),
  createdAt: z.date(),
});

export const memberWithUserSchema = memberSchema.extend({
  user: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
      email: z.string().nullable(),
      image: z.string().nullable(),
    })
    .nullable(),
});

export const invitationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  email: z.string().nullable(),
  role: z.string().nullable(),
  status: z.string(),
  expiresAt: z.date(),
  inviterId: z.string(),
  teamId: z.string().nullable(),
  nearAccountId: z.string().nullable(),
  nearNetwork: z.enum(["mainnet", "testnet"]).nullable(),
});

export const teamSchema = z.object({
  id: z.string(),
  name: z.string(),
  organizationId: z.string(),
  areas: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const teamMemberSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  userId: z.string(),
  createdAt: z.date(),
});

export const onboardingCodeSummarySchema = z.object({
  id: z.string(),
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

export const daoOutputSchema = z.object({
  daoAccountId: z.string().nullable(),
  daoNetwork: z.enum(["mainnet", "testnet"]).nullable(),
});

// ── NEAR SIWN Schemas ────────────────────────────────────────────────

export const signedMessageSchema = z.object({
  accountId: z.string(),
  publicKey: z.string(),
  signature: z.string(),
  state: z.string().optional(),
});

export const nearAccountSchema = z.object({
  id: z.string(),
  userId: z.string(),
  accountId: z.string(),
  network: z.string(),
  publicKey: z.string(),
  providerId: z.literal("siwn").optional(),
  isPrimary: z.boolean(),
  isActive: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  createdAt: z.date(),
});

export const socialImageSchema = z.object({
  url: z.string().optional(),
  ipfs_cid: z.string().optional(),
});

export const profileOutputSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    image: socialImageSchema.optional(),
    backgroundImage: socialImageSchema.optional(),
    linktree: z.record(z.string(), z.string()).optional(),
  })
  .nullable();

export const relayedTransactionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  txHash: z.string(),
  senderId: z.string(),
  receiverId: z.string(),
  network: z.string(),
  status: z.string(),
  gasUsed: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});

export const relayerInfoOutputSchema = z.object({
  enabled: z.boolean(),
  accountId: z.string().optional(),
  mode: z.enum(["ephemeral", "explicit"]).optional(),
  network: z.enum(["mainnet", "testnet"]).optional(),
  balance: z.string().optional(),
  available: z.string().optional(),
  staked: z.string().optional(),
  storageUsage: z.string().optional(),
  storageBytes: z.number().optional(),
  hasContract: z.boolean().optional(),
  hasKey: z.boolean().optional(),
  publicKey: z.string().optional(),
  createdAt: z.string().optional(),
  lastUsedAt: z.string().optional(),
});
