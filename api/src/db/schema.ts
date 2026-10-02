import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const tenantStatus = pgEnum("tenant_status", [
  "active",
  "pending",
  "suspended",
  "pending_deletion",
]);

export const validatorRole = pgEnum("validator_role", ["official", "community"]);

export interface NodeMetadata {
  kind?: string;
  poolAccountId?: string;
  bulletin?: string;
  [key: string]: unknown;
}

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: text("account_id").notNull().unique(),
  orgId: text("org_id"),
  ownerUserId: text("owner_user_id"),
  name: text("name").notNull(),
  status: tenantStatus("status").default("active").notNull(),
  ownerKind: text("owner_kind").default("platform").notNull(),
  allowUiOverrides: boolean("allow_ui_overrides").default(true).notNull(),
  allowBackendOverrides: boolean("allow_backend_overrides").default(false).notNull(),
  allowSsr: boolean("allow_ssr").default(false).notNull(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
});

export const nodes = pgTable(
  "nodes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => nodes.id, { onDelete: "set null" }),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    metadata: jsonb("metadata").$type<NodeMetadata>().default({}).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    parentSlugIdx: uniqueIndex("nodes_parent_slug_idx")
      .on(table.parentId, table.slug)
      .where(sql`parent_id IS NOT NULL`),
    rootSlugIdx: uniqueIndex("nodes_root_slug_idx").on(table.slug).where(sql`parent_id IS NULL`),
    parentIdx: index("nodes_parent_idx").on(table.parentId),
    tenantIdx: index("nodes_tenant_idx").on(table.tenantId),
  }),
);

export const validators = pgTable(
  "validators",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    network: text("network").default("mainnet").notNull(),
    protocol: text("protocol").default("near").notNull(),
    role: validatorRole("role").default("official").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    nodeIdx: index("validators_node_idx").on(table.nodeId),
    oneDefaultPerNodeIdx: uniqueIndex("validators_one_default_per_node_idx")
      .on(table.nodeId)
      .where(sql`is_default = true`),
  }),
);

export const domainBindings = pgTable(
  "domain_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull().unique(),
    isPrimary: boolean("is_primary").default(false).notNull(),
    isVerified: boolean("is_verified").default(false).notNull(),
    verificationToken: text("verification_token").notNull(),
    verifiedAt: timestamp("verified_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index("domain_bindings_tenant_idx").on(table.tenantId),
    onePrimaryPerTenantIdx: uniqueIndex("domain_bindings_one_primary_per_tenant_idx")
      .on(table.tenantId)
      .where(sql`is_primary = true`),
  }),
);

export const discoveryProfiles = pgTable("discovery_profiles", {
  nodeId: uuid("node_id")
    .primaryKey()
    .references(() => nodes.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<import("../discovery-contract").DiscoveryProfile>().notNull(),
});

export const discoveryHistory = pgTable("discovery_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  nodeId: uuid("node_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  targetId: text("target_id").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
});

export const discoveryActivities = pgTable(
  "discovery_activities",
  {
    id: uuid("id").primaryKey(),
    ownerNodeId: uuid("owner_node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    canonicalUrl: text("canonical_url").notNull(),
    data: jsonb("data").$type<import("../discovery-contract").DiscoveryActivity>().notNull(),
  },
  (table) => ({
    manualUrl: uniqueIndex("discovery_manual_url")
      .on(table.canonicalUrl)
      .where(sql`${table.data}->'luma' IS NULL`),
    lumaNodeUrl: uniqueIndex("discovery_luma_node_url")
      .on(table.ownerNodeId, table.canonicalUrl)
      .where(sql`${table.data}->'luma' IS NOT NULL`),
  }),
);

export const discoveryCurators = pgTable("discovery_curators", {
  userId: text("user_id").primaryKey(),
});
export const discoveryFeatures = pgTable("discovery_features", {
  nodeId: uuid("node_id")
    .primaryKey()
    .references(() => nodes.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const discoveryReports = pgTable(
  "discovery_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    targetId: uuid("target_id").notNull(),
    kind: text("kind").$type<"profile" | "activity">().notNull(),
    reason: text("reason").notNull(),
    note: text("note").default("").notNull(),
    resolved: boolean("resolved").default(false).notNull(),
    token: uuid("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ tokenTarget: uniqueIndex("discovery_report_token_target").on(t.token, t.targetId) }),
);

export const discoveryMeasurements = pgTable(
  "discovery_measurements",
  {
    key: text("key").primaryKey(),
    visitId: uuid("visit_id").notNull(),
    nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "cascade" }),
    campaign: text("campaign").notNull(),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    visitIdx: index("discovery_measurement_visit").on(t.visitId),
    timeIdx: index("discovery_measurement_time").on(t.createdAt),
  }),
);

export const discoveryLumaConnections = pgTable("discovery_luma_connections", {
  nodeId: uuid("node_id")
    .primaryKey()
    .references(() => nodes.id, { onDelete: "cascade" }),
  calendarId: text("calendar_id").notNull(),
  calendarName: text("calendar_name").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
  error: text("error"),
});
