import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const things = pgTable(
  "things",
  {
    thingId: text("thing_id").primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().$type<unknown>(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("things_type_idx").on(table.type)],
);