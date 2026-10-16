import {
  createGrantCredential,
  createIdempotencyKey,
  DEFAULT_BASE_URL,
} from "@near-intents-agent-api/sdk";
import { ORPCError } from "@orpc/server";
import { Effect, Layer } from "effect";
import { createPlugin } from "every-plugin";
import { z } from "zod";
import { contract } from "./contract";
import { DatabaseLive } from "./db/layer";
import { ContextSchema } from "./lib/context";
import {
  AgentApiClient,
  type AgentApiServiceError,
  agentApiClientLayer,
} from "./services/agent-api";
import { AgentStore, agentStoreLayer } from "./services/store";
import { GrantVault, grantVaultLayer } from "./services/vault";

/**
 * Agent Connect — the control plane giving every signed-in user an
 * owner-controlled agent account on the NEAR Intents Agent API.
 *
 * Layering: `@near-intents-agent-api/sdk` is the only protocol dependency;
 * this plugin adds only platform concerns — session ownership, the sealed
 * grant-token vault, the pre-send intent ledger, and the oRPC surface
 * (REST + MCP via the host's OpenAPI mounts).
 *
 * Owner intents follow the BFF split: prepare (this plugin, returns
 * `intent.payload` + preview) → the browser signs with the connected wallet
 * (better-near-auth's `agentConnectClient`) → submit (this plugin). The
 * `naa_` partner key and `ngt_` grant tokens never reach a browser.
 *
 * Owner derivation reads the request context (`context.near`) — the primary
 * linked NEAR account. Passkey-only owners are a tracked follow-up.
 *
 * The plugin is dormant until `NEAR_INTENTS_AGENT_API_KEY` is configured:
 * routes exist but fail with a clear "not configured" error.
 */

const PRE_SEND_TTL_MS = 15 * 60 * 1000;
const DEFAULT_GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_GRANT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

const NOT_CONFIGURED: AgentApiServiceError = new ORPCError("SERVICE_UNAVAILABLE", {
  message: "Agent Connect is not configured — set NEAR_INTENTS_AGENT_API_KEY",
  data: { message: "Agent Connect is not configured — set NEAR_INTENTS_AGENT_API_KEY" },
});

const dormantClientLayer = Layer.succeed(AgentApiClient, {
  generateIntent: () => Effect.fail(NOT_CONFIGURED),
  submitIntent: () => Effect.fail(NOT_CONFIGURED),
  getStatus: () => Effect.fail(NOT_CONFIGURED),
  listAgents: () => Effect.fail(NOT_CONFIGURED),
  getAgent: () => Effect.fail(NOT_CONFIGURED),
  listGrants: () => Effect.fail(NOT_CONFIGURED),
});

const newId = (): string => crypto.randomUUID();

export default createPlugin({
  variables: z.object({
    apiBaseUrl: z.string().default(DEFAULT_BASE_URL).describe("Hosted Agent API origin"),
    apiTimeoutMs: z.number().min(1000).max(60_000).optional().describe("Agent API request timeout"),
  }),

  secrets: z.object({
    NEAR_INTENTS_AGENT_API_KEY: z
      .string()
      .optional()
      .describe(
        "Partner API key (naa_…) from the partner dashboard; the plugin stays dormant without it",
      ),
    AGENT_CONNECT_ENCRYPTION_KEY: z
      .string()
      .min(32)
      .optional()
      .describe(
        "Grant-token vault key (32+ bytes). Falls back to a key derived from NEAR_INTENTS_AGENT_API_KEY when absent — set a dedicated key in production.",
      ),
    AGENT_CONNECT_DATABASE_URL: z
      .string()
      .default("pglite:.bos/agent-connect/:memory:")
      .describe("Database connection string. Use pglite: for local, postgres:// for production."),
  }),

  context: ContextSchema,

  contract,

  initialize: (config) =>
    Effect.gen(function* () {
      const apiKey = config.secrets.NEAR_INTENTS_AGENT_API_KEY;

      const vaultSecret =
        config.secrets.AGENT_CONNECT_ENCRYPTION_KEY ??
        (apiKey
          ? yield* Effect.logWarning(
              "[agent-connect] AGENT_CONNECT_ENCRYPTION_KEY not set — deriving the grant vault key from NEAR_INTENTS_AGENT_API_KEY; set a dedicated key in production",
            ).pipe(Effect.as(apiKey))
          : "agent-connect-dormant");

      const clientLayer = apiKey
        ? agentApiClientLayer({
            apiKey,
            baseUrl: config.variables.apiBaseUrl,
            timeoutMs: config.variables.apiTimeoutMs,
          })
        : dormantClientLayer;

      return Layer.mergeAll(
        clientLayer,
        grantVaultLayer(vaultSecret),
        agentStoreLayer.pipe(
          Layer.provide(DatabaseLive(config.secrets.AGENT_CONNECT_DATABASE_URL)),
        ),
      );
    }),

  createRouter: (builder) => {
    const requireUser = (userId: string | null | undefined): string => {
      if (!userId) {
        throw new ORPCError("UNAUTHORIZED", { message: "Authentication required" });
      }
      return userId;
    };

    const deriveOwner = (
      near:
        | {
            primaryAccountId: string | null;
            linkedAccounts: Array<{ accountId: string; publicKey: string }>;
          }
        | null
        | undefined,
    ): { type: "near"; account_id: string; public_key: string } => {
      const primary = near?.primaryAccountId
        ? near.linkedAccounts.find((account) => account.accountId === near.primaryAccountId)
        : undefined;
      if (!primary) {
        throw new ORPCError("BAD_REQUEST", {
          message: "No owner wallet available — link a NEAR account first",
        });
      }
      return { type: "near", account_id: primary.accountId, public_key: primary.publicKey };
    };

    return {
      agentCreate: builder.agentCreate.effect(function* ({ input, context, errors }) {
        const userId = requireUser(context.userId);
        const owner = deriveOwner(context.near);
        const client = yield* AgentApiClient;
        const store = yield* AgentStore;

        const idempotencyKey = createIdempotencyKey();
        yield* store.insertPendingIntent({
          id: newId(),
          correlationId: `pending-${idempotencyKey}`,
          idempotencyKey,
          intentType: "agent_create",
          agentId: null,
          grantRowId: null,
          userId,
          expiresAt: new Date(Date.now() + PRE_SEND_TTL_MS),
        });

        const generated = yield* client.generateIntent(
          {
            type: "agent_create",
            name: input.name,
            external_user_id: userId,
            owner,
            policy: input.policy as never,
          },
          { idempotencyKey },
        );

        yield* store
          .linkIntent({
            idempotencyKey,
            correlationId: generated.correlation_id,
            status: generated.status,
            expiresAt: new Date(generated.expires_at),
          })
          .pipe(
            Effect.catch(() =>
              Effect.fail(
                errors.INTERNAL_SERVER_ERROR({
                  message: "Agent intent was created but could not be recorded — retry to reuse it",
                }),
              ),
            ),
          );

        yield* store
          .createAgentAccount({
            id: newId(),
            userId,
            agentId: generated.agent_id,
            name: input.name,
            ownerType: owner.type,
            ownerAccountId: owner.account_id,
            status: "PENDING",
          })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("[agent-connect] failed to persist agent state:", error),
            ),
          );

        return generated;
      }),

      agentList: builder.agentList.effect(function* ({ context }) {
        const userId = requireUser(context.userId);
        const client = yield* AgentApiClient;
        return yield* client.listAgents(userId);
      }),

      agentGet: builder.agentGet.effect(function* ({ input, context, errors }) {
        const userId = requireUser(context.userId);
        const client = yield* AgentApiClient;
        const store = yield* AgentStore;

        const owned = yield* store.findAgentByUser(userId, input.agentId);
        if (!owned) {
          return yield* Effect.fail(errors.NOT_FOUND({ message: "Agent not found for this user" }));
        }
        return yield* client.getAgent(input.agentId);
      }),
      prepareIntent: builder.prepareIntent.effect(function* ({ input, context, errors }) {
        const userId = requireUser(context.userId);
        const client = yield* AgentApiClient;
        const store = yield* AgentStore;
        const vault = yield* GrantVault;

        if (input.type === "agent_create") {
          const owner = deriveOwner(context.near);
          const idempotencyKey = createIdempotencyKey();
          yield* store.insertPendingIntent({
            id: newId(),
            correlationId: `pending-${idempotencyKey}`,
            idempotencyKey,
            intentType: "agent_create",
            agentId: null,
            grantRowId: null,
            userId,
            expiresAt: new Date(Date.now() + PRE_SEND_TTL_MS),
          });

          const generated = yield* client.generateIntent(
            {
              type: "agent_create",
              name: input.name,
              external_user_id: userId,
              owner,
              policy: input.policy as never,
            },
            { idempotencyKey },
          );

          yield* store
            .linkIntent({
              idempotencyKey,
              correlationId: generated.correlation_id,
              status: generated.status,
              expiresAt: new Date(generated.expires_at),
            })
            .pipe(
              Effect.catch(() =>
                Effect.fail(
                  errors.INTERNAL_SERVER_ERROR({
                    message:
                      "Agent intent was created but could not be recorded — retry to reuse it",
                  }),
                ),
              ),
            );

          yield* store
            .createAgentAccount({
              id: newId(),
              userId,
              agentId: generated.agent_id,
              name: input.name,
              ownerType: owner.type,
              ownerAccountId: owner.account_id,
              status: "PENDING",
            })
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning("[agent-connect] failed to persist agent state:", error),
              ),
            );

          return generated;
        }

        if (input.type === "grant_issue") {
          const owned = yield* store.findAgentByUser(userId, input.agentId);
          if (!owned) {
            return yield* Effect.fail(
              errors.NOT_FOUND({ message: "Agent not found for this user" }),
            );
          }

          const requestedExpiry = input.expiresAt ? Date.parse(input.expiresAt) : Number.NaN;
          if (input.expiresAt && Number.isNaN(requestedExpiry)) {
            return yield* Effect.fail(
              errors.BAD_REQUEST({ message: "expiresAt must be an ISO datetime" }),
            );
          }
          const resolvedExpiryMs = Number.isNaN(requestedExpiry)
            ? Date.now() + DEFAULT_GRANT_TTL_MS
            : Math.min(requestedExpiry, Date.now() + MAX_GRANT_TTL_MS);

          const { token, commitment } = createGrantCredential();
          const sealed = yield* vault.seal(token);
          const grantRow = yield* store.insertGrantRow({
            id: newId(),
            userId,
            agentId: input.agentId,
            label: input.label,
            tokenCiphertext: sealed.ciphertext,
            tokenIv: sealed.iv,
            commitment,
            expiresAt: new Date(resolvedExpiryMs),
          });

          const idempotencyKey = createIdempotencyKey();
          yield* store.insertPendingIntent({
            id: newId(),
            correlationId: `pending-${idempotencyKey}`,
            idempotencyKey,
            intentType: "grant_issue",
            agentId: input.agentId,
            grantRowId: grantRow.id,
            userId,
            expiresAt: new Date(Date.now() + PRE_SEND_TTL_MS),
          });

          const generated = yield* client.generateIntent(
            {
              type: "grant_issue",
              agent_id: input.agentId,
              label: input.label,
              credential: commitment,
              expires_at: new Date(resolvedExpiryMs).toISOString(),
            },
            { idempotencyKey },
          );

          yield* store
            .linkIntent({
              idempotencyKey,
              correlationId: generated.correlation_id,
              status: generated.status,
              expiresAt: new Date(generated.expires_at),
            })
            .pipe(
              Effect.catch(() =>
                Effect.fail(
                  errors.INTERNAL_SERVER_ERROR({
                    message:
                      "Agent intent was created but could not be recorded — retry to reuse it",
                  }),
                ),
              ),
            );

          return generated;
        }

        const owned = yield* store.findAgentByUser(userId, input.agentId);
        if (!owned) {
          return yield* Effect.fail(errors.NOT_FOUND({ message: "Agent not found for this user" }));
        }
        const grantRow = yield* store.findGrantByUser(userId, input.agentId, input.grantId);
        if (!grantRow) {
          return yield* Effect.fail(errors.NOT_FOUND({ message: "Grant not found for this user" }));
        }

        const idempotencyKey = createIdempotencyKey();
        yield* store.insertPendingIntent({
          id: newId(),
          correlationId: `pending-${idempotencyKey}`,
          idempotencyKey,
          intentType: "grant_revoke",
          agentId: input.agentId,
          grantRowId: grantRow.id,
          userId,
          expiresAt: new Date(Date.now() + PRE_SEND_TTL_MS),
        });

        const generated = yield* client.generateIntent(
          {
            type: "grant_revoke",
            agent_id: input.agentId,
            grant_id: input.grantId,
          },
          { idempotencyKey },
        );

        yield* store
          .linkIntent({
            idempotencyKey,
            correlationId: generated.correlation_id,
            status: generated.status,
            expiresAt: new Date(generated.expires_at),
          })
          .pipe(
            Effect.catch(() =>
              Effect.fail(
                errors.INTERNAL_SERVER_ERROR({
                  message: "Agent intent was created but could not be recorded — retry to reuse it",
                }),
              ),
            ),
          );

        return generated;
      }),

      intentSubmit: builder.intentSubmit.effect(function* ({ input, context, errors }) {
        const userId = requireUser(context.userId);
        const client = yield* AgentApiClient;
        const store = yield* AgentStore;

        const intentRow = yield* store.findIntentByUser(userId, input.correlationId);
        if (!intentRow) {
          return yield* Effect.fail(errors.NOT_FOUND({ message: "Unknown correlation id" }));
        }
        if (intentRow.intentType !== input.type) {
          return yield* Effect.fail(
            errors.BAD_REQUEST({ message: "Intent type does not match the issued correlation id" }),
          );
        }

        const status = yield* client.submitIntent({
          type: input.type,
          correlation_id: input.correlationId,
          signed_data: input.signedData as never,
        });

        yield* store
          .updateIntentStatus(input.correlationId, status.status)
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("[agent-connect] failed to update intent status:", error),
            ),
          );

        if (status.status === "SUCCESS" && intentRow.grantRowId) {
          if (input.type === "grant_issue") {
            const details = status.details as { grant?: { grant_id?: string } | null } | undefined;
            const issuedGrantId = details?.grant?.grant_id;
            if (issuedGrantId) {
              yield* store
                .linkGrantId(intentRow.grantRowId, issuedGrantId)
                .pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("[agent-connect] failed to link grant row:", error),
                  ),
                );
            }
          }
          if (input.type === "grant_revoke") {
            yield* store
              .markGrantRevoked(intentRow.grantRowId)
              .pipe(
                Effect.catch((error) =>
                  Effect.logWarning("[agent-connect] failed to mark grant revoked:", error),
                ),
              );
          }
        }

        if (status.status === "SUCCESS" && input.type === "agent_create" && intentRow.agentId) {
          yield* store
            .activateAgent(userId, intentRow.agentId)
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning("[agent-connect] failed to activate agent row:", error),
              ),
            );
        }

        return status;
      }),

      intentStatus: builder.intentStatus.effect(function* ({ input, context, errors }) {
        const userId = requireUser(context.userId);
        const client = yield* AgentApiClient;
        const store = yield* AgentStore;

        const intentRow = yield* store.findIntentByUser(userId, input.correlationId);
        if (!intentRow) {
          return yield* Effect.fail(errors.NOT_FOUND({ message: "Unknown correlation id" }));
        }

        const status = yield* client.getStatus(input.correlationId, input.waitMs);

        yield* store
          .updateIntentStatus(input.correlationId, status.status)
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("[agent-connect] failed to update intent status:", error),
            ),
          );

        return status;
      }),

      grantList: builder.grantList.effect(function* ({ input, context, errors }) {
        const userId = requireUser(context.userId);
        const client = yield* AgentApiClient;
        const store = yield* AgentStore;

        const owned = yield* store.findAgentByUser(userId, input.agentId);
        if (!owned) {
          return yield* Effect.fail(errors.NOT_FOUND({ message: "Agent not found for this user" }));
        }
        const grants = yield* client.listGrants(input.agentId);
        return { data: grants };
      }),
    };
  },
});
