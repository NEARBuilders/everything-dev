import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginIdTag } from "every-plugin";
import { Cause, Effect, Exit, Layer } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseLive } from "@/db/layer";
import { TenantsLive, type TenantsService, TenantsTag } from "@/services/tenants";

let activeDir: string | null = null;

afterEach(() => {
  if (activeDir) {
    rmSync(activeDir, { recursive: true, force: true });
    activeDir = null;
  }
});

function freshLayer() {
  const dir = mkdtempSync(join(tmpdir(), "api-tenants-"));
  activeDir = dir;
  return TenantsLive.pipe(
    Layer.provide(DatabaseLive(`pglite:${dir}`)),
    Layer.provide(Layer.succeed(PluginIdTag, "api")),
  );
}

const MISSING_ID = "00000000-0000-0000-0000-000000000000";

async function runService<A>(
  layer: Layer.Layer<TenantsService, unknown, never>,
  fn: (svc: TenantsService) => Promise<A>,
): Promise<A> {
  const effect = Effect.gen(function* () {
    const svc = yield* TenantsTag;
    return yield* Effect.tryPromise({ try: () => fn(svc), catch: (error) => error });
  });
  return Effect.runPromise(Effect.provide(effect, layer));
}

async function squashServiceError<A>(
  layer: Layer.Layer<TenantsService, unknown, never>,
  fn: (svc: TenantsService) => Promise<A>,
): Promise<unknown> {
  const effect = Effect.gen(function* () {
    const svc = yield* TenantsTag;
    return yield* Effect.tryPromise({ try: () => fn(svc), catch: (error) => error });
  });
  const exit = await Effect.runPromiseExit(Effect.provide(effect, layer));
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected effect to fail");
  }
  return Cause.squash(exit.cause);
}

const baseInput = {
  subdomain: "acme",
  name: "Acme Corp",
  accountId: "acme.example.near",
  orgId: "org-1",
};

describe("TenantsService", () => {
  it("creates and resolves a tenant by id", async () => {
    const layer = freshLayer();
    const created = await runService(layer, (svc) => svc.createTenant(baseInput));

    expect(created).toMatchObject({
      subdomain: "acme",
      accountId: "acme.example.near",
      orgId: "org-1",
      name: "Acme Corp",
      status: "active",
    });
    expect(created.id).toEqual(expect.any(String));
    expect(created.createdAt).toEqual(expect.any(String));
    expect(created.deletedAt).toBeNull();

    const resolved = await runService(layer, (svc) => svc.resolveTenantById(created.id));
    expect(resolved?.id).toBe(created.id);
  });

  it("fails with BAD_REQUEST when creating a duplicate", async () => {
    const layer = freshLayer();
    await runService(layer, (svc) => svc.createTenant(baseInput));

    const error = await squashServiceError(layer, (svc) => svc.createTenant(baseInput));
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");
  });

  it("resolves by accountId, subdomain, and orgId", async () => {
    const layer = freshLayer();
    const created = await runService(layer, (svc) => svc.createTenant(baseInput));

    const byAccount = await runService(layer, (svc) =>
      svc.resolveTenantByAccountId("acme.example.near"),
    );
    const bySubdomain = await runService(layer, (svc) => svc.resolveTenantBySubdomain("acme"));
    const byOrg = await runService(layer, (svc) => svc.resolveTenantByOrgId("org-1"));

    expect(byAccount?.id).toBe(created.id);
    expect(bySubdomain?.id).toBe(created.id);
    expect(byOrg?.id).toBe(created.id);
  });

  it("returns null for unknown resolvers", async () => {
    const layer = freshLayer();
    expect(await runService(layer, (svc) => svc.resolveTenantById(MISSING_ID))).toBeNull();
    expect(await runService(layer, (svc) => svc.resolveTenantByAccountId("nope"))).toBeNull();
    expect(await runService(layer, (svc) => svc.resolveTenantBySubdomain("nope"))).toBeNull();
    expect(await runService(layer, (svc) => svc.resolveTenantByOrgId("nope"))).toBeNull();
  });

  it("lists tenants by orgId", async () => {
    const layer = freshLayer();
    await runService(layer, (svc) => svc.createTenant({ ...baseInput, orgId: "org-1" }));
    await runService(layer, (svc) =>
      svc.createTenant({
        ...baseInput,
        subdomain: "beta",
        accountId: "beta.example.near",
        orgId: "org-2",
      }),
    );
    await runService(layer, (svc) =>
      svc.createTenant({
        ...baseInput,
        subdomain: "gamma",
        accountId: "gamma.example.near",
        orgId: "org-3",
      }),
    );

    const forOrg1 = await runService(layer, (svc) => svc.listTenantsByOrgIds(["org-1"]));
    expect(forOrg1.map((t) => t.orgId)).toEqual(["org-1"]);

    const forOrg2 = await runService(layer, (svc) => svc.listTenantsByOrgIds(["org-2"]));
    expect(forOrg2.map((t) => t.orgId)).toEqual(["org-2"]);

    const forAll = await runService(layer, (svc) =>
      svc.listTenantsByOrgIds(["org-1", "org-2", "org-3"]),
    );
    expect(forAll).toHaveLength(3);

    expect(await runService(layer, (svc) => svc.listTenantsByOrgIds([]))).toEqual([]);
  });

  it("updates a tenant name", async () => {
    const layer = freshLayer();
    const created = await runService(layer, (svc) => svc.createTenant(baseInput));

    const updated = await runService(layer, (svc) =>
      svc.updateTenant(created.id, { name: "Renamed Corp" }),
    );
    expect(updated.name).toBe("Renamed Corp");

    const fetched = await runService(layer, (svc) => svc.resolveTenantById(created.id));
    expect(fetched?.name).toBe("Renamed Corp");
  });

  it("fails with BAD_REQUEST when updating to a conflicting subdomain", async () => {
    const layer = freshLayer();
    await runService(layer, (svc) => svc.createTenant(baseInput));
    const other = await runService(layer, (svc) =>
      svc.createTenant({
        ...baseInput,
        subdomain: "beta",
        accountId: "beta.example.near",
        orgId: "org-2",
      }),
    );

    const error = await squashServiceError(layer, (svc) =>
      svc.updateTenant(other.id, { subdomain: "acme" }),
    );
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");
  });

  it("fails with NOT_FOUND when updating a missing tenant", async () => {
    const layer = freshLayer();
    const error = await squashServiceError(layer, (svc) =>
      svc.updateTenant(MISSING_ID, { name: "x" }),
    );
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
  });

  it("soft-deletes and reactivates a tenant", async () => {
    const layer = freshLayer();
    const created = await runService(layer, (svc) => svc.createTenant(baseInput));

    const suspended = await runService(layer, (svc) => svc.suspendTenant(created.id));
    expect(suspended?.status).toBe("suspended");

    const reactivated = await runService(layer, (svc) => svc.reactivateTenant(created.id));
    expect(reactivated?.status).toBe("active");

    const deleted = await runService(layer, (svc) => svc.softDeleteTenant(created.id));
    expect(deleted).not.toBeNull();
    expect(deleted?.status).toBe("pending_deletion");
    expect(deleted?.deletedAt).toEqual(expect.any(String));
  });

  it("returns null for status transitions on a missing tenant", async () => {
    const layer = freshLayer();
    expect(await runService(layer, (svc) => svc.suspendTenant(MISSING_ID))).toBeNull();
    expect(await runService(layer, (svc) => svc.reactivateTenant(MISSING_ID))).toBeNull();
    expect(await runService(layer, (svc) => svc.softDeleteTenant(MISSING_ID))).toBeNull();
  });

  it("hard-deletes a tenant and reports existence", async () => {
    const layer = freshLayer();
    const created = await runService(layer, (svc) => svc.createTenant(baseInput));

    expect(await runService(layer, (svc) => svc.deleteTenantById(created.id))).toBe(true);
    expect(await runService(layer, (svc) => svc.deleteTenantById(created.id))).toBe(false);
    expect(await runService(layer, (svc) => svc.resolveTenantById(created.id))).toBeNull();
  });
});
