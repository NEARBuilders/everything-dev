import { API_KEY_CONFIG_IDS } from "../config-schemas";
import type { PluginServices } from "../service-types";
import { ApiKeyNotFound, isAuthFailure } from "./domain-errors";

type Auth = PluginServices["auth"];

export interface VerifyKeyInput {
  key: string;
  configId?: string;
  permissions?: Record<string, string[]>;
}

/**
 * The ONE verify primitive: every flow that checks an API key against
 * better-auth goes through this call — the cross-config fallback loop, the
 * permission-fallback two-pass, and the session service's key resolution all
 * delegate here so the request body and error shape have a single source.
 */
export function verifyKeyOnce(
  auth: Auth,
  headers: Headers,
  body: { key: string; configId: string; permissions?: Record<string, string[]> },
) {
  return auth.api.verifyApiKey({ headers, body });
}

/**
 * Verifies a key across every API-key config (or the explicit one): the first
 * config that reports the key valid wins.
 */
/** The better-auth verifyApiKey success payload — loose because better-auth
 * types it as any; only the fields the consumers read are named. */
export interface VerifyKeySuccess {
  valid: true;
  key: {
    id: string;
    name?: string | null;
    configId: string;
    referenceId: string;
    permissions?: string | Record<string, string[]> | null;
    [field: string]: unknown;
  };
}

export async function verifyKeyAcrossConfigs(
  auth: Auth,
  headers: Headers,
  input: VerifyKeyInput,
): Promise<VerifyKeySuccess | null> {
  const configIds = input.configId ? [input.configId] : API_KEY_CONFIG_IDS;
  for (const configId of configIds) {
    let keyResult: any;
    try {
      keyResult = await verifyKeyOnce(auth, headers, {
        key: input.key,
        configId,
        permissions: input.permissions,
      });
    } catch {
      continue;
    }

    if (!keyResult.valid || !keyResult.key) continue;

    return keyResult;
  }
  return null;
}

function describePermissions(permissions: Record<string, string[]>): string {
  return Object.entries(permissions)
    .flatMap(([permission, actions]) => actions.map((action) => `${permission}:${action}`))
    .join(", ");
}

/**
 * Distinguishes "key lacks permissions" from "key not found": better-auth's
 * permission check fails a permissions:null key with KEY_NOT_FOUND, so a
 * permissioned verify that misses re-verifies without permissions — a key
 * that only then surfaces is live but under-permissioned.
 */
export async function verifyKeyWithPermissionFallback(
  auth: Auth,
  headers: Headers,
  input: VerifyKeyInput,
) {
  const configIds = input.configId ? [input.configId] : API_KEY_CONFIG_IDS;
  const verify = (configId: string, permissions?: Record<string, string[]>) =>
    verifyKeyOnce(auth, headers, {
      key: input.key,
      configId,
      permissions,
    });

  for (const configId of configIds) {
    const result = await verify(configId, input.permissions);
    if (result.valid) {
      return serializeVerifyResult(result);
    }
  }

  if (input.permissions) {
    for (const configId of configIds) {
      const result = await verify(configId, undefined);
      if (result.valid) {
        return {
          valid: false,
          error: {
            code: "KEY_MISSING_PERMISSIONS",
            message: `API key lacks required permissions (${describePermissions(input.permissions)})`,
          },
          key: null,
        };
      }
    }
  }

  return {
    valid: false,
    error: { code: "KEY_NOT_FOUND", message: "Invalid API key" },
    key: null,
  };
}

function serializeVerifyResult(result: any) {
  return {
    valid: result.valid,
    error: result.error
      ? {
          code: result.error.code ?? "UNKNOWN",
          message: typeof result.error.message === "string" ? result.error.message : undefined,
        }
      : null,
    key: result.key ? { ...result.key, permissions: result.key.permissions ?? null } : null,
  };
}

/**
 * Deletes a key by id, falling back across configs: better-auth scopes deletes
 * to one configId, and callers rarely know which one a key lives in — an
 * explicit-config miss tries the remaining configs before reporting not-found.
 */
export async function deleteKeyAcrossConfigs(
  auth: Auth,
  headers: Headers,
  input: { id: string; configId?: string; organizationId?: string },
): Promise<void> {
  const configId = input.configId ?? (input.organizationId ? "org-keys" : "user-keys");
  try {
    await auth.api.deleteApiKey({
      headers,
      body: { keyId: input.id, configId },
    });
    return;
  } catch (firstError) {
    if (isAuthFailure(firstError) && firstError._tag !== "ApiKeyNotFound") {
      throw firstError;
    }
    for (const fallbackConfigId of API_KEY_CONFIG_IDS) {
      if (fallbackConfigId === configId) continue;
      try {
        await auth.api.deleteApiKey({
          headers,
          body: { keyId: input.id, configId: fallbackConfigId },
        });
        return;
      } catch {}
    }
    throw new ApiKeyNotFound({ message: "API key not found", keyId: input.id });
  }
}
