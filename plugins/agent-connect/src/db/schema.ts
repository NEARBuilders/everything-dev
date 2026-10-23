import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Agent Connect control-plane tables (own plugin schema, `plugin_agent_connect`).
 *
 * `user_id` is the Better Auth user id resolved from the request context
 * server-side — never trusted from client input; no FK (the user table lives
 * in the auth plugin's database).
 */

export const agentAccount = pgTable(
  "agent_account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    agentId: text("agent_id").notNull(),
    name: text("name").notNull(),
    ownerType: text("owner_type").notNull(),
    ownerAccountId: text("owner_account_id"),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agentAccount_agentId_uidx").on(table.agentId),
    index("agentAccount_userId_idx").on(table.userId),
  ],
);

export const ownerIntent = pgTable(
  "owner_intent",
  {
    id: text("id").primaryKey(),
    correlationId: text("correlation_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    intentType: text("intent_type").notNull(),
    agentId: text("agent_id"),
    grantRowId: text("grant_row_id"),
    userId: text("user_id").notNull(),
    status: text("status").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    request: jsonb("request").$type<unknown>(),
    response: jsonb("response").$type<unknown>(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ownerIntent_correlationId_uidx").on(table.correlationId),
    uniqueIndex("ownerIntent_idempotencyKey_uidx").on(table.idempotencyKey),
    index("ownerIntent_userId_idx").on(table.userId),
  ],
);

export const agentGrant = pgTable(
  "agent_grant",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    agentId: text("agent_id").notNull(),
    grantId: text("grant_id"),
    correlationId: text("correlation_id"),
    label: text("label").notNull(),
    tokenCiphertext: text("token_ciphertext").notNull(),
    tokenIv: text("token_iv").notNull(),
    commitment: text("commitment").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("agentGrant_agentId_idx").on(table.agentId),
    index("agentGrant_userId_idx").on(table.userId),
    index("agentGrant_commitment_idx").on(table.commitment),
  ],
);
