import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { Errors } from "./errors";
import { apiKeyRateLimitSchema, apiKeySchema } from "./schemas";

export const apiKeyRoutes = {
  listApiKeys: oc
    .route({ method: "GET", path: "/v1/auth/api-keys" })
    .input(
      z.object({
        configId: z.string().optional(),
        organizationId: z.string().optional(),
        limit: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().optional(),
        sortBy: z.enum(["createdAt", "name", "expiresAt", "lastRequest"]).optional(),
        sortDirection: z.enum(["asc", "desc"]).optional(),
      }),
    )
    .output(z.array(apiKeySchema))
    .errors(Errors),

  createApiKey: oc
    .route({ method: "POST", path: "/v1/auth/api-keys" })
    .input(
      z.object({
        name: z.string().optional(),
        prefix: z.string().optional(),
        expiresIn: z.number().int().positive().optional(),
        rateLimit: apiKeyRateLimitSchema.optional(),
        organizationId: z.string().optional(),
        configId: z.string().optional(),
      }),
    )
    .output(apiKeySchema.extend({ key: z.string() }))
    .errors(Errors),

  createDeployKey: oc
    .route({ method: "POST", path: "/v1/auth/deploy-keys" })
    .input(
      z.object({
        account: z.string().min(1),
        gateway: z.string().min(1),
        name: z.string().optional(),
        expiresIn: z.number().int().positive().optional(),
      }),
    )
    .output(apiKeySchema.extend({ key: z.string() }))
    .errors(Errors),

  updateApiKey: oc
    .route({ method: "PATCH", path: "/v1/auth/api-keys/{id}" })
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        enabled: z.boolean().optional(),
        expiresIn: z.number().int().positive().nullable().optional(),
        rateLimit: apiKeyRateLimitSchema.optional(),
        organizationId: z.string().optional(),
        configId: z.string().optional(),
      }),
    )
    .output(apiKeySchema)
    .errors(Errors),

  deleteApiKey: oc
    .route({ method: "DELETE", path: "/v1/auth/api-keys/{id}" })
    .input(
      z.object({
        id: z.string(),
        organizationId: z.string().optional(),
        configId: z.string().optional(),
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  verifyApiKey: oc
    .route({ method: "POST", path: "/v1/auth/api-keys/verify" })
    .input(
      z.object({
        key: z.string(),
        configId: z.string().optional(),
        permissions: z.record(z.string(), z.array(z.string())).optional(),
      }),
    )
    .output(
      z.object({
        valid: z.boolean(),
        error: z
          .object({
            code: z.string(),
            message: z.string().optional(),
          })
          .nullable(),
        key: apiKeySchema.nullable(),
      }),
    )
    .errors(Errors),
};
