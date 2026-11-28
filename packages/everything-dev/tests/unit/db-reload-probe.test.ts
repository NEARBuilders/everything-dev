import { count, eq } from "drizzle-orm";
import { Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { DatabaseLive, DatabaseTag } from "../../../../plugins/votes/src/db/layer";
import { upvotes } from "../../../../plugins/votes/src/db/schema";

const layer = DatabaseLive({
  pluginId: "votes",
  secrets: { VOTES_DATABASE_URL: "pglite::memory:" },
}) as Layer.Layer<DatabaseTag, never, never>;

const countFor = (entityId: string) =>
  Effect.gen(function* () {
    const db = yield* DatabaseTag;
    const rows = yield* Effect.tryPromise(() =>
      db
        .select({ n: count() })
        .from(upvotes)
        .where(eq(upvotes.entityId, entityId))
        .then((result: Array<{ n: number }>) => result),
    );
    return rows[0]?.n ?? 0;
  });

const probe = (entityId: string) => countFor(entityId).pipe(Effect.provide(layer));

describe("votes DatabaseLive on pglite::memory: — the reload's fresh instance", () => {
  it("migrations apply and the count query serves on a fresh instance", async () => {
    const exit = await Effect.runPromiseExit(probe("e1"));
    if (Exit.isFailure(exit)) throw new Error(`probe failed: ${String(exit.cause)}`);
    expect(exit.value).toBe(0);
  });

  it("a second fresh instance (the reload path) serves too", async () => {
    const first = await Effect.runPromiseExit(probe("e2"));
    if (Exit.isFailure(first)) throw new Error(`first failed: ${String(first.cause)}`);
    const second = await Effect.runPromiseExit(probe("e2"));
    if (Exit.isFailure(second)) throw new Error(`second failed: ${String(second.cause)}`);
    expect(second.value).toBe(0);
  });
});
