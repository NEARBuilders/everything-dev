import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const upvotes = pgTable(
  "upvotes",
  {
    id: text("id").primaryKey(),
    entityId: text("thing_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("upvotes_thing_user_unique").on(table.entityId, table.userId)],
);
