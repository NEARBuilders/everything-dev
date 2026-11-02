import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DatabaseTag } from "../db/layer";
import { agentAccount, agentGrant, ownerIntent } from "../db/schema";

/**
 * Control-plane store over the plugin's own schema. Every query that reads a
 * user-owned row scopes by `userId` — the ownership invariant lives here, in
 * the query, not in the caller.
 */

export type StoreError = ORPCError<
  "NOT_FOUND" | "CONFLICT" | "INTERNAL_SERVER_ERROR",
  { message: string }
>;

export interface AgentAccountRow {
  id: string;
  userId: string;
  agentId: string;
  name: string;
  ownerType: string;
  ownerAccountId: string | null;
  status: string;
  createdAt: Date;
}

export interface OwnerIntentRow {
  id: string;
  correlationId: string;
  idempotencyKey: string;
  intentType: string;
  agentId: string | null;
  grantRowId: string | null;
  userId: string;
  status: string;
  expiresAt: Date;
  request: unknown;
  response: unknown;
  createdAt: Date;
}

export interface AgentGrantRow {
  id: string;
  userId: string;
  agentId: string;
  grantId: string | null;
  correlationId: string | null;
  label: string;
  tokenCiphertext: string;
  tokenIv: string;
  commitment: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

const storeError = (message: string, cause: unknown): StoreError =>
  new ORPCError("INTERNAL_SERVER_ERROR", { message, data: { message } });

export class AgentStore extends Context.Service<AgentStore, AgentStoreShape>()(
  "agent-connect/AgentStore",
) {}

export interface AgentStoreShape {
  createAgentAccount(input: {
    id: string;
    userId: string;
    agentId: string;
    name: string;
    ownerType: string;
    ownerAccountId: string | null;
    status: string;
  }): Effect.Effect<AgentAccountRow, StoreError>;
  findAgentByUser(
    userId: string,
    agentId: string,
  ): Effect.Effect<AgentAccountRow | null, StoreError>;
  activateAgent(userId: string, agentId: string): Effect.Effect<void, StoreError>;
  insertPendingIntent(input: {
    id: string;
    correlationId: string;
    idempotencyKey: string;
    intentType: string;
    agentId: string | null;
    grantRowId: string | null;
    userId: string;
    request: unknown;
    expiresAt: Date;
  }): Effect.Effect<OwnerIntentRow, StoreError>;
  linkIntent(input: {
    idempotencyKey: string;
    correlationId: string;
    status: string;
    expiresAt: Date;
    agentId?: string | null;
    response?: unknown;
  }): Effect.Effect<void, StoreError>;
  findIntentByUser(
    userId: string,
    correlationId: string,
  ): Effect.Effect<OwnerIntentRow | null, StoreError>;
  findIntentByKey(
    userId: string,
    idempotencyKey: string,
  ): Effect.Effect<OwnerIntentRow | null, StoreError>;
  updateIntentStatus(correlationId: string, status: string): Effect.Effect<void, StoreError>;
  insertGrantRow(input: {
    id: string;
    userId: string;
    agentId: string;
    label: string;
    tokenCiphertext: string;
    tokenIv: string;
    commitment: string;
    expiresAt: Date;
  }): Effect.Effect<AgentGrantRow, StoreError>;
  linkGrantId(rowId: string, grantId: string): Effect.Effect<void, StoreError>;
  markGrantRevoked(rowId: string): Effect.Effect<void, StoreError>;
  findGrantById(rowId: string): Effect.Effect<AgentGrantRow | null, StoreError>;
  findGrantByUser(
    userId: string,
    agentId: string,
    grantId: string,
  ): Effect.Effect<AgentGrantRow | null, StoreError>;
}

export const agentStoreLayer = Layer.effect(
  AgentStore,
  Effect.gen(function* () {
    const db = yield* DatabaseTag;

    const store: AgentStoreShape = {
      createAgentAccount: (input) =>
        Effect.tryPromise({
          try: async () => {
            const [row] = await db.insert(agentAccount).values(input).returning();
            return row!;
          },
          catch: (cause) => storeError("Failed to persist agent account", cause),
        }),
      findAgentByUser: (userId, agentId) =>
        Effect.tryPromise({
          try: async () =>
            (await db
              .select()
              .from(agentAccount)
              .where(and(eq(agentAccount.agentId, agentId), eq(agentAccount.userId, userId)))
              .limit(1)
              .then((rows) => rows[0] ?? null)) as AgentAccountRow | null,
          catch: (cause) => storeError("Failed to load agent account", cause),
        }),
      activateAgent: (userId, agentId) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .update(agentAccount)
              .set({ status: "ACTIVE" })
              .where(and(eq(agentAccount.agentId, agentId), eq(agentAccount.userId, userId)));
          },
          catch: (cause) => storeError("Failed to activate agent account", cause),
        }),
      insertPendingIntent: (input) =>
        Effect.tryPromise({
          try: async () => {
            const [row] = await db
              .insert(ownerIntent)
              .values({ ...input, status: "PENDING_SIGNATURE" })
              .returning();
            return row!;
          },
          catch: (cause) => storeError("Failed to record pending intent", cause),
        }),
      linkIntent: ({ idempotencyKey, correlationId, status, expiresAt, agentId, response }) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .update(ownerIntent)
              .set({
                correlationId,
                status,
                expiresAt,
                ...(agentId !== undefined ? { agentId } : {}),
                ...(response !== undefined ? { response } : {}),
              })
              .where(eq(ownerIntent.idempotencyKey, idempotencyKey));
          },
          catch: (cause) => storeError("Failed to link the generated intent to the ledger", cause),
        }),
      findIntentByUser: (userId, correlationId) =>
        Effect.tryPromise({
          try: async () =>
            (await db
              .select()
              .from(ownerIntent)
              .where(
                and(eq(ownerIntent.correlationId, correlationId), eq(ownerIntent.userId, userId)),
              )
              .limit(1)
              .then((rows) => rows[0] ?? null)) as OwnerIntentRow | null,
          catch: (cause) => storeError("Failed to load intent", cause),
        }),
      findIntentByKey: (userId, idempotencyKey) =>
        Effect.tryPromise({
          try: async () =>
            (await db
              .select()
              .from(ownerIntent)
              .where(
                and(eq(ownerIntent.idempotencyKey, idempotencyKey), eq(ownerIntent.userId, userId)),
              )
              .limit(1)
              .then((rows) => rows[0] ?? null)) as OwnerIntentRow | null,
          catch: (cause) => storeError("Failed to load intent by idempotency key", cause),
        }),
      updateIntentStatus: (correlationId, status) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .update(ownerIntent)
              .set({ status })
              .where(eq(ownerIntent.correlationId, correlationId));
          },
          catch: (cause) => storeError("Failed to update intent status", cause),
        }),
      insertGrantRow: (input) =>
        Effect.tryPromise({
          try: async () => {
            const [row] = await db.insert(agentGrant).values(input).returning();
            return row!;
          },
          catch: (cause) => storeError("Failed to persist grant", cause),
        }),
      linkGrantId: (rowId, grantId) =>
        Effect.tryPromise({
          try: async () => {
            await db.update(agentGrant).set({ grantId }).where(eq(agentGrant.id, rowId));
          },
          catch: (cause) => storeError("Failed to link grant", cause),
        }),
      markGrantRevoked: (rowId) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .update(agentGrant)
              .set({ revokedAt: new Date() })
              .where(eq(agentGrant.id, rowId));
          },
          catch: (cause) => storeError("Failed to mark grant revoked", cause),
        }),
      findGrantById: (rowId) =>
        Effect.tryPromise({
          try: async () =>
            (await db
              .select()
              .from(agentGrant)
              .where(eq(agentGrant.id, rowId))
              .limit(1)
              .then((rows) => rows[0] ?? null)) as AgentGrantRow | null,
          catch: (cause) => storeError("Failed to load grant", cause),
        }),
      findGrantByUser: (userId, agentId, grantId) =>
        Effect.tryPromise({
          try: async () =>
            (await db
              .select()
              .from(agentGrant)
              .where(
                and(
                  eq(agentGrant.agentId, agentId),
                  eq(agentGrant.grantId, grantId),
                  eq(agentGrant.userId, userId),
                ),
              )
              .limit(1)
              .then((rows) => rows[0] ?? null)) as AgentGrantRow | null,
          catch: (cause) => storeError("Failed to load grant", cause),
        }),
    };

    return store;
  }),
);
