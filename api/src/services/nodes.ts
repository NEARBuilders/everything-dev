import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";
import { DatabaseTag } from "../db/layer";
import {
  type NodeMetadata,
  nodes as nodesTable,
  tenants as tenantsTable,
  type validatorRole as validatorRoleEnum,
  validators as validatorsTable,
} from "../db/schema";
import { toOrpcError } from "../lib/errors";

export type NodeKind = string;
type ValidatorRole = (typeof validatorRoleEnum)["enumValues"][number];

export type NodeEffect<T> = Effect.Effect<T, ORPCError<string, unknown>>;

export interface NodeRecord {
  id: string;
  kind: NodeKind | null;
  slug: string;
  name: string;
  parentId: string | null;
  tenantId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface NodeSpawnInput {
  kind?: NodeKind;
  slug: string;
  name: string;
  parentId: string | null;
  tenantId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface NodeUpdateInput {
  kind?: NodeKind;
  slug?: string;
  name?: string;
  parentId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface NodeListFilter {
  kind?: NodeKind;
  parentId?: string | null;
  tenantId?: string;
}

export interface NodeListSummaryRecord {
  node: NodeRecord;
  childrenCount: number;
  validatorCount: number;
}

export interface SubtreeValidator {
  id: string;
  accountId: string;
  network: string;
  protocol: string;
  role: ValidatorRole;
  isDefault: boolean;
}

export interface SubtreeNode {
  id: string;
  kind: NodeKind | null;
  slug: string;
  name: string;
  parentId: string | null;
  validators: SubtreeValidator[];
}

export interface NodesService {
  spawn(input: NodeSpawnInput): NodeEffect<NodeRecord>;
  list(filter?: NodeListFilter): NodeEffect<NodeRecord[]>;
  listSummaries(filter?: NodeListFilter): NodeEffect<NodeListSummaryRecord[]>;
  getById(id: string): NodeEffect<NodeRecord | null>;
  update(id: string, input: NodeUpdateInput): NodeEffect<NodeRecord>;
  setBulletin(id: string, bulletin: string | null): NodeEffect<NodeRecord>;
  delete(id: string): NodeEffect<boolean>;
  listRootNodes: NodeEffect<NodeRecord[]>;
  listChildren(parentId: string): NodeEffect<NodeRecord[]>;
  resolveBySlug(slug: string, parentId?: string | null): NodeEffect<NodeRecord | null>;
  subtreeWithValidators(nodeId: string): NodeEffect<SubtreeNode[]>;
}

export class NodesTag extends Context.Service<NodesTag, NodesService>()("api/Nodes") {}

type NodeRow = typeof nodesTable.$inferSelect;

export function nodeKindOf(metadata: unknown): string | null {
  const kind = (metadata as NodeMetadata | null | undefined)?.kind;
  return typeof kind === "string" ? kind : null;
}

function toNodeRecord(row: NodeRow): NodeRecord {
  const metadata = (row.metadata ?? {}) as NodeMetadata;
  return {
    id: row.id,
    kind: nodeKindOf(metadata),
    slug: row.slug,
    name: row.name,
    parentId: row.parentId,
    tenantId: row.tenantId,
    metadata: metadata as Record<string, unknown>,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

function mergeKindMetadata(
  kind: NodeKind | undefined,
  metadata: Record<string, unknown> | undefined,
): NodeMetadata {
  return {
    ...metadata,
    ...(kind !== undefined && { kind }),
  } as NodeMetadata;
}

const SLUG_REGEX = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

const query = <T>(run: () => Promise<T>): NodeEffect<T> =>
  Effect.tryPromise({ try: run, catch: toOrpcError });

function validateSlug(slug: string): NodeEffect<void> {
  if (SLUG_REGEX.test(slug)) return Effect.void;
  return Effect.fail(
    new ORPCError("BAD_REQUEST", {
      message: "Invalid slug format",
      data: { hint: "Lowercase alphanumeric with hyphens or underscores only" },
    }),
  );
}

export const NodesLive = Layer.effect(
  NodesTag,
  Effect.gen(function* () {
    const db = yield* DatabaseTag;

    const service: NodesService = {
      spawn: (input) =>
        Effect.gen(function* () {
          yield* validateSlug(input.slug);

          if (input.tenantId) {
            const tenant = yield* query(() =>
              db
                .select({ id: tenantsTable.id })
                .from(tenantsTable)
                .where(eq(tenantsTable.id, input.tenantId!))
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
          }

          if (input.parentId !== null) {
            const parent = yield* query(() =>
              db
                .select({ id: nodesTable.id })
                .from(nodesTable)
                .where(eq(nodesTable.id, input.parentId!))
                .limit(1),
            );
            if (parent.length === 0) {
              return yield* Effect.fail(
                new ORPCError("NOT_FOUND", {
                  message: "Parent node not found",
                  data: { resource: "node", resourceId: input.parentId },
                }),
              );
            }
          }

          const [row] = yield* query(() =>
            db
              .insert(nodesTable)
              .values({
                slug: input.slug,
                name: input.name,
                parentId: input.parentId,
                tenantId: input.tenantId ?? null,
                metadata: mergeKindMetadata(input.kind, input.metadata),
              })
              .returning(),
          );

          if (!row) {
            return yield* Effect.fail(
              new ORPCError("INTERNAL_SERVER_ERROR", {
                message: "Node creation failed",
              }),
            );
          }

          return toNodeRecord(row);
        }),

      list: (filter) =>
        Effect.gen(function* () {
          const conditions: SQL[] = [];
          if (filter?.kind !== undefined) {
            conditions.push(sql`${nodesTable.metadata}->>'kind' = ${filter.kind}`);
          }
          if (filter?.tenantId !== undefined) {
            conditions.push(eq(nodesTable.tenantId, filter.tenantId));
          }
          if (filter?.parentId !== undefined) {
            if (filter.parentId === null) {
              conditions.push(isNull(nodesTable.parentId));
            } else {
              conditions.push(eq(nodesTable.parentId, filter.parentId));
            }
          }
          const rows = yield* query(() =>
            conditions.length === 0
              ? db.select().from(nodesTable)
              : db
                  .select()
                  .from(nodesTable)
                  .where(and(...conditions)),
          );
          return rows.map(toNodeRecord);
        }),

      listSummaries: (filter) =>
        Effect.gen(function* () {
          const nodes = yield* service.list(filter);
          if (nodes.length === 0) return [];

          const nodeIds = nodes.map((node) => node.id);
          const [childRows, validatorRows] = yield* Effect.all([
            query(() =>
              db
                .select({
                  nodeId: nodesTable.parentId,
                  count: sql<number>`cast(count(*) as integer)`,
                })
                .from(nodesTable)
                .where(inArray(nodesTable.parentId, nodeIds))
                .groupBy(nodesTable.parentId),
            ),
            query(() =>
              db
                .select({
                  nodeId: validatorsTable.nodeId,
                  count: sql<number>`cast(count(*) as integer)`,
                })
                .from(validatorsTable)
                .where(inArray(validatorsTable.nodeId, nodeIds))
                .groupBy(validatorsTable.nodeId),
            ),
          ]);
          const childrenByNode = new Map(
            childRows.flatMap((row) => (row.nodeId ? [[row.nodeId, row.count] as const] : [])),
          );
          const validatorsByNode = new Map(
            validatorRows.map((row) => [row.nodeId, row.count] as const),
          );

          return nodes.map((node) => ({
            node,
            childrenCount: childrenByNode.get(node.id) ?? 0,
            validatorCount: validatorsByNode.get(node.id) ?? 0,
          }));
        }),

      getById: (id) =>
        Effect.gen(function* () {
          const [row] = yield* query(() =>
            db.select().from(nodesTable).where(eq(nodesTable.id, id)).limit(1),
          );
          return row ? toNodeRecord(row) : null;
        }),

      update: (id, input) =>
        Effect.gen(function* () {
          yield* input.slug !== undefined ? validateSlug(input.slug) : Effect.void;
          const patch: Record<string, unknown> = { updatedAt: yield* DateTime.nowAsDate };
          if (input.kind !== undefined || input.metadata !== undefined) {
            const [current] = yield* query(() =>
              db
                .select({ metadata: nodesTable.metadata })
                .from(nodesTable)
                .where(eq(nodesTable.id, id))
                .limit(1),
            );
            const existing = (current?.metadata ?? {}) as NodeMetadata;
            const metadataKind = nodeKindOf(input.metadata);
            const kind = input.kind ?? metadataKind ?? nodeKindOf(existing) ?? undefined;
            patch.metadata = mergeKindMetadata(kind, input.metadata);
          }
          if (input.slug !== undefined) patch.slug = input.slug;
          if (input.name !== undefined) patch.name = input.name;
          if (input.parentId !== undefined) patch.parentId = input.parentId;

          return yield* query(() =>
            db.transaction(async (tx) => {
              if (input.parentId !== undefined && input.parentId !== null) {
                await tx.execute(sql`LOCK TABLE nodes IN SHARE ROW EXCLUSIVE MODE`);

                if (input.parentId === id) {
                  throw new ORPCError("BAD_REQUEST", {
                    message: "Node cannot be its own parent",
                  });
                }

                const parent = await tx
                  .select({ id: nodesTable.id })
                  .from(nodesTable)
                  .where(eq(nodesTable.id, input.parentId!))
                  .limit(1);
                if (parent.length === 0) {
                  throw new ORPCError("NOT_FOUND", {
                    message: "Parent node not found",
                    data: { resource: "node", resourceId: input.parentId },
                  });
                }

                const descendantsResult = await tx.execute(sql`
                  WITH RECURSIVE descendants AS (
                    SELECT id, ARRAY[id] AS path
                    FROM nodes
                    WHERE id = ${id}
                    UNION ALL
                    SELECT n.id, descendants.path || n.id
                    FROM nodes n
                    INNER JOIN descendants ON n.parent_id = descendants.id
                    WHERE NOT (n.id = ANY(descendants.path))
                  )
                  SELECT id
                  FROM descendants
                  WHERE id = ${input.parentId}
                  LIMIT 1
                `);
                const descendants =
                  (descendantsResult as { rows?: unknown }).rows ?? descendantsResult;
                if (Array.isArray(descendants) && descendants.length > 0) {
                  throw new ORPCError("BAD_REQUEST", {
                    message: "Node cannot be moved below one of its descendants",
                  });
                }
              }

              const [row] = await tx
                .update(nodesTable)
                .set(patch)
                .where(eq(nodesTable.id, id))
                .returning();

              if (!row) {
                throw new ORPCError("NOT_FOUND", {
                  message: "Node not found",
                  data: { resource: "node", resourceId: id },
                });
              }

              return toNodeRecord(row);
            }),
          );
        }),

      setBulletin: (id, bulletin) =>
        Effect.gen(function* () {
          const [current] = yield* query(() =>
            db
              .select({ metadata: nodesTable.metadata })
              .from(nodesTable)
              .where(eq(nodesTable.id, id))
              .limit(1),
          );
          if (!current) {
            return yield* Effect.fail(
              new ORPCError("NOT_FOUND", {
                message: "Node not found",
                data: { resource: "node", resourceId: id },
              }),
            );
          }
          const existing = (current.metadata ?? {}) as NodeMetadata;
          const metadata: NodeMetadata = { ...existing };
          if (bulletin === null || bulletin.trim() === "") {
            delete metadata.bulletin;
          } else {
            metadata.bulletin = bulletin;
          }

          const [row] = yield* query(() =>
            db
              .update(nodesTable)
              .set({ metadata, updatedAt: new Date() })
              .where(eq(nodesTable.id, id))
              .returning(),
          );
          if (!row) {
            return yield* Effect.fail(
              new ORPCError("NOT_FOUND", {
                message: "Node not found",
                data: { resource: "node", resourceId: id },
              }),
            );
          }
          return toNodeRecord(row);
        }),

      delete: (id) =>
        Effect.gen(function* () {
          const rows = yield* query(() =>
            db
              .delete(nodesTable)
              .where(eq(nodesTable.id, id))
              .returning({ deletedId: nodesTable.id }),
          );
          return rows.length > 0;
        }),

      listRootNodes: query(() =>
        db.select().from(nodesTable).where(isNull(nodesTable.parentId)),
      ).pipe(Effect.map((rows) => rows.map(toNodeRecord))),

      listChildren: (parentId) =>
        Effect.gen(function* () {
          const rows = yield* query(() =>
            db.select().from(nodesTable).where(eq(nodesTable.parentId, parentId)),
          );
          return rows.map(toNodeRecord);
        }),

      resolveBySlug: (slug, parentId) =>
        Effect.gen(function* () {
          const conditions = [eq(nodesTable.slug, slug)];
          if (parentId === null) {
            conditions.push(isNull(nodesTable.parentId));
          } else if (parentId !== undefined) {
            conditions.push(eq(nodesTable.parentId, parentId));
          }
          const matches = yield* query(() =>
            db
              .select()
              .from(nodesTable)
              .where(and(...conditions))
              .orderBy(sql`${nodesTable.parentId} IS NOT NULL`)
              .limit(parentId === undefined ? 2 : 1),
          );
          const row = matches[0];
          if (parentId === undefined && matches.length > 1 && row?.parentId !== null) {
            return null;
          }
          return row ? toNodeRecord(row) : null;
        }),

      subtreeWithValidators: (nodeId) =>
        Effect.gen(function* () {
          const subtreeResult = yield* query(() =>
            db.execute(sql`
              WITH RECURSIVE subtree AS (
                SELECT id, metadata->>'kind' AS kind, slug, name, parent_id, 0 AS depth, ARRAY[id] AS path
                FROM nodes
                WHERE id = ${nodeId}
                UNION ALL
                SELECT n.id, n.metadata->>'kind', n.slug, n.name, n.parent_id, subtree.depth + 1,
                  subtree.path || n.id
                FROM nodes n
                INNER JOIN subtree ON n.parent_id = subtree.id
                WHERE NOT (n.id = ANY(subtree.path))
              )
              SELECT id, kind, slug, name, parent_id FROM subtree
              ORDER BY depth
            `),
          );

          const rows = (subtreeResult as { rows?: unknown }).rows ?? subtreeResult;
          if (!Array.isArray(rows) || rows.length === 0) return [];

          const ids = (rows as Array<{ id: string }>).map((r) => r.id);

          const validatorRows = yield* query(() =>
            db
              .select({
                id: validatorsTable.id,
                nodeId: validatorsTable.nodeId,
                accountId: validatorsTable.accountId,
                network: validatorsTable.network,
                protocol: validatorsTable.protocol,
                role: validatorsTable.role,
                isDefault: validatorsTable.isDefault,
              })
              .from(validatorsTable)
              .where(inArray(validatorsTable.nodeId, ids)),
          );

          const validatorsByNode = new Map<string, SubtreeValidator[]>();
          for (const v of validatorRows) {
            const arr = validatorsByNode.get(v.nodeId) ?? [];
            arr.push({
              id: v.id,
              accountId: v.accountId,
              network: v.network,
              protocol: v.protocol,
              role: v.role,
              isDefault: v.isDefault,
            });
            validatorsByNode.set(v.nodeId, arr);
          }

          return (
            rows as Array<{
              id: string;
              kind: string | null;
              slug: string;
              name: string;
              parent_id: string | null;
            }>
          ).map((r) => ({
            id: r.id,
            kind: r.kind,
            slug: r.slug,
            name: r.name,
            parentId: r.parent_id,
            validators: validatorsByNode.get(r.id) ?? [],
          }));
        }),
    };

    return service;
  }),
);
