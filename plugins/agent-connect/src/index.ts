import {
  createGrantCredential,
  createIdempotencyKey,
  DEFAULT_BASE_URL,
  type GenerateIntentResponse,
  type StatusResponse,
} from "@near-intents-agent-api/sdk";
import { ORPCError } from "@orpc/server";
import { Effect, Layer } from "effect";
import { createPlugin } from "every-plugin";
import { z } from "zod";
import { contract } from "./contract";
import { DatabaseLive } from "./db/layer";
import { ContextSchema } from "./lib/context";
import { AgentApiClient, type AgentApiClientShape, type AgentApiServiceError, agentApiClientLayer } from "./services/agent-api";
import { agentStoreLayer, AgentStore, type AgentStoreShape, type OwnerIntentRow } from "./services/store";
import { grantVaultLayer, GrantVault } from "./services/vault";

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
 * (better-near-auth's `signAgentIntent`) → submit (this plugin). The `naa_`
 * partner key and `ngt_` grant tokens never reach a browser.
 *
 * Idempotency: prepare routes accept an optional client idempotency key —
 * the same key with the same request returns the same intent (safe retry:
 * a stored response replays, otherwise the exact stored request body is
 * resent under the same key), and the same key with a different request
 * type conflicts. Upstream enforces body equality (`409 idempotency_conflict`).
 *
 * Submit and status polling share one reconciliation path, so a success
 * observed later applies the same local effects as an immediate one.
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
const LINK_FAILURE_MESSAGE =
  "Agent intent was created but could not be recorded — retry with the same idempotency key to reuse it";

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

/** The pieces of the generated intent the ledger stores and the UI needs. */
interface GeneratedIntent {
  correlation_id: string;
  agent_id?: string | null;
  status: string;
  expires_at: string;
}

type LedgerError = ORPCError<"INTERNAL_SERVER_ERROR", unknown>;

const CONFLICT_ERROR = (message: string) => new ORPCError("CONFLICT", { message });

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

    /**
     * Ledger link — fatal on failure: the caller retries with the same key
     * and lands on the reuse path.
     */
    const linkGenerated = (
      store: AgentStoreShape,
      idempotencyKey: string,
      generated: GenerateIntentResponse,
    ): Effect.Effect<GenerateIntentResponse, LedgerError> =>
      store
        .linkIntent({
          idempotencyKey,
          correlationId: generated.correlation_id,
          status: generated.status,
          expiresAt: new Date(generated.expires_at),
          agentId: generated.agent_id ?? null,
          response: generated,
        })
        .pipe(
          Effect.catch(() =>
            Effect.fail(new ORPCError("INTERNAL_SERVER_ERROR", { message: LINK_FAILURE_MESSAGE })),
          ),
          Effect.as(generated),
        );

    /**
     * The intent ledger, uniformly: reuse (stored response replays; otherwise
     * the exact stored request body is resent under the same key) or fresh
     * (record pending with the request → send → link).
     */
    const prepareWithLedger = (args: {
      store: AgentStoreShape;
      client: AgentApiClientShape;
      userId: string;
      intentType: "agent_create" | "grant_issue" | "grant_revoke";
      idempotencyKeyInput: string | undefined;
      buildFreshRequest: () => Effect.Effect<
        { request: unknown; grantRowId?: string },
        AgentApiServiceError | LedgerError | Error
      >;
    }): Effect.Effect<GenerateIntentResponse, AgentApiServiceError | LedgerError | Error> =>
      Effect.gen(function* () {
        const { store, client, userId } = args;
        const idempotencyKey = args.idempotencyKeyInput ?? createIdempotencyKey();

        const existing = yield* store.findIntentByKey(userId, idempotencyKey);
        if (existing) {
          if (existing.intentType !== args.intentType) {
            return yield* Effect.fail(
              CONFLICT_ERROR("Idempotency key was already used for a different request"),
            );
          }
          if (existing.response != null) {
            return existing.response as GenerateIntentResponse;
          }
          const regenerated = yield* client.generateIntent(existing.request as never, {
            idempotencyKey,
          });
          return yield* linkGenerated(store, idempotencyKey, regenerated);
        }

        const fresh = yield* args.buildFreshRequest();
        yield* store.insertPendingIntent({
          id: newId(),
          correlationId: `pending-${idempotencyKey}`,
          idempotencyKey,
          intentType: args.intentType,
          agentId: null,
          grantRowId: fresh.grantRowId ?? null,
          userId,
          request: fresh.request,
          expiresAt: new Date(Date.now() + PRE_SEND_TTL_MS),
        });

        const generated = yield* client.generateIntent(fresh.request as never, {
          idempotencyKey,
        });
        return yield* linkGenerated(store, idempotencyKey, generated);
      });

    /**
     * One reconciliation path for a settled intent — shared by submit and
     * status polling, so a success observed later applies the same local
     * effects as an immediate one. Ledger writes are best-effort.
     */
    const reconcileIntent = (
      store: AgentStoreShape,
      userId: string,
      intentRow: OwnerIntentRow,
      status: StatusResponse,
    ): Effect.Effect<void> => {
      const update = store
        .updateIntentStatus(intentRow.correlationId, status.status)
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("[agent-connect] failed to update intent status:", error).pipe(
              Effect.asVoid,
            ),
          ),
        );

      if (status.status !== "SUCCESS") {
        return update;
      }

      const settled = Effect.gen(function* () {
        const details = status.details as { grant?: { grant_id?: string } | null } | undefined;
        if (intentRow.intentType === "grant_issue" && intentRow.grantRowId) {
          const issuedGrantId = details?.grant?.grant_id;
          if (issuedGrantId) {
            yield* store
              .linkGrantId(intentRow.grantRowId, issuedGrantId)
              .pipe(
                Effect.catch((error) =>
                  Effect.logWarning("[agent-connect] failed to link grant row:", error).pipe(
                    Effect.asVoid,
                  ),
                ),
              );
          }
        }
        if (intentRow.intentType === "grant_revoke" && intentRow.grantRowId) {
          yield* store.markGrantRevoked(intentRow.grantRowId).pipe(
            Effect.catch((error) =>
              Effect.logWarning("[agent-connect] failed to mark grant revoked:", error).pipe(
                Effect.asVoid,
              ),
            ),
          );
        }
        if (intentRow.intentType === "agent_create" && intentRow.agentId) {
          yield* store.activateAgent(userId, intentRow.agentId).pipe(
            Effect.catch((error) =>
              Effect.logWarning("[agent-connect] failed to activate agent row:", error).pipe(
                Effect.asVoid,
              ),
            ),
          );
        }
      });

      return Effect.asVoid(Effect.flatMap(update, () => settled));
    };

    return {
      agentCreate: builder.agentCreate.effect(function* ({ input, context, errors }) {
        const userId = requireUser(context.userId);
        const owner = deriveOwner(context.near);
        const client = yield* AgentApiClient;
        const store = yield* AgentStore;

        const generated = yield* prepareWithLedger({
          store,
          client,
          userId,
          intentType: "agent_create",
          idempotencyKeyInput: input.idempotencyKey,
          buildFreshRequest: () =>
            Effect.succeed({
              request: {
                type: "agent_create",
                name: input.name,
                external_user_id: userId,
                owner,
                policy: input.policy,
              },
            }),
        });

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

        if (input.type === "grant_issue" || input.type === "grant_revoke") {
          const owned = yield* store.findAgentByUser(userId, input.agentId);
          if (!owned) {
            return yield* Effect.fail(
              errors.NOT_FOUND({ message: "Agent not found for this user" }),
            );
          }
        }

        return yield* prepareWithLedger({
          store,
          client,
          userId,
          intentType: input.type,
          idempotencyKeyInput: input.idempotencyKey,
          buildFreshRequest: () => {
            if (input.type === "grant_issue") {
              const requestedExpiry = input.expiresAt ? Date.parse(input.expiresAt) : Number.NaN;
              const resolvedExpiryMs = Number.isNaN(requestedExpiry)
                ? Date.now() + DEFAULT_GRANT_TTL_MS
                : Math.min(requestedExpiry, Date.now() + MAX_GRANT_TTL_MS);

              return Effect.gen(function* () {
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
                return {
                  request: {
                    type: "grant_issue",
                    agent_id: input.agentId,
                    label: input.label,
                    credential: commitment,
                    expires_at: new Date(resolvedExpiryMs).toISOString(),
                  },
                  grantRowId: grantRow.id,
                };
              });
            }
            if (input.type === "grant_revoke") {
              return Effect.succeed({
                request: {
                  type: "grant_revoke",
                  agent_id: input.agentId,
                  grant_id: input.grantId,
                },
              });
            }
            return Effect.fail(
              new ORPCError("BAD_REQUEST", { message: "Unsupported intent type" }),
            );
          },
        });
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

        yield* reconcileIntent(store, userId, intentRow, status);

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

        yield* reconcileIntent(store, userId, intentRow, status);

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
