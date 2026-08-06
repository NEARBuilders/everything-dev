import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Exit, Layer } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseLive } from "@/db/layer";
import { ThingsService } from "@/services/things";

let activeDir: string | null = null;

afterEach(() => {
  if (activeDir) {
    rmSync(activeDir, { recursive: true, force: true });
    activeDir = null;
  }
});

function freshLayer() {
  const dir = mkdtempSync(join(tmpdir(), "template-things-"));
  activeDir = dir;
  return ThingsService.Live.pipe(Layer.provide(DatabaseLive(`pglite:${dir}`)));
}

interface ThingsSvc {
  createThing: (
    thingId: string,
    payload: unknown,
  ) => Effect.Effect<
    {
      thingId: string;
      type: string;
      payload: unknown;
      action: string;
      createdAt: string;
      updatedAt: string;
    },
    unknown
  >;
  getThing: (thingId: string) => Effect.Effect<
    {
      thingId: string;
      type: string;
      payload: unknown;
      createdAt: string;
      updatedAt: string;
    },
    unknown
  >;
  deleteThing: (thingId: string) => Effect.Effect<{ success: true }, unknown>;
  listThings: (input: { type?: string; limit?: number; cursor?: string }) => Effect.Effect<
    {
      data: {
        thingId: string;
        type: string;
        payload: unknown;
        createdAt: string;
        updatedAt: string;
      }[];
      meta: { total: number; hasMore: boolean; nextCursor: string | null };
    },
    unknown
  >;
}

async function runService<A>(
  layer: Layer.Layer<ThingsService, never, never>,
  fn: (svc: ThingsSvc) => Effect.Effect<A, unknown>,
): Promise<A> {
  const effect = Effect.gen(function* () {
    const svc = yield* ThingsService;
    return yield* fn(svc);
  });
  return Effect.runPromise(Effect.provide(effect, layer));
}

async function squashServiceError<A>(
  layer: Layer.Layer<ThingsService, never, never>,
  fn: (svc: ThingsSvc) => Effect.Effect<A, unknown>,
): Promise<unknown> {
  const effect = Effect.gen(function* () {
    const svc = yield* ThingsService;
    return yield* fn(svc);
  });
  const exit = await Effect.runPromiseExit(Effect.provide(effect, layer));
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected effect to fail");
  }
  return Cause.squash(exit.cause);
}

describe("ThingsService", () => {
  it("creates and fetches a thing with a derived type and action", async () => {
    const layer = freshLayer();
    const created = await runService(layer, (svc) =>
      svc.createThing("thing-1", { kind: "note", text: "hello" }),
    );

    expect(created).toMatchObject({
      thingId: "thing-1",
      type: "template.note",
      payload: { kind: "note", text: "hello" },
      action: "template.note.created",
    });
    expect(created.createdAt).toEqual(expect.any(String));
    expect(created.updatedAt).toEqual(expect.any(String));

    const fetched = await runService(layer, (svc) => svc.getThing("thing-1"));
    expect(fetched).toMatchObject({
      thingId: "thing-1",
      type: "template.note",
      payload: { kind: "note", text: "hello" },
    });
    expect((fetched as { action?: string }).action).toBeUndefined();
  });

  it("defaults type to template.thing when payload has no kind", async () => {
    const layer = freshLayer();
    const created = await runService(layer, (svc) => svc.createThing("thing-2", { text: "hello" }));
    expect(created.type).toBe("template.thing");
    expect(created.action).toBe("template.thing.created");
  });

  it("fails with CONFLICT when creating a duplicate id", async () => {
    const layer = freshLayer();
    await runService(layer, (svc) => svc.createThing("thing-3", { kind: "note" }));

    const error = await squashServiceError(layer, (svc) =>
      svc.createThing("thing-3", { kind: "note" }),
    );
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("CONFLICT");
  });

  it("fails with NOT_FOUND when fetching a missing thing", async () => {
    const layer = freshLayer();
    const error = await squashServiceError(layer, (svc) => svc.getThing("nope"));
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
  });

  it("fails with NOT_FOUND when deleting a missing thing", async () => {
    const layer = freshLayer();
    const error = await squashServiceError(layer, (svc) => svc.deleteThing("nope"));
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
  });

  it("deletes an existing thing", async () => {
    const layer = freshLayer();
    await runService(layer, (svc) => svc.createThing("thing-4", { kind: "note" }));

    const deleted = await runService(layer, (svc) => svc.deleteThing("thing-4"));
    expect(deleted).toEqual({ success: true });

    const error = await squashServiceError(layer, (svc) => svc.getThing("thing-4"));
    expect((error as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
  });

  it("lists things with type filtering, ordering, and pagination", async () => {
    const layer = freshLayer();
    await runService(layer, (svc) => svc.createThing("a", { kind: "alpha" }));
    await runService(layer, (svc) => svc.createThing("b", { kind: "beta" }));
    await runService(layer, (svc) => svc.createThing("c", { kind: "alpha" }));

    const all = await runService(layer, (svc) => svc.listThings({}));
    expect(all.meta.total).toBe(3);
    expect(all.data.map((t) => t.thingId)).toEqual(["c", "b", "a"]);

    const filtered = await runService(layer, (svc) => svc.listThings({ type: "template.alpha" }));
    expect(filtered.meta.total).toBe(2);
    expect(filtered.data.map((t) => t.thingId)).toEqual(["c", "a"]);

    const page = await runService(layer, (svc) => svc.listThings({ limit: 2 }));
    expect(page.data.map((t) => t.thingId)).toEqual(["c", "b"]);
    expect(page.meta.hasMore).toBe(true);
    expect(page.meta.nextCursor).toBe("2");

    const nextPage = await runService(layer, (svc) =>
      svc.listThings({ limit: 2, cursor: page.meta.nextCursor! }),
    );
    expect(nextPage.data.map((t) => t.thingId)).toEqual(["a"]);
    expect(nextPage.meta.hasMore).toBe(false);
  });
});
