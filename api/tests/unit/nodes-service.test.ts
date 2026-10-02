import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ORPCError } from "@orpc/server";
import { Effect, Layer } from "effect";
import { PluginIdTag } from "every-plugin";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseLive } from "@/db/layer";
import { NodesLive, type NodesService, NodesTag } from "@/services/nodes";
import { TenantsLive, type TenantsService, TenantsTag } from "@/services/tenants";
import { createServiceHarness } from "./test-harness";

let activeDir: string | null = null;

afterEach(() => {
  if (activeDir) {
    rmSync(activeDir, { recursive: true, force: true });
    activeDir = null;
  }
});

function freshLayer(): Layer.Layer<NodesTag | TenantsTag, unknown, never> {
  const dir = mkdtempSync(join(tmpdir(), "api-nodes-"));
  activeDir = dir;
  const database = DatabaseLive(`pglite:${dir}`);
  return Layer.mergeAll(
    NodesLive.pipe(Layer.provide(database)),
    TenantsLive.pipe(Layer.provide(database)),
  ).pipe(Layer.provide(Layer.succeed(PluginIdTag, "api"))) as Layer.Layer<
    NodesTag | TenantsTag,
    unknown,
    never
  >;
}

const MISSING_ID = "00000000-0000-0000-0000-000000000000";

interface TestServices {
  nodes: NodesService;
  tenants: TenantsService;
}

const { run: runService, squashError: squashServiceError } = createServiceHarness<
  TestServices,
  NodesTag | TenantsTag
>(
  Effect.gen(function* () {
    return { nodes: yield* NodesTag, tenants: yield* TenantsTag };
  }),
);

function seedTenant(tenants: TenantsService) {
  return Effect.gen(function* () {
    const tenant = yield* tenants.createTenant({
      name: "Test Tenant",
      accountId: "test.example.near",
      orgId: "org-1",
    });
    return tenant.id;
  });
}

describe("NodesService", () => {
  it("rejects moving a City Node below its descendant without changing its subtree", async () => {
    const layer = freshLayer();
    const tenantId = await runService(layer, ({ tenants }) => seedTenant(tenants));
    const root = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "country",
        slug: "root",
        name: "Root",
        parentId: null,
        tenantId,
      }),
    );
    const child = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "state",
        slug: "child",
        name: "Child",
        parentId: root.id,
        tenantId,
      }),
    );
    const leaf = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "city",
        slug: "leaf",
        name: "Leaf",
        parentId: child.id,
        tenantId,
      }),
    );

    const error = await squashServiceError(layer, ({ nodes }) =>
      nodes.update(root.id, { parentId: leaf.id }),
    );
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");
    expect((await runService(layer, ({ nodes }) => nodes.getById(root.id)))?.parentId).toBeNull();
    expect((await runService(layer, ({ nodes }) => nodes.getById(child.id)))?.parentId).toBe(
      root.id,
    );
    await expect(
      runService(layer, ({ nodes }) => nodes.update(leaf.id, { parentId: root.id })),
    ).resolves.toMatchObject({ parentId: root.id });
  });

  it("does not allow opposite reparenting requests to create a cycle", async () => {
    const layer = freshLayer();
    const tenantId = await runService(layer, ({ tenants }) => seedTenant(tenants));
    const a = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "country",
        slug: "a",
        name: "A",
        parentId: null,
        tenantId,
      }),
    );
    const b = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "country",
        slug: "b",
        name: "B",
        parentId: null,
        tenantId,
      }),
    );
    const results = await Promise.allSettled([
      runService(layer, ({ nodes }) => nodes.update(a.id, { parentId: b.id })),
      runService(layer, ({ nodes }) => nodes.update(b.id, { parentId: a.id })),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const updatedA = await runService(layer, ({ nodes }) => nodes.getById(a.id));
    const updatedB = await runService(layer, ({ nodes }) => nodes.getById(b.id));
    expect(updatedA?.parentId === b.id && updatedB?.parentId === a.id).toBe(false);
  });

  it("creates and resolves a node by id", async () => {
    const layer = freshLayer();
    const tenantId = await runService(layer, ({ tenants }) => seedTenant(tenants));

    const node = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "country",
        slug: "usa",
        name: "United States",
        parentId: null,
        tenantId,
      }),
    );

    expect(node).toMatchObject({
      kind: "country",
      slug: "usa",
      name: "United States",
      parentId: null,
      tenantId,
      metadata: {},
    });
    expect(node.id).toEqual(expect.any(String));
    expect(node.createdAt).toEqual(expect.any(String));

    const resolved = await runService(layer, ({ nodes }) => nodes.getById(node.id));
    expect(resolved?.id).toBe(node.id);
  });

  it("persists metadata JSONB", async () => {
    const layer = freshLayer();
    const tenantId = await runService(layer, ({ tenants }) => seedTenant(tenants));

    const node = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "city",
        slug: "chicago",
        name: "Chicago",
        parentId: null,
        tenantId,
        metadata: { population: 2_700_000, region: "midwest" },
      }),
    );
    expect(node.metadata).toEqual({ kind: "city", population: 2_700_000, region: "midwest" });

    const updated = await runService(layer, ({ nodes }) =>
      nodes.update(node.id, { metadata: { population: 2_800_000 } }),
    );
    expect(updated.metadata).toEqual({ kind: "city", population: 2_800_000 });
  });

  it("treats an explicit kind argument as authoritative over metadata.kind", async () => {
    const layer = freshLayer();
    const tenantId = await runService(layer, ({ tenants }) => seedTenant(tenants));

    const node = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "org",
        slug: "kind-wins",
        name: "Kind Wins",
        parentId: null,
        tenantId,
        metadata: { kind: "user" },
      }),
    );
    expect(node.kind).toBe("org");
    expect(node.metadata).toEqual({ kind: "org" });

    const updated = await runService(layer, ({ nodes }) => nodes.update(node.id, { kind: "zone" }));
    expect(updated.kind).toBe("zone");
    expect(updated.metadata).toEqual({ kind: "zone" });

    const relabeled = await runService(layer, ({ nodes }) =>
      nodes.update(node.id, { metadata: { kind: "user" } }),
    );
    expect(relabeled.kind).toBe("user");
  });

  it("rejects an invalid slug", async () => {
    const layer = freshLayer();
    const tenantId = await runService(layer, ({ tenants }) => seedTenant(tenants));

    const error = await squashServiceError(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "city",
        slug: "Invalid Slug!",
        name: "Bad",
        parentId: null,
        tenantId,
      }),
    );
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");
  });

  it("fails with NOT_FOUND when creating with a missing tenant", async () => {
    const layer = freshLayer();

    const error = await squashServiceError(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "country",
        slug: "ghost",
        name: "Ghost",
        parentId: null,
        tenantId: MISSING_ID,
      }),
    );
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
  });

  it("fails with NOT_FOUND when parentId is set but the parent doesn't exist", async () => {
    const layer = freshLayer();
    const tenantId = await runService(layer, ({ tenants }) => seedTenant(tenants));

    const error = await squashServiceError(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "city",
        slug: "chicago",
        name: "Chicago",
        parentId: MISSING_ID,
        tenantId,
      }),
    );
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
  });

  it("rejects self-parent on update", async () => {
    const layer = freshLayer();
    const tenantId = await runService(layer, ({ tenants }) => seedTenant(tenants));
    const node = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "country",
        slug: "usa",
        name: "USA",
        parentId: null,
        tenantId,
      }),
    );

    const error = await squashServiceError(layer, ({ nodes }) =>
      nodes.update(node.id, { parentId: node.id }),
    );
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");
  });

  it("lists root nodes (parent_id IS NULL)", async () => {
    const layer = freshLayer();
    const tenantId = await runService(layer, ({ tenants }) => seedTenant(tenants));

    const usa = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "country",
        slug: "usa",
        name: "USA",
        parentId: null,
        tenantId,
      }),
    );
    await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "state",
        slug: "illinois",
        name: "Illinois",
        parentId: usa.id,
        tenantId,
      }),
    );

    const roots = await runService(layer, ({ nodes }) => nodes.listRootNodes);
    expect(roots.map((n) => n.slug)).toEqual(["usa"]);
  });

  it("lists node summaries with batched direct-child counts", async () => {
    const layer = freshLayer();
    const tenantId = await runService(layer, ({ tenants }) => seedTenant(tenants));
    const usa = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "country",
        slug: "usa",
        name: "USA",
        parentId: null,
        tenantId,
      }),
    );
    await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "state",
        slug: "illinois",
        name: "Illinois",
        parentId: usa.id,
        tenantId,
      }),
    );

    const summaries = await runService(layer, ({ nodes }) =>
      nodes.listSummaries({ parentId: null }),
    );

    expect(summaries).toEqual([
      {
        node: usa,
        childrenCount: 1,
        validatorCount: 0,
      },
    ]);
  });

  it("listChildren returns direct children only", async () => {
    const layer = freshLayer();
    const tenantId = await runService(layer, ({ tenants }) => seedTenant(tenants));

    const usa = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "country",
        slug: "usa",
        name: "USA",
        parentId: null,
        tenantId,
      }),
    );
    const illinois = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "state",
        slug: "illinois",
        name: "Illinois",
        parentId: usa.id,
        tenantId,
      }),
    );
    const chicago = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "city",
        slug: "chicago",
        name: "Chicago",
        parentId: illinois.id,
        tenantId,
      }),
    );

    const usaChildren = await runService(layer, ({ nodes }) => nodes.listChildren(usa.id));
    expect(usaChildren.map((n) => n.slug)).toEqual(["illinois"]);

    const illinoisChildren = await runService(layer, ({ nodes }) =>
      nodes.listChildren(illinois.id),
    );
    expect(illinoisChildren.map((n) => n.slug)).toEqual(["chicago"]);

    expect(chicago).toBeDefined();
  });

  it("resolveBySlug finds root and child nodes", async () => {
    const layer = freshLayer();
    const tenantId = await runService(layer, ({ tenants }) => seedTenant(tenants));

    const usa = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "country",
        slug: "usa",
        name: "USA",
        parentId: null,
        tenantId,
      }),
    );
    await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "state",
        slug: "illinois",
        name: "Illinois",
        parentId: usa.id,
        tenantId,
      }),
    );

    const root = await runService(layer, ({ nodes }) => nodes.resolveBySlug("usa", null));
    expect(root?.id).toBe(usa.id);

    const child = await runService(layer, ({ nodes }) => nodes.resolveBySlug("illinois", usa.id));
    expect(child?.parentId).toBe(usa.id);

    expect(
      await runService(layer, ({ nodes }) => nodes.resolveBySlug("illinois", null)),
    ).toBeNull();
  });

  it("deletes a node", async () => {
    const layer = freshLayer();
    const tenantId = await runService(layer, ({ tenants }) => seedTenant(tenants));
    const node = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "city",
        slug: "chicago",
        name: "Chicago",
        parentId: null,
        tenantId,
      }),
    );

    expect(await runService(layer, ({ nodes }) => nodes.delete(node.id))).toBe(true);
    expect(await runService(layer, ({ nodes }) => nodes.delete(node.id))).toBe(false);
    expect(await runService(layer, ({ nodes }) => nodes.getById(node.id))).toBeNull();
  });

  it("resolves unique child slugs, requires a parent for duplicates, and preserves root URLs", async () => {
    const layer = freshLayer();
    const tenantId = await runService(layer, ({ tenants }) => seedTenant(tenants));
    const firstParent = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "state",
        slug: "illinois",
        name: "Illinois",
        parentId: null,
        tenantId,
      }),
    );
    const secondParent = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "state",
        slug: "missouri",
        name: "Missouri",
        parentId: null,
        tenantId,
      }),
    );
    const firstChild = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "city",
        slug: "springfield",
        name: "Springfield",
        parentId: firstParent.id,
        tenantId,
      }),
    );
    expect((await runService(layer, ({ nodes }) => nodes.resolveBySlug("springfield")))?.id).toBe(
      firstChild.id,
    );

    const secondChild = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "city",
        slug: "springfield",
        name: "Springfield",
        parentId: secondParent.id,
        tenantId,
      }),
    );
    expect(await runService(layer, ({ nodes }) => nodes.resolveBySlug("springfield"))).toBeNull();
    expect(
      (await runService(layer, ({ nodes }) => nodes.resolveBySlug("springfield", firstParent.id)))
        ?.id,
    ).toBe(firstChild.id);
    expect(
      (await runService(layer, ({ nodes }) => nodes.resolveBySlug("springfield", secondParent.id)))
        ?.id,
    ).toBe(secondChild.id);
    expect(
      await runService(layer, ({ nodes }) => nodes.resolveBySlug("springfield", null)),
    ).toBeNull();

    const root = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "city",
        slug: "springfield",
        name: "Springfield",
        parentId: null,
        tenantId,
      }),
    );
    expect((await runService(layer, ({ nodes }) => nodes.resolveBySlug("springfield")))?.id).toBe(
      root.id,
    );
    expect(
      (await runService(layer, ({ nodes }) => nodes.resolveBySlug("springfield", secondParent.id)))
        ?.id,
    ).toBe(secondChild.id);
  });

  it("setBulletin merges into metadata without clobbering other keys", async () => {
    const layer = freshLayer();
    const tenantId = await runService(layer, ({ tenants }) => seedTenant(tenants));

    const node = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "city",
        slug: "chicago",
        name: "Chicago",
        parentId: null,
        tenantId,
        metadata: { poolAccountId: "chicago-pool.poolv1.near" },
      }),
    );

    const withBulletin = await runService(layer, ({ nodes }) =>
      nodes.setBulletin(node.id, "More features are coming soon."),
    );
    expect(withBulletin.metadata).toEqual({
      kind: "city",
      poolAccountId: "chicago-pool.poolv1.near",
      bulletin: "More features are coming soon.",
    });

    const cleared = await runService(layer, ({ nodes }) => nodes.setBulletin(node.id, null));
    expect(cleared.metadata).toEqual({
      kind: "city",
      poolAccountId: "chicago-pool.poolv1.near",
    });
  });

  it("setBulletin fails with NOT_FOUND for a missing node", async () => {
    const layer = freshLayer();

    const error = await squashServiceError(layer, ({ nodes }) =>
      nodes.setBulletin(MISSING_ID, "hi"),
    );
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
  });

  it("list filters by kind and parentId", async () => {
    const layer = freshLayer();
    const tenantId = await runService(layer, ({ tenants }) => seedTenant(tenants));

    const usa = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "country",
        slug: "usa",
        name: "USA",
        parentId: null,
        tenantId,
      }),
    );
    await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "state",
        slug: "illinois",
        name: "Illinois",
        parentId: usa.id,
        tenantId,
      }),
    );
    await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "state",
        slug: "ny",
        name: "New York",
        parentId: usa.id,
        tenantId,
      }),
    );

    const countries = await runService(layer, ({ nodes }) => nodes.list({ kind: "country" }));
    expect(countries.map((n) => n.slug)).toEqual(["usa"]);

    const statesUnderUsa = await runService(layer, ({ nodes }) =>
      nodes.list({ kind: "state", parentId: usa.id }),
    );
    expect(statesUnderUsa.map((n) => n.slug).sort()).toEqual(["illinois", "ny"]);
  });
});
