import { and, eq } from "drizzle-orm";
import { Context, Effect } from "effect";
import { attemptAuth, attemptDb } from "../attempts";
import type { InferOutput } from "../contract";
import * as schema from "../db/schema";
import type { PluginServices } from "../service-types";
import { deleteKeyAcrossConfigs, verifyKeyWithPermissionFallback } from "./api-key-verify";
import { type AuthFailure, DeployKeyAccountNotLinked } from "./domain-errors";

type Auth = PluginServices["auth"];
type Db = PluginServices["db"];

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
    createDeployKey: (
      userId: string,
      input: {
        account: string;
        gateway: string;
        name?: string;
        expiresIn?: number;
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

export const buildApiKeysService = ({ auth, db }: { auth: Auth; db: Db }) =>
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

    createDeployKey: (userId, input) =>
      Effect.gen(function* () {
        const linked = yield* attemptDb(() =>
          db.query.nearAccount.findFirst({
            where: and(
              eq(schema.nearAccount.userId, userId),
              eq(schema.nearAccount.accountId, input.account),
            ),
          }),
        );
        if (!linked) {
          return yield* Effect.fail(
            new DeployKeyAccountNotLinked({
              message: `Deploy keys can only be minted for NEAR accounts linked to your login — link ${input.account} first`,
              action: `deploy-key ${input.account}/${input.gateway}`,
            }),
          );
        }
        return yield* attemptAuth(() =>
          auth.api.createApiKey({
            body: {
              userId,
              configId: "user-keys",
              name: input.name ?? `deploy key — ${input.account}/${input.gateway}`,
              expiresIn: input.expiresIn,
              permissions: DEPLOY_KEY_PERMISSIONS,
              metadata: { account: input.account, gateway: input.gateway },
            },
          }),
        );
      }),

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
      attemptAuth(() => deleteKeyAcrossConfigs(auth, headers, input)).pipe(
        Effect.as({ success: true }),
      ),

    verifyApiKey: (headers, input) =>
      attemptAuth(() => verifyKeyWithPermissionFallback(auth, headers, input)),
  });

const DEPLOY_KEY_PERMISSIONS = { bundles: ["write"] };
