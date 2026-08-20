import { and, eq, inArray, not } from "drizzle-orm";
import { Context, Effect, Layer } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { DatabaseTag } from "../db/layer";
import { type tenantStatus, tenants as tenantsTable } from "../db/schema";

export type TenantStatus = (typeof tenantStatus)["enumValues"][number];

export interface TenantRecord {
  id: string;
  subdomain: string;
  accountId: string;
  orgId: string | null;
  name: string;
  status: TenantStatus;
  allowUiOverrides: boolean;
  allowBackendOverrides: boolean;
  allowSsr: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TenantBinding {
  hostname: string;
  accountId: string;
  allowUiOverrides: boolean;
  allowBackendOverrides: boolean;
  allowSsr: boolean;
  status: TenantStatus;
}

export interface TenantInput {
  subdomain: string;
  name: string;
  accountId: string;
  orgId: string | null;
  status?: TenantStatus;
  allowUiOverrides?: boolean;
  allowBackendOverrides?: boolean;
  allowSsr?: boolean;
}

export interface TenantsService {
  listTenantsByOrgIds(orgIds: string[]): Promise<TenantRecord[]>;
  listBindings(): Promise<TenantBinding[]>;
  createTenant(input: TenantInput): Promise<TenantRecord>;
  updateTenant(
    id: string,
    input: Partial<
      Pick<
        TenantInput,
        | "name"
        | "subdomain"
        | "accountId"
        | "status"
        | "allowUiOverrides"
        | "allowBackendOverrides"
        | "allowSsr"
      >
    >,
  ): Promise<TenantRecord>;
  softDeleteTenant(id: string): Promise<TenantRecord | null>;
  suspendTenant(id: string): Promise<TenantRecord | null>;
  reactivateTenant(id: string): Promise<TenantRecord | null>;
  resolveTenantByAccountId(accountId: string): Promise<TenantRecord | null>;
  resolveTenantById(id: string): Promise<TenantRecord | null>;
  resolveTenantByOrgId(orgId: string): Promise<TenantRecord | null>;
  resolveTenantBySubdomain(subdomain: string): Promise<TenantRecord | null>;
  deleteTenantById(id: string): Promise<boolean>;
}

export class TenantsTag extends Context.Tag("api/Tenants")<TenantsService, TenantsService>() {}

type TenantRow = typeof tenantsTable.$inferSelect;

function toTenantRecord(row: TenantRow): TenantRecord {
  return {
    id: row.id,
    subdomain: row.subdomain,
    accountId: row.accountId,
    orgId: row.orgId,
    name: row.name,
    status: row.status,
    allowUiOverrides: row.allowUiOverrides,
    allowBackendOverrides: row.allowBackendOverrides,
    allowSsr: row.allowSsr,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    deletedAt: row.deletedAt instanceof Date ? row.deletedAt.toISOString() : null,
  };
}

function toOrpcError(error: unknown): ORPCError<string, unknown> {
  return error instanceof ORPCError
    ? error
    : new ORPCError("INTERNAL_SERVER_ERROR", {
        message: error instanceof Error ? error.message : String(error),
      });
}

export const TenantsLive = Layer.effect(
  TenantsTag,
  Effect.gen(function* () {
    const db = yield* DatabaseTag;

    const service: TenantsService = {
      listTenantsByOrgIds: async (orgIds) => {
        if (orgIds.length === 0) return [];
        try {
          const rows = await db
            .select()
            .from(tenantsTable)
            .where(inArray(tenantsTable.orgId, orgIds));
          return rows.map(toTenantRecord);
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      listBindings: async () => {
        try {
          const rows = await db
            .select({
              subdomain: tenantsTable.subdomain,
              accountId: tenantsTable.accountId,
              allowUiOverrides: tenantsTable.allowUiOverrides,
              allowBackendOverrides: tenantsTable.allowBackendOverrides,
              allowSsr: tenantsTable.allowSsr,
              status: tenantsTable.status,
            })
            .from(tenantsTable);
          return rows.map(({ subdomain, ...binding }) => ({
            ...binding,
            hostname: subdomain,
          }));
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      createTenant: async (input) => {
        try {
          const [row] = await db
            .insert(tenantsTable)
            .values({
              subdomain: input.subdomain,
              name: input.name,
              accountId: input.accountId,
              orgId: input.orgId,
              ...(input.status !== undefined && { status: input.status }),
              ...(input.allowUiOverrides !== undefined && {
                allowUiOverrides: input.allowUiOverrides,
              }),
              ...(input.allowBackendOverrides !== undefined && {
                allowBackendOverrides: input.allowBackendOverrides,
              }),
              ...(input.allowSsr !== undefined && { allowSsr: input.allowSsr }),
            })
            .onConflictDoNothing()
            .returning();

          if (!row) {
            throw new ORPCError("BAD_REQUEST", {
              message: "Tenant with this subdomain, account ID, or org ID already exists",
              data: { invalidFields: ["subdomain", "accountId", "orgId"] },
            });
          }

          return toTenantRecord(row);
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      updateTenant: async (id, input) => {
        try {
          if (input.subdomain !== undefined) {
            const conflicting = await db
              .select({ id: tenantsTable.id })
              .from(tenantsTable)
              .where(and(eq(tenantsTable.subdomain, input.subdomain), not(eq(tenantsTable.id, id))))
              .limit(1);
            if (conflicting.length > 0) {
              throw new ORPCError("BAD_REQUEST", {
                message: "Another tenant already uses this subdomain",
                data: { invalidFields: ["subdomain"] },
              });
            }
          }

          const [row] = await db
            .update(tenantsTable)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(tenantsTable.id, id))
            .returning();

          if (!row) {
            throw new ORPCError("NOT_FOUND", {
              message: "Tenant not found",
              data: { resource: "tenant", resourceId: id },
            });
          }

          return toTenantRecord(row);
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      softDeleteTenant: async (id) => {
        try {
          const [row] = await db
            .update(tenantsTable)
            .set({ status: "pending_deletion", deletedAt: new Date(), updatedAt: new Date() })
            .where(eq(tenantsTable.id, id))
            .returning();
          return row ? toTenantRecord(row) : null;
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      suspendTenant: async (id) => {
        try {
          const [row] = await db
            .update(tenantsTable)
            .set({ status: "suspended", updatedAt: new Date() })
            .where(eq(tenantsTable.id, id))
            .returning();
          return row ? toTenantRecord(row) : null;
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      reactivateTenant: async (id) => {
        try {
          const [row] = await db
            .update(tenantsTable)
            .set({ status: "active", updatedAt: new Date() })
            .where(eq(tenantsTable.id, id))
            .returning();
          return row ? toTenantRecord(row) : null;
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      resolveTenantByAccountId: async (accountId) => {
        try {
          const [row] = await db
            .select()
            .from(tenantsTable)
            .where(eq(tenantsTable.accountId, accountId))
            .limit(1);
          return row ? toTenantRecord(row) : null;
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      resolveTenantById: async (id) => {
        try {
          const [row] = await db
            .select()
            .from(tenantsTable)
            .where(eq(tenantsTable.id, id))
            .limit(1);
          return row ? toTenantRecord(row) : null;
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      resolveTenantByOrgId: async (orgId) => {
        try {
          const [row] = await db
            .select()
            .from(tenantsTable)
            .where(eq(tenantsTable.orgId, orgId))
            .limit(1);
          return row ? toTenantRecord(row) : null;
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      resolveTenantBySubdomain: async (subdomain) => {
        try {
          const [row] = await db
            .select()
            .from(tenantsTable)
            .where(eq(tenantsTable.subdomain, subdomain))
            .limit(1);
          return row ? toTenantRecord(row) : null;
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      deleteTenantById: async (id) => {
        try {
          const rows = await db
            .delete(tenantsTable)
            .where(eq(tenantsTable.id, id))
            .returning({ deletedId: tenantsTable.id });
          return rows.length > 0;
        } catch (error) {
          throw toOrpcError(error);
        }
      },
    };

    return service;
  }),
);
