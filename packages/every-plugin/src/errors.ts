import { COMMON_ERROR_STATUS_MAP } from "@orpc/server";
import { z } from "zod";

/**
 * Common error schemas for plugin contracts.
 * Import individually or use the grouped PluginErrors export.
 *
 * @example
 * ```typescript
 * import { NOT_FOUND, FORBIDDEN, UNAUTHORIZED } from "every-plugin/errors";
 *
 * export const contract = oc.router({
 *   getData: oc.route(...)
 *     .errors({ NOT_FOUND, FORBIDDEN, UNAUTHORIZED })
 * });
 * ```
 */

export const UNAUTHORIZED = {
  status: 401,
  data: z.object({
    apiKeyProvided: z.boolean(),
    provider: z.string().optional(),
    authType: z.enum(["apiKey", "oauth", "token"]).optional(),
  }),
} as const;

export const RATE_LIMITED = {
  status: 429,
  data: z.object({
    retryAfter: z.number().int().min(1),
    remainingRequests: z.number().int().min(0).optional(),
    resetTime: z.string().datetime().optional(),
    limitType: z.enum(["requests", "tokens", "bandwidth"]).optional(),
  }),
} as const;

export const SERVICE_UNAVAILABLE = {
  status: 503,
  data: z.object({
    retryAfter: z.number().int().optional(),
    maintenanceWindow: z.boolean().default(false),
    estimatedUptime: z.string().datetime().optional(),
  }),
} as const;

export const BAD_REQUEST = {
  status: 400,
  data: z.object({
    invalidFields: z.array(z.string()).optional(),
    validationErrors: z
      .array(
        z.object({
          field: z.string(),
          message: z.string(),
          code: z.string().optional(),
        }),
      )
      .optional(),
  }),
} as const;

export const NOT_FOUND = {
  status: 404,
  data: z.object({
    resource: z.string().optional(),
    resourceId: z.string().optional(),
  }),
} as const;

export const FORBIDDEN = {
  status: 403,
  data: z.object({
    requiredPermissions: z.array(z.string()).optional(),
    action: z.string().optional(),
  }),
} as const;

export const TIMEOUT = {
  status: 504,
  data: z.object({
    timeoutMs: z.number().int().min(0).optional(),
    operation: z.string().optional(),
    retryable: z.boolean().default(true),
  }),
} as const;

export const CONNECTION_ERROR = {
  status: 502,
  data: z.object({
    errorCode: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().optional(),
    suggestion: z.string().optional(),
  }),
} as const;

/**
 * Grouped export for all plugin errors.
 * Use individual imports for cleaner code.
 */
export const PluginErrors = {
  UNAUTHORIZED,
  RATE_LIMITED,
  SERVICE_UNAVAILABLE,
  BAD_REQUEST,
  NOT_FOUND,
  FORBIDDEN,
  TIMEOUT,
  CONNECTION_ERROR,
} as const;

/**
 * Error-code -> HTTP-status map for handlers.
 *
 * oRPC v2 resolves statuses at the handler boundary via `errorStatusMap`
 * (default `COMMON_ERROR_STATUS_MAP`, where TIMEOUT is 408). Providing a
 * map REPLACES the default entirely, so the standard codes must be spread
 * back in. These custom entries preserve the v1 wire behavior:
 * TIMEOUT -> 504, CONNECTION_ERROR -> 502.
 */
export const PLUGIN_ERROR_STATUS_MAP: Record<string, number> = {
  ...COMMON_ERROR_STATUS_MAP,
  TIMEOUT: 504,
  CONNECTION_ERROR: 502,
} as const;

export type { PluginLoadFailureInfo } from "./runtime/errors";
export {
  classifyPluginFailure,
  extractFromFiberFailure,
  formatORPCError,
  ModuleFederationError,
  PluginRuntimeError,
  toPluginRuntimeError,
  ValidationError,
  wrapORPCError,
} from "./runtime/errors";
