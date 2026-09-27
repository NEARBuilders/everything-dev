import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Effect, Layer } from "effect";
import { expect, it } from "vitest";
import { DatabaseTag } from "../db/layer";
import * as schema from "../db/schema";
import { VoteService, VoteServiceLive } from "../services/votes";

it("walks tied timestamps without duplicates and stops on unknown cursors", async () => {
  const database = new PGlite();
  try {
    await database.exec(`CREATE TABLE upvotes (
      id text PRIMARY KEY, thing_id text NOT NULL, user_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    const db = drizzle(database, { schema });
    const createdAt = new Date("2026-09-01T00:00:00.000Z");
    await db
      .insert(schema.upvotes)
      .values([
        ...["a", "b", "c"].map((id) => ({ id, entityId: id, userId: "user", createdAt })),
        { id: "z", entityId: "z", userId: "user", createdAt: new Date("2026-08-01T00:00:00.000Z") },
      ]);
    const votes = await Effect.runPromise(
      VoteService.pipe(
        Effect.provide(VoteServiceLive),
        Effect.provide(Layer.succeed(DatabaseTag, db)),
      ),
    );
    const first = await votes.getUpvoteFeed(2);
    expect(first.data).toMatchObject([{ id: "c" }, { id: "b" }]);
    expect(first.meta).toMatchObject({ hasMore: true, nextCursor: "b" });
    const second = await votes.getUpvoteFeed(2, first.meta.nextCursor!);
    expect(second.data).toMatchObject([{ id: "a" }, { id: "z" }]);
    expect(second.meta).toMatchObject({ hasMore: false, nextCursor: null });
    expect((await votes.getUpvoteFeed(2, "missing")).data).toEqual([]);
    await votes.downvote("b", "user");
    expect((await votes.getUpvoteFeed(2, "b")).data).toEqual([]);
  } finally {
    await database.close();
  }
});
