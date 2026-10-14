import { Context, Effect, Layer } from "effect";
import { attemptAuth } from "../attempts";
import { API_KEY_CONFIG_IDS } from "../config-schemas";
import type { InferOutput } from "../contract";
import { AuthApiTag, type PluginServices } from "../service-types";
import { ApiKeyNotFound, type AuthFailure, isAuthFailure } from "./domain-errors";

type Auth = PluginServices["auth"];

export interface ApiKeyRateLimitInput {
  enabled?: boolean;
  max?: number;
  timeWindow?: number;
}

export class ApiKeysService extends Context.Service<
  ApiKeysService,
  {
    listApiKeys: (
      headers: Headers,
      input:
        | {
            configId?: string;
            organizationId?: string;
            limit?: number;
            offset?: number;
            sortBy?: string;
            sortDirection?: string;
          }
        | undefined,
    ) => Effect.Effect<InferOutput<"listApiKeys">, AuthFailure>;
    createApiKey: (
      userId: string,
      input: {
        name?: string;
        prefix?: string;
        expiresIn?: number;
        permissions?: Record<string, string[]>;
        metadata?: unknown;
        organizationId?: string;
        configId?: string;
        rateLimit?: ApiKeyRateLimitInput;
      },
    ) => Effect.Effect<InferOutput<"createApiKey">, AuthFailure>;
    updateApiKey: (
      userId: string,
      input: {
        id: string;
        name?: string;
        enabled?: boolean;
        permissions?: Record<string, string[]> | null;
        metadata?: unknown;
        expiresIn?: number | null;
        organizationId?: string;
        configId?: string;
        rateLimit?: ApiKeyRateLimitInput;
      },
    ) => Effect.Effect<InferOutput<"updateApiKey">, AuthFailure>;
    deleteApiKey: (
      headers: Headers,
      input: { id: string; configId?: string; organizationId?: string },
    ) => Effect.Effect<{ success: boolean }, AuthFailure>;
    verifyApiKey: (
      headers: Headers,
      input: {
        key: string;
        configId?: string;
        permissions?: Record<string, string[]>;
      },
    ) => Effect.Effect<InferOutput<"verifyApiKey">, AuthFailure>;
  }
>()("auth/ApiKeysService") {}

export const buildApiKeysService = ({ auth }: { auth: Auth }) =>
  ApiKeysService.of({
    listApiKeys: (headers, input) =>
      attemptAuth(() => {
        const queryParams = [
          "configId",
          "organizationId",
          "limit",
          "offset",
          "sortBy",
          "sortDirection",
        ] as const;
        const query: Record<string, string | number> = {};
        for (const key of queryParams) {
          if (input?.[key] !== undefined) {
            query[key] = input[key];
          }
        }
        return auth.api.listApiKeys({
          headers,
          query: Object.keys(query).length > 0 ? query : undefined,
        });
      }).pipe(Effect.map((result) => result.apiKeys ?? [])),

    createApiKey: (userId, input) =>
      attemptAuth(() =>
        auth.api.createApiKey({
          body: {
            userId,
            configId: input.configId ?? (input.organizationId ? "org-keys" : "user-keys"),
            name: input.name,
            prefix: input.prefix,
            expiresIn: input.expiresIn,
            permissions: input.permissions,
            metadata: input.metadata,
            organizationId: input.organizationId,
            rateLimitEnabled: input.rateLimit?.enabled,
            rateLimitMax: input.rateLimit?.max,
            rateLimitTimeWindow: input.rateLimit?.timeWindow,
          },
        }),
      ),

    updateApiKey: (userId, input) =>
      attemptAuth(() =>
        auth.api.updateApiKey({
          body: {
            userId,
            configId: input.configId ?? (input.organizationId ? "org-keys" : "user-keys"),
            keyId: input.id,
            name: input.name,
            enabled: input.enabled,
            permissions: input.permissions,
            metadata: input.metadata,
            expiresIn: input.expiresIn,
            rateLimitEnabled: input.rateLimit?.enabled,
            rateLimitMax: input.rateLimit?.max,
            rateLimitTimeWindow: input.rateLimit?.timeWindow,
          },
        }),
      ),

    deleteApiKey: (headers, input) =>
      attemptAuth(async () => {
        const configId = input.configId ?? (input.organizationId ? "org-keys" : "user-keys");
        try {
          await auth.api.deleteApiKey({
            headers,
            body: { keyId: input.id, configId },
          });
          return;
        } catch (firstError) {
          if (isAuthFailure(firstError) && !(firstError instanceof ApiKeyNotFound)) {
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
      }).pipe(Effect.as({ success: true })),

    verifyApiKey: (headers, input) =>
      attemptAuth(() =>
        input.configId
          ? auth.api
              .verifyApiKey({
                headers,
                body: {
                  key: input.key,
                  configId: input.configId,
                  permissions: input.permissions,
                },
              })
              .then((result) => serializeVerifyResult(result))
          : verifyAcrossConfigs(auth, headers, input),
      ),
  });

export const ApiKeysServiceLive = Layer.effect(
  ApiKeysService,
  Effect.gen(function* () {
    const { auth } = yield* AuthApiTag;
    return buildApiKeysService({ auth });
  }),
);

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

async function verifyAcrossConfigs(
  auth: Auth,
  headers: Headers,
  input: { key: string; configId?: string; permissions?: Record<string, string[]> },
) {
  for (const configId of API_KEY_CONFIG_IDS) {
    const result = await auth.api.verifyApiKey({
      headers,
      body: {
        key: input.key,
        configId,
        permissions: input.permissions,
      },
    });
    if (result.valid) {
      return {
        valid: true,
        error: null,
        key: result.key ? { ...result.key, permissions: result.key.permissions ?? null } : null,
      };
    }
  }
  return {
    valid: false,
    error: { code: "KEY_NOT_FOUND", message: "Invalid API key" },
    key: null,
  };
}
