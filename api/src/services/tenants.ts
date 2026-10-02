import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray, not, notLike, or } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";
import { DatabaseTag } from "../db/layer";
import {
  domainBindings as domainBindingsTable,
  nodes as nodesTable,
  type tenantStatus,
  tenants as tenantsTable,
  validators as validatorsTable,
} from "../db/schema";
import { isUniqueViolation, toOrpcError } from "../lib/errors";
import { nodeKindOf } from "./nodes";

export type TenantStatus = (typeof tenantStatus)["enumValues"][number];

export type TenantOwnerKind = "platform" | "dao" | "user";

export type TenantEffect<T> = Effect.Effect<T, ORPCError<string, unknown>>;

export interface TenantRecord {
  id: string;
  accountId: string;
  orgId: string | null;
  ownerUserId: string | null;
  name: string;
  status: TenantStatus;
  ownerKind: TenantOwnerKind;
  allowUiOverrides: boolean;
  allowBackendOverrides: boolean;
  allowSsr: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TenantBinding {
  hostname: string;
  tenantId: string;
  accountId: string;
  allowUiOverrides: boolean;
  allowBackendOverrides: boolean;
  allowSsr: boolean;
  status: TenantStatus;
}

export interface TenantBindingRecord {
  id: string;
  tenantId: string;
  hostname: string;
  isPrimary: boolean;
  isVerified: boolean;
  verificationToken: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantAppRecord {
  accountId: string;
  name: string;
  status: TenantStatus;
  ownerKind: TenantOwnerKind;
  hostname: string | null;
  node: { id: string; slug: string; kind: string | null; name: string } | null;
  createdAt: string;
}

export interface TenantInput {
  name: string;
  accountId: string;
  orgId: string | null;
  ownerUserId?: string;
  status?: TenantStatus;
  ownerKind?: TenantOwnerKind;
  allowUiOverrides?: boolean;
  allowBackendOverrides?: boolean;
  allowSsr?: boolean;
}

export interface SpawnTenantInput {
  name: string;
  hostname: string;
  ownerAccountId: string;
  ownerUserId: string;
}

export interface SpawnTenantResult {
  tenant: TenantRecord;
  binding: TenantBindingRecord;
}

export interface CreateBindingInput {
  tenantId: string;
  hostname: string;
  isPrimary?: boolean;
}

export interface ApplyNodeProposalInput {
  kind: "country" | "state" | "city";
  name: string;
  slug: string;
  parentId: string | null;
  orgId: string;
  accountId: string;
  hostname: string;
  poolAccountId?: string;
}

export interface TenantsService {
  listAllTenants: TenantEffect<TenantRecord[]>;
  listTenantsByOrgIds(orgIds: string[]): TenantEffect<TenantRecord[]>;
  listTenantsByOwnerUserId(ownerUserId: string): TenantEffect<TenantRecord[]>;
  listTenantApps(organizationIds?: readonly string[]): TenantEffect<TenantAppRecord[]>;
  listBindings: TenantEffect<TenantBinding[]>;
  listBindingsForTenant(tenantId: string): TenantEffect<TenantBindingRecord[]>;
  createBinding(input: CreateBindingInput): TenantEffect<TenantBindingRecord>;
  spawnTenant(input: SpawnTenantInput): TenantEffect<SpawnTenantResult>;
  verifyCustomDomain(tenantId: string, bindingId: string): TenantEffect<TenantBindingRecord>;
  deleteBinding(tenantId: string, bindingId: string): TenantEffect<void>;
  setPrimaryBinding(tenantId: string, bindingId: string): TenantEffect<TenantBindingRecord>;
  resolveBindingByHostname(hostname: string): TenantEffect<TenantBindingRecord | null>;
  createTenant(input: TenantInput): TenantEffect<TenantRecord>;
  applyNodeProposal(input: ApplyNodeProposalInput): TenantEffect<{ nodeId: string }>;
  updateTenant(
    id: string,
    input: Partial<
      Pick<
        TenantInput,
        "name" | "accountId" | "status" | "allowUiOverrides" | "allowBackendOverrides" | "allowSsr"
      >
    >,
  ): TenantEffect<TenantRecord>;
  softDeleteTenant(id: string): TenantEffect<TenantRecord | null>;
  suspendTenant(id: string): TenantEffect<TenantRecord | null>;
  reactivateTenant(id: string): TenantEffect<TenantRecord | null>;
  resolveTenantByAccountId(accountId: string): TenantEffect<TenantRecord | null>;
  resolveTenantById(id: string): TenantEffect<TenantRecord | null>;
  resolveTenantByOrgId(orgId: string): TenantEffect<TenantRecord | null>;
  deleteTenantById(id: string): TenantEffect<boolean>;
}

export class TenantsTag extends Context.Service<TenantsTag, TenantsService>()("api/Tenants") {}

type TenantRow = typeof tenantsTable.$inferSelect;
type BindingRow = typeof domainBindingsTable.$inferSelect;

function toTenantRecord(row: TenantRow): TenantRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    orgId: row.orgId,
    ownerUserId: row.ownerUserId,
    name: row.name,
    status: row.status,
    ownerKind: (row.ownerKind ?? "platform") as TenantOwnerKind,
    allowUiOverrides: row.allowUiOverrides,
    allowBackendOverrides: row.allowBackendOverrides,
    allowSsr: row.allowSsr,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    deletedAt: row.deletedAt instanceof Date ? row.deletedAt.toISOString() : null,
  };
}

function toBindingRecord(row: BindingRow): TenantBindingRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    hostname: row.hostname,
    isPrimary: row.isPrimary,
    isVerified: row.isVerified,
    verificationToken: row.verificationToken,
    verifiedAt: row.verifiedAt instanceof Date ? row.verifiedAt.toISOString() : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

function generateVerificationToken(): string {
  return randomBytes(24).toString("hex");
}

export interface TenantsConfig {
  gatewayDomains: string[];
}

export class TenantsConfigTag extends Context.Service<TenantsConfigTag, TenantsConfig>()(
  "api/TenantsConfig",
) {}

export const TenantsConfigLive = (gatewayDomains: string[]) =>
  Layer.succeed(TenantsConfigTag, { gatewayDomains });

export const TenantsLive = Layer.effect(
  TenantsTag,
  Effect.gen(function* () {
    const db = yield* DatabaseTag;
    const config = yield* Effect.serviceOption(TenantsConfigTag);
    const gatewayDomains = config._tag === "Some" ? config.value.gatewayDomains : [];

    const isGatewayZoneHostname = (hostname: string) =>
      gatewayDomains.some((domain) => hostname.endsWith(`.${domain}`));

    const query = <T>(run: () => Promise<T>): TenantEffect<T> =>
      Effect.tryPromise({ try: run, catch: toOrpcError });

    const service: TenantsService = {
      listAllTenants: query(() => db.select().from(tenantsTable)).pipe(
        Effect.map((rows) => rows.map(toTenantRecord)),
      ),

      listTenantsByOwnerUserId: (ownerUserId) =>
        Effect.gen(function* () {
          const rows = yield* query(() =>
            db.select().from(tenantsTable).where(eq(tenantsTable.ownerUserId, ownerUserId)),
          );
          return rows.map(toTenantRecord);
        }),

      listTenantsByOrgIds: (orgIds) =>
        Effect.gen(function* () {
          if (orgIds.length === 0) return [];
          const rows = yield* query(() =>
            db.select().from(tenantsTable).where(inArray(tenantsTable.orgId, orgIds)),
          );
          return rows.map(toTenantRecord);
        }),

      listTenantApps: (organizationIds) =>
        Effect.gen(function* () {
          if (organizationIds?.length === 0) return [];
          const conditions = [eq(tenantsTable.status, "active")];
          if (organizationIds) {
            conditions.push(inArray(tenantsTable.orgId, organizationIds));
          }
          const rows = yield* query(() =>
            db
              .select({
                accountId: tenantsTable.accountId,
                name: tenantsTable.name,
                status: tenantsTable.status,
                ownerKind: tenantsTable.ownerKind,
                createdAt: tenantsTable.createdAt,
                hostname: domainBindingsTable.hostname,
                nodeId: nodesTable.id,
                nodeSlug: nodesTable.slug,
                nodeMetadata: nodesTable.metadata,
                nodeName: nodesTable.name,
              })
              .from(tenantsTable)
              .leftJoin(
                domainBindingsTable,
                and(
                  eq(domainBindingsTable.tenantId, tenantsTable.id),
                  eq(domainBindingsTable.isPrimary, true),
                ),
              )
              .leftJoin(nodesTable, eq(nodesTable.tenantId, tenantsTable.id))
              .where(and(...conditions)),
          );

          const seen = new Set<string>();
          const apps: TenantAppRecord[] = [];
          for (const row of rows) {
            if (seen.has(row.accountId)) continue;
            seen.add(row.accountId);
            apps.push({
              accountId: row.accountId,
              name: row.name,
              status: row.status,
              ownerKind: (row.ownerKind ?? "platform") as TenantOwnerKind,
              hostname: row.hostname ?? null,
              node:
                row.nodeId && row.nodeSlug && row.nodeName
                  ? {
                      id: row.nodeId,
                      slug: row.nodeSlug,
                      kind: nodeKindOf(row.nodeMetadata),
                      name: row.nodeName,
                    }
                  : null,
              createdAt:
                row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
            });
          }
          return apps;
        }),

      listBindings: query(() =>
        db
          .select({
            hostname: domainBindingsTable.hostname,
            tenantId: domainBindingsTable.tenantId,
            accountId: tenantsTable.accountId,
            allowUiOverrides: tenantsTable.allowUiOverrides,
            allowBackendOverrides: tenantsTable.allowBackendOverrides,
            allowSsr: tenantsTable.allowSsr,
            status: tenantsTable.status,
          })
          .from(domainBindingsTable)
          .innerJoin(tenantsTable, eq(domainBindingsTable.tenantId, tenantsTable.id))
          .where(
            or(
              eq(domainBindingsTable.isVerified, true),
              notLike(domainBindingsTable.hostname, "%.%"),
            ),
          ),
      ),

      listBindingsForTenant: (tenantId) =>
        Effect.gen(function* () {
          const rows = yield* query(() =>
            db.select().from(domainBindingsTable).where(eq(domainBindingsTable.tenantId, tenantId)),
          );
          return rows.map(toBindingRecord);
        }),

      createBinding: (input) =>
        Effect.gen(function* () {
          const tenant = yield* query(() =>
            db
              .select({ id: tenantsTable.id })
              .from(tenantsTable)
              .where(eq(tenantsTable.id, input.tenantId))
              .limit(1),
          );
          if (tenant.length === 0) {
            return yield* Effect.fail(
              new ORPCError("NOT_FOUND", {
                message: "Tenant not found",
                data: { resource: "tenant", resourceId: input.tenantId },
              }),
            );
          }

          const autoVerified =
            !input.hostname.includes(".") || isGatewayZoneHostname(input.hostname);
          const verifiedAt = autoVerified ? yield* DateTime.nowAsDate : null;
          const rows = yield* Effect.tryPromise({
            try: () =>
              db
                .insert(domainBindingsTable)
                .values({
                  tenantId: input.tenantId,
                  hostname: input.hostname,
                  isPrimary: input.isPrimary ?? false,
                  isVerified: autoVerified,
                  verifiedAt,
                  verificationToken: generateVerificationToken(),
                })
                .returning(),
            catch: (error) =>
              isUniqueViolation(error)
                ? new ORPCError("CONFLICT", {
                    message: "Hostname already in use",
                    data: { hostname: input.hostname },
                  })
                : toOrpcError(error),
          });
          const [row] = rows;
          if (!row) {
            return yield* Effect.fail(
              new ORPCError("INTERNAL_SERVER_ERROR", {
                message: "Domain binding creation failed",
              }),
            );
          }
          return toBindingRecord(row);
        }),

      verifyCustomDomain: (tenantId, bindingId) =>
        Effect.gen(function* () {
          const [binding] = yield* query(() =>
            db
              .select()
              .from(domainBindingsTable)
              .where(
                and(
                  eq(domainBindingsTable.id, bindingId),
                  eq(domainBindingsTable.tenantId, tenantId),
                ),
              )
              .limit(1),
          );
          if (!binding) {
            return yield* Effect.fail(
              new ORPCError("NOT_FOUND", {
                message: "Domain binding not found for tenant",
                data: { resource: "domainBinding", resourceId: bindingId, tenantId },
              }),
            );
          }
          if (binding.isVerified) return toBindingRecord(binding);
          if (binding.hostname.includes(".")) {
            const records = yield* query(() => resolveTxt(binding.hostname).catch(() => []));
            const expected = `everything-verify=${binding.verificationToken}`;
            if (!records.some((record) => record.join("") === expected)) {
              return yield* Effect.fail(
                new ORPCError("BAD_REQUEST", {
                  message:
                    "Verification TXT record not found. Check your DNS records and try again.",
                }),
              );
            }
          }
          const [row] = yield* query(() =>
            db
              .update(domainBindingsTable)
              .set({
                isVerified: true,
                verifiedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(domainBindingsTable.id, bindingId),
                  eq(domainBindingsTable.tenantId, tenantId),
                ),
              )
              .returning(),
          );

          if (!row) {
            return yield* Effect.fail(
              new ORPCError("NOT_FOUND", {
                message: "Domain binding not found",
                data: { resource: "domainBinding", resourceId: bindingId },
              }),
            );
          }

          return toBindingRecord(row);
        }),

      deleteBinding: (tenantId, bindingId) =>
        Effect.gen(function* () {
          const rows = yield* query(() =>
            db
              .delete(domainBindingsTable)
              .where(
                and(
                  eq(domainBindingsTable.id, bindingId),
                  eq(domainBindingsTable.tenantId, tenantId),
                ),
              )
              .returning({ id: domainBindingsTable.id }),
          );
          if (rows.length === 0) {
            return yield* Effect.fail(
              new ORPCError("NOT_FOUND", {
                message: "Domain binding not found for tenant",
                data: { resource: "domainBinding", resourceId: bindingId, tenantId },
              }),
            );
          }
        }),

      setPrimaryBinding: (tenantId, bindingId) =>
        query(() =>
          db.transaction(async (tx) => {
            const [binding] = await tx
              .select()
              .from(domainBindingsTable)
              .where(
                and(
                  eq(domainBindingsTable.id, bindingId),
                  eq(domainBindingsTable.tenantId, tenantId),
                ),
              )
              .limit(1);
            if (!binding) {
              throw new ORPCError("NOT_FOUND", {
                message: "Domain binding not found for tenant",
                data: { resource: "domainBinding", resourceId: bindingId, tenantId },
              });
            }

            await tx
              .update(domainBindingsTable)
              .set({ isPrimary: false, updatedAt: new Date() })
              .where(
                and(
                  eq(domainBindingsTable.tenantId, tenantId),
                  not(eq(domainBindingsTable.id, bindingId)),
                ),
              );

            const [updated] = await tx
              .update(domainBindingsTable)
              .set({ isPrimary: true, updatedAt: new Date() })
              .where(eq(domainBindingsTable.id, bindingId))
              .returning();

            if (!updated) {
              throw new ORPCError("INTERNAL_SERVER_ERROR", {
                message: "Failed to set primary binding",
              });
            }

            return toBindingRecord(updated);
          }),
        ),

      resolveBindingByHostname: (hostname) =>
        Effect.gen(function* () {
          const [row] = yield* query(() =>
            db
              .select()
              .from(domainBindingsTable)
              .where(eq(domainBindingsTable.hostname, hostname))
              .limit(1),
          );
          return row ? toBindingRecord(row) : null;
        }),

      createTenant: (input) =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () =>
              db
                .insert(tenantsTable)
                .values({
                  name: input.name,
                  accountId: input.accountId,
                  orgId: input.orgId,
                  ...(input.status !== undefined && { status: input.status }),
                  ...(input.ownerKind !== undefined && { ownerKind: input.ownerKind }),
                  ...(input.allowUiOverrides !== undefined && {
                    allowUiOverrides: input.allowUiOverrides,
                  }),
                  ...(input.allowBackendOverrides !== undefined && {
                    allowBackendOverrides: input.allowBackendOverrides,
                  }),
                  ...(input.allowSsr !== undefined && { allowSsr: input.allowSsr }),
                })
                .onConflictDoNothing({ target: tenantsTable.accountId })
                .returning(),
            catch: (error) =>
              isUniqueViolation(error)
                ? new ORPCError("CONFLICT", {
                    message: "Tenant with this accountId already exists",
                    data: { accountId: input.accountId },
                  })
                : toOrpcError(error),
          });
          const [row] = rows;
          if (!row) {
            return yield* Effect.fail(
              new ORPCError("CONFLICT", {
                message: "Tenant with this accountId already exists",
                data: { accountId: input.accountId },
              }),
            );
          }
          return toTenantRecord(row);
        }),

      spawnTenant: (input) =>
        query(() =>
          db.transaction(async (tx) => {
            const [existingTenant, existingBinding] = await Promise.all([
              tx
                .select({ id: tenantsTable.id })
                .from(tenantsTable)
                .where(eq(tenantsTable.accountId, input.ownerAccountId))
                .limit(1),
              tx
                .select({ id: domainBindingsTable.id })
                .from(domainBindingsTable)
                .where(eq(domainBindingsTable.hostname, input.hostname))
                .limit(1),
            ]);

            if (existingTenant.length > 0) {
              throw new ORPCError("CONFLICT", {
                message: "Tenant with this accountId already exists",
                data: { accountId: input.ownerAccountId },
              });
            }
            if (existingBinding.length > 0) {
              throw new ORPCError("CONFLICT", {
                message: "Hostname already in use",
                data: { hostname: input.hostname },
              });
            }

            const [tenant] = await tx
              .insert(tenantsTable)
              .values({
                name: input.name,
                accountId: input.ownerAccountId,
                orgId: null,
                ownerUserId: input.ownerUserId,
                status: "active",
                ownerKind: "user",
              })
              .returning();
            if (!tenant) {
              throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Tenant creation failed" });
            }

            const autoVerified = isGatewayZoneHostname(input.hostname);
            const [binding] = await tx
              .insert(domainBindingsTable)
              .values({
                tenantId: tenant.id,
                hostname: input.hostname,
                isPrimary: true,
                isVerified: autoVerified,
                verifiedAt: autoVerified ? new Date() : null,
                verificationToken: generateVerificationToken(),
              })
              .returning();
            if (!binding) {
              throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Binding creation failed" });
            }

            return { tenant: toTenantRecord(tenant), binding: toBindingRecord(binding) };
          }),
        ),

      applyNodeProposal: (input) =>
        Effect.tryPromise({
          try: () =>
            db.transaction(async (tx) => {
              const [existingTenant, existingNode, existingBinding] = await Promise.all([
                tx
                  .select({ id: tenantsTable.id })
                  .from(tenantsTable)
                  .where(eq(tenantsTable.accountId, input.accountId))
                  .limit(1),
                tx
                  .select({ id: nodesTable.id })
                  .from(nodesTable)
                  .where(eq(nodesTable.slug, input.slug))
                  .limit(1),
                tx
                  .select({ id: domainBindingsTable.id })
                  .from(domainBindingsTable)
                  .where(eq(domainBindingsTable.hostname, input.hostname))
                  .limit(1),
              ]);

              if (existingTenant.length > 0) {
                throw new ORPCError("CONFLICT", {
                  message: "Tenant with this accountId already exists",
                  data: { accountId: input.accountId },
                });
              }
              if (existingNode.length > 0) {
                throw new ORPCError("CONFLICT", {
                  message: "Node slug already exists",
                  data: { slug: input.slug },
                });
              }
              if (existingBinding.length > 0) {
                throw new ORPCError("CONFLICT", {
                  message: "Hostname already in use",
                  data: { hostname: input.hostname },
                });
              }

              let parentKind: string | null = null;
              if (input.parentId) {
                const [parent] = await tx
                  .select({ metadata: nodesTable.metadata })
                  .from(nodesTable)
                  .where(eq(nodesTable.id, input.parentId))
                  .limit(1);
                if (!parent) {
                  throw new ORPCError("NOT_FOUND", {
                    message: "Parent node not found",
                    data: { resource: "node", resourceId: input.parentId },
                  });
                }
                parentKind = nodeKindOf(parent.metadata);
              }

              const parentIsValid =
                (input.kind === "country" && input.parentId === null) ||
                (input.kind === "state" && parentKind === "country") ||
                (input.kind === "city" && (parentKind === "country" || parentKind === "state"));
              if (!parentIsValid) {
                throw new ORPCError("BAD_REQUEST", { message: "Invalid parent for node kind" });
              }

              const [tenant] = await tx
                .insert(tenantsTable)
                .values({
                  name: input.name,
                  accountId: input.accountId,
                  orgId: input.orgId,
                  status: "active",
                  ownerKind: "dao",
                })
                .returning({ id: tenantsTable.id });
              if (!tenant) {
                throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Tenant creation failed" });
              }

              const [node] = await tx
                .insert(nodesTable)
                .values({
                  slug: input.slug,
                  name: input.name,
                  parentId: input.parentId,
                  tenantId: tenant.id,
                  metadata: {
                    kind: input.kind,
                    ...(input.poolAccountId ? { poolAccountId: input.poolAccountId } : {}),
                  },
                })
                .returning({ id: nodesTable.id });
              if (!node) {
                throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Node creation failed" });
              }

              if (input.poolAccountId) {
                await tx.insert(validatorsTable).values({
                  nodeId: node.id,
                  accountId: input.poolAccountId,
                  network: "mainnet",
                  protocol: "near",
                  role: "official",
                  isDefault: true,
                  metadata: {},
                });
              }

              const [binding] = await tx
                .insert(domainBindingsTable)
                .values({
                  tenantId: tenant.id,
                  hostname: input.hostname,
                  isPrimary: true,
                  isVerified: !input.hostname.includes("."),
                  verifiedAt: input.hostname.includes(".") ? null : new Date(),
                  verificationToken: generateVerificationToken(),
                })
                .returning({ id: domainBindingsTable.id });
              if (!binding) {
                throw new ORPCError("INTERNAL_SERVER_ERROR", {
                  message: "Domain binding creation failed",
                });
              }

              return { nodeId: node.id };
            }),
          catch: (error) =>
            isUniqueViolation(error)
              ? new ORPCError("CONFLICT", { message: "Node proposal resources already exist" })
              : toOrpcError(error),
        }),

      updateTenant: (id, input) =>
        Effect.gen(function* () {
          const [row] = yield* query(() =>
            db
              .update(tenantsTable)
              .set({ ...input, updatedAt: new Date() })
              .where(eq(tenantsTable.id, id))
              .returning(),
          );

          if (!row) {
            return yield* Effect.fail(
              new ORPCError("NOT_FOUND", {
                message: "Tenant not found",
                data: { resource: "tenant", resourceId: id },
              }),
            );
          }

          return toTenantRecord(row);
        }),

      softDeleteTenant: (id) =>
        Effect.gen(function* () {
          const [row] = yield* query(() =>
            db
              .update(tenantsTable)
              .set({ status: "pending_deletion", deletedAt: new Date(), updatedAt: new Date() })
              .where(eq(tenantsTable.id, id))
              .returning(),
          );
          return row ? toTenantRecord(row) : null;
        }),

      suspendTenant: (id) =>
        Effect.gen(function* () {
          const [row] = yield* query(() =>
            db
              .update(tenantsTable)
              .set({ status: "suspended", updatedAt: new Date() })
              .where(eq(tenantsTable.id, id))
              .returning(),
          );
          return row ? toTenantRecord(row) : null;
        }),

      reactivateTenant: (id) =>
        Effect.gen(function* () {
          const [row] = yield* query(() =>
            db
              .update(tenantsTable)
              .set({ status: "active", updatedAt: new Date() })
              .where(eq(tenantsTable.id, id))
              .returning(),
          );
          return row ? toTenantRecord(row) : null;
        }),

      resolveTenantByAccountId: (accountId) =>
        Effect.gen(function* () {
          const [row] = yield* query(() =>
            db.select().from(tenantsTable).where(eq(tenantsTable.accountId, accountId)).limit(1),
          );
          return row ? toTenantRecord(row) : null;
        }),

      resolveTenantById: (id) =>
        Effect.gen(function* () {
          const [row] = yield* query(() =>
            db.select().from(tenantsTable).where(eq(tenantsTable.id, id)).limit(1),
          );
          return row ? toTenantRecord(row) : null;
        }),

      resolveTenantByOrgId: (orgId) =>
        Effect.gen(function* () {
          const [row] = yield* query(() =>
            db.select().from(tenantsTable).where(eq(tenantsTable.orgId, orgId)).limit(1),
          );
          return row ? toTenantRecord(row) : null;
        }),

      deleteTenantById: (id) =>
        Effect.gen(function* () {
          const rows = yield* query(() =>
            db
              .delete(tenantsTable)
              .where(eq(tenantsTable.id, id))
              .returning({ deletedId: tenantsTable.id }),
          );
          return rows.length > 0;
        }),
    };

    return service;
  }),
);
