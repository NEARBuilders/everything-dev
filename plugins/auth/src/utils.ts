import { ORPCError } from "@orpc/server";
import { AuthApiError } from "./services/domain-errors";
export function toError(e: unknown): Error {
  if (typeof e === "object" && e !== null && "message" in e) {
    return new Error(String(e.message));
  }
  return new Error(String(e));
}

export function tryJsonParse<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

type HeaderInput = ConstructorParameters<typeof Headers>[0];

export function createHeaders(reqHeaders?: HeaderInput): Headers {
  return new Headers(reqHeaders);
}

/**
 * Drops the `better-auth.session_data` cookie (and its chunked
 * `.0`, `.1`, … variants) from a `cookie` header, forcing Better Auth's
 * session lookup to fall back to a fresh database read via the session
 * token instead of the cached payload — which reflects the session as of
 * that cookie's last refresh, not writes made earlier in the same request.
 */
export function withoutSessionDataCookie(headers: Headers): Headers {
  const cookie = headers.get("cookie");
  if (!cookie) return headers;
  const kept = cookie
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => !pair.startsWith("better-auth.session_data"))
    .join("; ");
  const result = new Headers(headers);
  if (kept) result.set("cookie", kept);
  else result.delete("cookie");
  return result;
}

export const localDevTrustedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://[::1]:3000",
];

export function getActiveOrganizationId(session: unknown): string | null {
  if (session && typeof session === "object" && "activeOrganizationId" in session) {
    return (session as { activeOrganizationId: string | null }).activeOrganizationId;
  }
  return null;
}

export function getActiveTeamId(session: unknown): string | null {
  if (session && typeof session === "object" && "activeTeamId" in session) {
    return (session as { activeTeamId: string | null }).activeTeamId ?? null;
  }
  return null;
}

function mapAuthError(error: unknown): { code: string; message: string; data: Record<string, unknown> } {
  if (error instanceof ORPCError) {
    return {
      code: error.code,
      message: error.message,
      data: (error.data as Record<string, unknown>) ?? {},
    };
  }
  if (error && typeof error === "object") {
    const apiError = error as {
      status?: number | string;
      statusCode?: number;
      message?: string;
      code?: string;
    };
    const status =
      typeof apiError.statusCode === "number"
        ? apiError.statusCode
        : typeof apiError.status === "number"
          ? apiError.status
          : undefined;
    if (status) {
      const statusMap: Record<
        number,
        {
          code:
            | "BAD_REQUEST"
            | "UNAUTHORIZED"
            | "FORBIDDEN"
            | "NOT_FOUND"
            | "INTERNAL_SERVER_ERROR"
            | "SERVICE_UNAVAILABLE";
          data: Record<string, unknown>;
        }
      > = {
        400: { code: "BAD_REQUEST", data: {} },
        401: { code: "UNAUTHORIZED", data: { apiKeyProvided: false } },
        403: { code: "FORBIDDEN", data: {} },
        404: { code: "NOT_FOUND", data: {} },
        500: { code: "INTERNAL_SERVER_ERROR", data: {} },
        503: { code: "SERVICE_UNAVAILABLE", data: { maintenanceWindow: false } },
      };
      const mapped = statusMap[status] ?? {
        code: "INTERNAL_SERVER_ERROR" as const,
        data: {},
      };
      return {
        code: mapped.code,
        message: apiError.message || "Auth API error",
        data: mapped.data,
      };
    }
  }
  return {
    code: "INTERNAL_SERVER_ERROR",
    message: error instanceof Error ? error.message : "Auth API error",
    data: {},
  };
}

export function toORPCError(error: unknown) {
  if (error instanceof ORPCError) return error;
  const mapped = mapAuthError(error);
  return new ORPCError(mapped.code, { message: mapped.message, data: mapped.data });
}

export function toAuthApiError(error: unknown): AuthApiError {
  const mapped = mapAuthError(error);
  return new AuthApiError({
    code: mapped.code,
    data: mapped.data,
    message: mapped.message,
    cause: error,
  });
}

export async function safeAuthApi<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toORPCError(error);
  }
}

export function parseTeamAreas(metadata: unknown): string[] {
  const parsed =
    typeof metadata === "string" ? tryJsonParse<{ areas?: unknown }>(metadata) : metadata;
  if (!parsed || typeof parsed !== "object") return [];
  const areas = (parsed as { areas?: unknown }).areas;
  return Array.isArray(areas)
    ? areas.filter((area): area is string => typeof area === "string")
    : [];
}

export function serializeTeamAreas(areas: string[]): string {
  return JSON.stringify({ areas: [...new Set(areas)] });
}

export function parseMemberRoles(role: string | null | undefined): string[] {
  if (!role) return [];
  return role
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export interface EmailVisibilityContext {
  user?: { id?: string; role?: string | null } | null;
  userId?: string | null;
  reqHeaders?: HeaderInput;
}

export interface OrgPermissionAuth {
  api: {
    hasPermission: (args: {
      headers: Headers;
      body: { organizationId?: string; permissions: Record<string, string[]> };
    }) => Promise<{ success: boolean }>;
  };
}

export interface OrgPermissionResult {
  permitted: boolean;
  failure?: AuthApiError;
}

export async function hasOrgPermission(
  auth: OrgPermissionAuth,
  context: EmailVisibilityContext,
  organizationId: string | undefined,
  permissions: Record<string, string[]>,
): Promise<OrgPermissionResult> {
  if (context.user?.role === "admin") return { permitted: true };
  try {
    const result = await auth.api.hasPermission({
      headers: createHeaders(context.reqHeaders),
      body: { organizationId, permissions },
    });
    return { permitted: result.success === true };
  } catch (error) {
    return { permitted: false, failure: toAuthApiError(error) };
  }
}

export async function canReadMemberEmails(
  auth: OrgPermissionAuth,
  context: EmailVisibilityContext,
  organizationId?: string,
): Promise<boolean> {
  const { permitted } = await hasOrgPermission(auth, context, organizationId, {
    email: ["read"],
  });
  return permitted;
}

export function visibleEmail(
  rawEmail: string | null | undefined,
  opts: { allowed: boolean; isSelf?: boolean },
): string | null {
  if (!rawEmail) return null;
  if (opts.allowed || opts.isSelf) return rawEmail;
  return null;
}
