import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const examples = pgTable("examples", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Secrets vault (plan 055 ticket 09): sealed values keyed by runtime identity
 * + secret name. `sealedValue` is a createSealedBox ciphertext
 * (`base64url(iv).base64url(ciphertext)`) under the runtime's KEK — derived
 * from the platform root secret with a runtime-scoped salt. Values are never
 * stored in plaintext and never echoed back after set.
 */
export const runtimeSecrets = pgTable(
  "runtime_secrets",
  {
    account: text("account").notNull(),
    gateway: text("gateway").notNull(),
    name: text("name").notNull(),
    sealedValue: text("sealed_value").notNull(),
    setBy: text("set_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [unique("runtime_secrets_runtime_name_key").on(t.account, t.gateway, t.name)],
);
