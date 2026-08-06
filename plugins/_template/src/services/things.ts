import { and, count, desc, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { DatabaseTag } from "../db/layer";
import { things } from "../db/schema";

export interface Thing {
  thingId: string;
  type: string;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedThing extends Thing {
  action: string;
}

export interface ListThingsInput {
  type?: string;
  limit?: number;
  cursor?: string;
}

export interface ListThingsResult {
  data: Thing[];
  meta: { total: number; hasMore: boolean; nextCursor: string | null };
}

type ThingsError = ORPCError<"NOT_FOUND" | "CONFLICT" | "INTERNAL_SERVER_ERROR", unknown>;

function toIsoString(value: Date | string | null | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : value.toISOString();
}

function mapRow(row: typeof things.$inferSelect): Thing {
  return {
    thingId: row.thingId,
    type: row.type,
    payload: row.payload,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function resolveType(payload: unknown): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const kind = (payload as Record<string, unknown>).kind;
    if (typeof kind === "string" && kind.trim()) {
      return `template.${kind.trim()}`;
    }
  }
  return "template.thing";
}

export class ThingsService extends Context.Tag("template/ThingsService")<
  ThingsService,
  {
    createThing: (thingId: string, payload: unknown) => Effect.Effect<CreatedThing, ThingsError>;

    getThing: (thingId: string) => Effect.Effect<Thing, ThingsError>;

    deleteThing: (thingId: string) => Effect.Effect<{ success: true }, ThingsError>;

    listThings: (input: ListThingsInput) => Effect.Effect<ListThingsResult, ThingsError>;
  }
>() {
  static Live = Layer.effect(
    ThingsService,
    Effect.gen(function* () {
      const db = yield* DatabaseTag;

      const internalError = (error: unknown): ThingsError =>
        new ORPCError("INTERNAL_SERVER_ERROR", {
          message: error instanceof Error ? error.message : String(error),
        });

      const query = <A>(operation: () => Promise<A>) =>
        Effect.tryPromise({
          try: operation,
          catch: internalError,
        });

      const notFound = (thingId: string): ThingsError =>
        new ORPCError("NOT_FOUND", { message: `Thing ${thingId} not found` });

      const conflict = (thingId: string): ThingsError =>
        new ORPCError("CONFLICT", { message: `A thing with ID ${thingId} already exists` });

      return {
        createThing: (thingId, payload) =>
          query(() =>
            db
              .insert(things)
              .values({ thingId, type: resolveType(payload), payload })
              .onConflictDoNothing()
              .returning(),
          ).pipe(
            Effect.flatMap((rows) => {
              const row = rows[0];
              if (!row) {
                return Effect.fail(conflict(thingId));
              }
              const thing = mapRow(row);
              return Effect.succeed({ ...thing, action: `${thing.type}.created` });
            }),
          ),

        getThing: (thingId) =>
          query(() => db.select().from(things).where(eq(things.thingId, thingId)).limit(1)).pipe(
            Effect.flatMap((rows) => {
              const row = rows[0];
              if (!row) {
                return Effect.fail(notFound(thingId));
              }
              return Effect.succeed(mapRow(row));
            }),
          ),

        deleteThing: (thingId) =>
          query(() =>
            db
              .delete(things)
              .where(eq(things.thingId, thingId))
              .returning({ thingId: things.thingId }),
          ).pipe(
            Effect.flatMap((rows) => {
              if (rows.length === 0) {
                return Effect.fail(notFound(thingId));
              }
              return Effect.succeed({ success: true as const });
            }),
          ),

        listThings: (input) =>
          Effect.gen(function* () {
            const limit = Math.min(Math.max(input.limit ?? 10, 1), 100);
            const offset = Number.isFinite(Number(input.cursor))
              ? Math.max(Number(input.cursor), 0)
              : 0;

            const conditions = input.type ? [eq(things.type, input.type)] : [];
            const where = conditions.length > 0 ? and(...conditions) : undefined;

            const [totalRow] = yield* query(() =>
              db.select({ total: count() }).from(things).where(where),
            );
            const total = totalRow?.total ?? 0;

            const rows = yield* query(() =>
              db
                .select()
                .from(things)
                .where(where)
                .orderBy(desc(things.createdAt))
                .limit(limit)
                .offset(offset),
            );

            const data = rows.map(mapRow);
            const nextOffset = offset + data.length;
            const hasMore = data.length > 0 && nextOffset < total;

            return {
              data,
              meta: {
                total,
                hasMore,
                nextCursor: hasMore ? String(nextOffset) : null,
              },
            };
          }),
      };
    }),
  );
}
