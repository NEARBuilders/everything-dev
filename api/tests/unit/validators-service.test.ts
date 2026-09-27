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
import { ValidatorsLive, type ValidatorsService, ValidatorsTag } from "@/services/validators";
import { createServiceHarness } from "./test-harness";

let activeDir: string | null = null;

afterEach(() => {
  if (activeDir) {
    rmSync(activeDir, { recursive: true, force: true });
    activeDir = null;
  }
});

function freshLayer() {
  const dir = mkdtempSync(join(tmpdir(), "api-validators-"));
  activeDir = dir;
  const database = DatabaseLive(`pglite:${dir}`);
  return Layer.mergeAll(
    NodesLive.pipe(Layer.provide(database)),
    TenantsLive.pipe(Layer.provide(database)),
    ValidatorsLive.pipe(Layer.provide(database)),
  ).pipe(Layer.provide(Layer.succeed(PluginIdTag, "api")));
}

interface TestServices {
  nodes: NodesService;
  tenants: TenantsService;
  validators: ValidatorsService;
}

const { run: runService, squashError: squashServiceError } = createServiceHarness<
  TestServices,
  NodesTag | TenantsTag | ValidatorsTag
>(
  Effect.gen(function* () {
    return {
      nodes: yield* NodesTag,
      tenants: yield* TenantsTag,
      validators: yield* ValidatorsTag,
    };
  }),
);

describe("ValidatorsService", () => {
  function setupTenantAndNode(svc: TestServices) {
    return Effect.gen(function* () {
      const tenant = yield* svc.tenants.createTenant({
        name: "Test Tenant",
        accountId: "test.example.near",
        orgId: "org-1",
      });
      const node = yield* svc.nodes.spawn({
        kind: "city",
        slug: "test-city",
        name: "Test City",
        parentId: null,
        tenantId: tenant.id,
      });
      return node.id;
    });
  }

  it("retains the default validator when a replacement cannot be persisted", async () => {
    await runService(freshLayer(), (svc) =>
      Effect.gen(function* () {
        const nodeId = yield* setupTenantAndNode(svc);
        const original = yield* svc.validators.create({
          nodeId,
          accountId: "original.pool",
          isDefault: true,
        });
        const replacement = yield* svc.validators.create({ nodeId, accountId: "replacement.pool" });
        const metadata = { cannotSerialize: 1n };
        yield* Effect.flip(
          svc.validators.create({ nodeId, accountId: "failed.pool", isDefault: true, metadata }),
        );
        expect((yield* svc.validators.getById(original.id))?.isDefault).toBe(true);
        yield* Effect.flip(svc.validators.update(replacement.id, { isDefault: true, metadata }));
        expect((yield* svc.validators.getById(original.id))?.isDefault).toBe(true);
        expect((yield* svc.validators.getById(replacement.id))?.isDefault).toBe(false);
      }),
    );
  });

  it("creates a validator with defaults", async () => {
    const layer = freshLayer();
    const nodeId = await runService(layer, setupTenantAndNode);

    const validator = await runService(layer, ({ validators }) =>
      validators.create({ nodeId, accountId: "validator1.near" }),
    );

    expect(validator).toMatchObject({
      nodeId,
      accountId: "validator1.near",
      network: "mainnet",
      protocol: "near",
      role: "official",
      isDefault: false,
      metadata: {},
    });
    expect(validator.id).toEqual(expect.any(String));
  });

  it("fails with NOT_FOUND when the node doesn't exist", async () => {
    const layer = freshLayer();
    const error = await squashServiceError(layer, ({ validators }) =>
      validators.create({
        nodeId: "00000000-0000-0000-0000-000000000000",
        accountId: "validator1.near",
      }),
    );
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
  });

  it("supports multiple validators per node and lists them", async () => {
    const layer = freshLayer();
    const nodeId = await runService(layer, setupTenantAndNode);

    await runService(layer, ({ validators }) =>
      validators.create({ nodeId, accountId: "v1.near" }),
    );
    await runService(layer, ({ validators }) =>
      validators.create({ nodeId, accountId: "v2.near", role: "community" }),
    );

    const all = await runService(layer, ({ validators }) => validators.listByNode(nodeId));
    expect(all).toHaveLength(2);
    expect(all.map((v) => v.accountId).sort()).toEqual(["v1.near", "v2.near"]);
  });

  it("list filters by nodeId and role", async () => {
    const layer = freshLayer();
    const tenant = await runService(layer, ({ tenants }) =>
      tenants.createTenant({
        name: "Test Tenant",
        accountId: "test.example.near",
        orgId: "org-1",
      }),
    );
    const nodeA = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "city",
        slug: "city-a",
        name: "City A",
        parentId: null,
        tenantId: tenant.id,
      }),
    );
    const nodeB = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "city",
        slug: "city-b",
        name: "City B",
        parentId: null,
        tenantId: tenant.id,
      }),
    );

    await runService(layer, ({ validators }) =>
      validators.create({ nodeId: nodeA.id, accountId: "v1.near" }),
    );
    await runService(layer, ({ validators }) =>
      validators.create({ nodeId: nodeB.id, accountId: "v2.near", role: "community" }),
    );

    const forNodeA = await runService(layer, ({ validators }) =>
      validators.list({ nodeId: nodeA.id }),
    );
    expect(forNodeA).toHaveLength(1);
    expect(forNodeA[0]?.accountId).toBe("v1.near");

    const communities = await runService(layer, ({ validators }) =>
      validators.list({ role: "community" }),
    );
    expect(communities).toHaveLength(1);
    expect(communities[0]?.accountId).toBe("v2.near");
  });

  it("getById and resolveByAccountId return matching validators", async () => {
    const layer = freshLayer();
    const nodeId = await runService(layer, setupTenantAndNode);
    const created = await runService(layer, ({ validators }) =>
      validators.create({ nodeId, accountId: "vlookup.near" }),
    );

    const byId = await runService(layer, ({ validators }) => validators.getById(created.id));
    expect(byId?.id).toBe(created.id);

    const byAccount = await runService(layer, ({ validators }) =>
      validators.resolveByAccountId("vlookup.near"),
    );
    expect(byAccount?.id).toBe(created.id);
  });

  it("setDefault enforces exactly one default per node", async () => {
    const layer = freshLayer();
    const nodeId = await runService(layer, setupTenantAndNode);

    const v1 = await runService(layer, ({ validators }) =>
      validators.create({ nodeId, accountId: "v1.near", isDefault: true }),
    );
    const v2 = await runService(layer, ({ validators }) =>
      validators.create({ nodeId, accountId: "v2.near" }),
    );

    expect(v1.isDefault).toBe(true);

    await runService(layer, ({ validators }) => validators.setDefault(nodeId, v2.id));

    const refreshed = await runService(layer, ({ validators }) => validators.listByNode(nodeId));
    const defaults = refreshed.filter((v) => v.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe(v2.id);
  });

  it("setDefault fails with NOT_FOUND when validator doesn't belong to node", async () => {
    const layer = freshLayer();
    const tenant = await runService(layer, ({ tenants }) =>
      tenants.createTenant({
        name: "Test Tenant",
        accountId: "test.example.near",
        orgId: "org-1",
      }),
    );
    const nodeA = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "city",
        slug: "city-a",
        name: "City A",
        parentId: null,
        tenantId: tenant.id,
      }),
    );
    const nodeB = await runService(layer, ({ nodes }) =>
      nodes.spawn({
        kind: "city",
        slug: "city-b",
        name: "City B",
        parentId: null,
        tenantId: tenant.id,
      }),
    );
    const v = await runService(layer, ({ validators }) =>
      validators.create({ nodeId: nodeA.id, accountId: "v1.near" }),
    );

    const error = await squashServiceError(layer, ({ validators }) =>
      validators.setDefault(nodeB.id, v.id),
    );
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
  });

  it("create with isDefault demotes any existing default for the same node", async () => {
    const layer = freshLayer();
    const nodeId = await runService(layer, setupTenantAndNode);

    const first = await runService(layer, ({ validators }) =>
      validators.create({ nodeId, accountId: "v1.near", isDefault: true }),
    );
    const second = await runService(layer, ({ validators }) =>
      validators.create({ nodeId, accountId: "v2.near", isDefault: true }),
    );

    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(true);

    const refreshed = await runService(layer, ({ validators }) => validators.getById(first.id));
    expect(refreshed?.isDefault).toBe(false);
  });

  it("update mutates fields and keeps isDefault isolation", async () => {
    const layer = freshLayer();
    const nodeId = await runService(layer, setupTenantAndNode);

    const v1 = await runService(layer, ({ validators }) =>
      validators.create({ nodeId, accountId: "v1.near", isDefault: true }),
    );
    const v2 = await runService(layer, ({ validators }) =>
      validators.create({ nodeId, accountId: "v2.near" }),
    );

    const updated = await runService(layer, ({ validators }) =>
      validators.update(v2.id, {
        role: "community",
        isDefault: true,
        metadata: { region: "us-east" },
      }),
    );

    expect(updated.role).toBe("community");
    expect(updated.isDefault).toBe(true);
    expect(updated.metadata).toEqual({ region: "us-east" });

    const refreshedV1 = await runService(layer, ({ validators }) => validators.getById(v1.id));
    expect(refreshedV1?.isDefault).toBe(false);
  });

  it("delete removes the validator", async () => {
    const layer = freshLayer();
    const nodeId = await runService(layer, setupTenantAndNode);
    const v = await runService(layer, ({ validators }) =>
      validators.create({ nodeId, accountId: "vdel.near" }),
    );

    const ok = await runService(layer, ({ validators }) => validators.delete(v.id));
    expect(ok).toBe(true);

    const fetched = await runService(layer, ({ validators }) => validators.getById(v.id));
    expect(fetched).toBeNull();
  });

  describe("resolveForStaking", () => {
    it("returns subtree validators preferring the local node", async () => {
      const layer = freshLayer();
      const tenant = await runService(layer, ({ tenants }) =>
        tenants.createTenant({
          name: "Test Tenant",
          accountId: "test.example.near",
          orgId: "org-1",
        }),
      );
      const country = await runService(layer, ({ nodes }) =>
        nodes.spawn({
          kind: "country",
          slug: "testland",
          name: "Testland",
          parentId: null,
          tenantId: tenant.id,
        }),
      );
      const state = await runService(layer, ({ nodes }) =>
        nodes.spawn({
          kind: "state",
          slug: "north",
          name: "North",
          parentId: country.id,
          tenantId: tenant.id,
        }),
      );
      const city = await runService(layer, ({ nodes }) =>
        nodes.spawn({
          kind: "city",
          slug: "alpha",
          name: "Alpha",
          parentId: state.id,
          tenantId: tenant.id,
        }),
      );

      await runService(layer, ({ validators }) =>
        validators.create({ nodeId: country.id, accountId: "validator1.near" }),
      );

      const result = await runService(layer, ({ validators }) =>
        validators.resolveForStaking(city.id),
      );

      expect(result.sourceNodeId).toBe(country.id);
      expect(result.validators.map((v) => v.accountId)).toEqual(["validator1.near"]);
    });

    it("walks up to ancestors when subtree has no validators", async () => {
      const layer = freshLayer();
      const tenant = await runService(layer, ({ tenants }) =>
        tenants.createTenant({
          name: "Test Tenant",
          accountId: "test.example.near",
          orgId: "org-1",
        }),
      );
      const country = await runService(layer, ({ nodes }) =>
        nodes.spawn({
          kind: "country",
          slug: "testland",
          name: "Testland",
          parentId: null,
          tenantId: tenant.id,
        }),
      );
      const state = await runService(layer, ({ nodes }) =>
        nodes.spawn({
          kind: "state",
          slug: "north",
          name: "North",
          parentId: country.id,
          tenantId: tenant.id,
        }),
      );
      const city = await runService(layer, ({ nodes }) =>
        nodes.spawn({
          kind: "city",
          slug: "alpha",
          name: "Alpha",
          parentId: state.id,
          tenantId: tenant.id,
        }),
      );
      await runService(layer, ({ validators }) =>
        validators.create({ nodeId: state.id, accountId: "valState.near" }),
      );

      const result = await runService(layer, ({ validators }) =>
        validators.resolveForStaking(city.id),
      );

      expect(result.sourceNodeId).toBe(state.id);
      expect(result.validators.map((v) => v.accountId)).toEqual(["valState.near"]);
    });

    it("returns empty when neither subtree nor ancestors have validators", async () => {
      const layer = freshLayer();
      const tenant = await runService(layer, ({ tenants }) =>
        tenants.createTenant({
          name: "Test Tenant",
          accountId: "test.example.near",
          orgId: "org-1",
        }),
      );
      const city = await runService(layer, ({ nodes }) =>
        nodes.spawn({
          kind: "city",
          slug: "alpha",
          name: "Alpha",
          parentId: null,
          tenantId: tenant.id,
        }),
      );

      const result = await runService(layer, ({ validators }) =>
        validators.resolveForStaking(city.id),
      );

      expect(result.validators).toEqual([]);
      expect(result.sourceNodeId).toBe(city.id);
    });

    it("prefers the local node when it has its own validators", async () => {
      const layer = freshLayer();
      const tenant = await runService(layer, ({ tenants }) =>
        tenants.createTenant({
          name: "Test Tenant",
          accountId: "test.example.near",
          orgId: "org-1",
        }),
      );
      const country = await runService(layer, ({ nodes }) =>
        nodes.spawn({
          kind: "country",
          slug: "testland",
          name: "Testland",
          parentId: null,
          tenantId: tenant.id,
        }),
      );
      const state = await runService(layer, ({ nodes }) =>
        nodes.spawn({
          kind: "state",
          slug: "north",
          name: "North",
          parentId: country.id,
          tenantId: tenant.id,
        }),
      );
      await runService(layer, ({ validators }) =>
        validators.create({
          nodeId: country.id,
          accountId: "country-validator.near",
        }),
      );
      await runService(layer, ({ validators }) =>
        validators.create({
          nodeId: state.id,
          accountId: "state-validator.near",
        }),
      );

      const result = await runService(layer, ({ validators }) =>
        validators.resolveForStaking(state.id),
      );

      expect(result.sourceNodeId).toBe(state.id);
      expect(result.validators.map((v) => v.accountId)).toEqual(["state-validator.near"]);
    });

    it("fails with NOT_FOUND when the node does not exist", async () => {
      const layer = freshLayer();
      const error = await squashServiceError(layer, ({ validators }) =>
        validators.resolveForStaking("00000000-0000-0000-0000-000000000000"),
      );
      expect(error).toBeInstanceOf(ORPCError);
      expect((error as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
    });
  });
});
