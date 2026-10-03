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

// Tenant-scoped table convention (interim, row-level isolation):
//
// If your plugin stores data that belongs to a specific tenant deployment
// (not just a user or org), add a `tenantId` column and filter every query
// by it. Resolve the tenant via the API plugin's public lookup routes
// (`pluginsClient.api.resolveTenantByOrgId` / `resolveTenant`) and never
// trust a tenantId passed directly from client input.
//
// export const reports = pgTable("reports", {
//   id: uuid("id").defaultRandom().primaryKey(),
//   tenantId: text("tenant_id").notNull(),   // resolved server-side, always filtered
//   title: text("title").notNull(),
//   createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
// }, (table) => [index("reports_tenant_id_idx").on(table.tenantId)]);
//
// See the api-and-auth skill's "Tenant-Scoped Data" section for the full
// middleware pattern and the forward path to per-tenant schema isolation.
