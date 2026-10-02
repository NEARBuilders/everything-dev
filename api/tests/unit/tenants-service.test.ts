import { resolveTxt } from "node:dns/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ORPCError } from "@orpc/server";
import { Effect, Layer } from "effect";
import { PluginIdTag } from "every-plugin";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseLive } from "@/db/layer";
import { TenantsLive, type TenantsService, TenantsTag } from "@/services/tenants";
import { createServiceHarness } from "./test-harness";

let activeDir: string | null = null;

vi.mock("node:dns/promises", () => ({ resolveTxt: vi.fn() }));

afterEach(() => {
  vi.resetAllMocks();
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

const { run: runService, squashError: squashServiceError } = createServiceHarness<
  TenantsService,
  TenantsTag
>(TenantsTag);

const baseInput = {
  name: "Acme Corp",
  accountId: "acme.example.near",
  orgId: "org-1",
};

describe("TenantsService", () => {
  it("creates and resolves a tenant by id", async () => {
    const layer = freshLayer();
    const created = await runService(layer, (svc) => svc.createTenant(baseInput));

    expect(created).toMatchObject({
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

  it("fails with CONFLICT when creating a duplicate accountId", async () => {
    const layer = freshLayer();
    await runService(layer, (svc) => svc.createTenant(baseInput));

    const error = await squashServiceError(layer, (svc) => svc.createTenant(baseInput));
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("CONFLICT");
  });

  it("resolves by accountId and orgId", async () => {
    const layer = freshLayer();
    const created = await runService(layer, (svc) => svc.createTenant(baseInput));

    const byAccount = await runService(layer, (svc) =>
      svc.resolveTenantByAccountId("acme.example.near"),
    );
    const byOrg = await runService(layer, (svc) => svc.resolveTenantByOrgId("org-1"));

    expect(byAccount?.id).toBe(created.id);
    expect(byOrg?.id).toBe(created.id);
  });

  it("returns null for unknown resolvers", async () => {
    const layer = freshLayer();
    expect(await runService(layer, (svc) => svc.resolveTenantById(MISSING_ID))).toBeNull();
    expect(await runService(layer, (svc) => svc.resolveTenantByAccountId("nope"))).toBeNull();
    expect(await runService(layer, (svc) => svc.resolveTenantByOrgId("nope"))).toBeNull();
  });

  it("lists tenants by orgId", async () => {
    const layer = freshLayer();
    await runService(layer, (svc) => svc.createTenant({ ...baseInput, orgId: "org-1" }));
    await runService(layer, (svc) =>
      svc.createTenant({
        ...baseInput,
        accountId: "beta.example.near",
        orgId: "org-2",
      }),
    );
    await runService(layer, (svc) =>
      svc.createTenant({
        ...baseInput,
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

  it("persists allow_* overrides on create and update", async () => {
    const layer = freshLayer();
    const created = await runService(layer, (svc) =>
      svc.createTenant({
        ...baseInput,
        allowUiOverrides: false,
        allowBackendOverrides: true,
        allowSsr: true,
      }),
    );
    expect(created).toMatchObject({
      allowUiOverrides: false,
      allowBackendOverrides: true,
      allowSsr: true,
    });

    const updated = await runService(layer, (svc) =>
      svc.updateTenant(created.id, { allowSsr: false }),
    );
    expect(updated.allowSsr).toBe(false);
    expect(updated.allowUiOverrides).toBe(false);
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

describe("TenantsService — domain bindings", () => {
  const tenantBase = {
    name: "Acme Corp",
    accountId: "acme.example.near",
    orgId: "org-1",
  };

  it("creates a binding with a unique verification token", async () => {
    const layer = freshLayer();
    const tenant = await runService(layer, (svc) => svc.createTenant(tenantBase));

    const binding = await runService(layer, (svc) =>
      svc.createBinding({
        tenantId: tenant.id,
        hostname: "acme.citynode.app",
        isPrimary: true,
      }),
    );

    expect(binding).toMatchObject({
      tenantId: tenant.id,
      hostname: "acme.citynode.app",
      isPrimary: true,
      isVerified: false,
    });
    expect(binding.verificationToken).toEqual(expect.any(String));
    expect(binding.verificationToken.length).toBeGreaterThan(0);
    expect(binding.verifiedAt).toBeNull();
  });

  it("fails with CONFLICT when creating a binding with a duplicate hostname", async () => {
    const layer = freshLayer();
    const tenant = await runService(layer, (svc) => svc.createTenant(tenantBase));
    await runService(layer, (svc) =>
      svc.createBinding({ tenantId: tenant.id, hostname: "acme.citynode.app" }),
    );

    const error = await squashServiceError(layer, (svc) =>
      svc.createBinding({ tenantId: tenant.id, hostname: "acme.citynode.app" }),
    );
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("CONFLICT");
  });

  it("supports multiple hostnames per tenant via listBindingsForTenant", async () => {
    const layer = freshLayer();
    const tenant = await runService(layer, (svc) => svc.createTenant(tenantBase));

    await runService(layer, (svc) =>
      svc.createBinding({ tenantId: tenant.id, hostname: "acme.citynode.app", isPrimary: true }),
    );
    await runService(layer, (svc) =>
      svc.createBinding({ tenantId: tenant.id, hostname: "www.acme.com" }),
    );
    await runService(layer, (svc) =>
      svc.createBinding({ tenantId: tenant.id, hostname: "acme.gov" }),
    );

    const bindings = await runService(layer, (svc) => svc.listBindingsForTenant(tenant.id));
    expect(bindings.map((b) => b.hostname).sort()).toEqual([
      "acme.citynode.app",
      "acme.gov",
      "www.acme.com",
    ]);
  });

  it("listBindings returns one row per hostname with tenant config", async () => {
    const layer = freshLayer();
    const tenant = await runService(layer, (svc) =>
      svc.createTenant({
        ...tenantBase,
        allowUiOverrides: false,
        allowBackendOverrides: true,
        allowSsr: true,
      }),
    );
    await runService(layer, (svc) =>
      svc.createBinding({ tenantId: tenant.id, hostname: "a", isPrimary: true }),
    );
    await runService(layer, (svc) => svc.createBinding({ tenantId: tenant.id, hostname: "b" }));

    const bindings = await runService(layer, (svc) => svc.listBindings);
    expect(bindings).toHaveLength(2);
    expect(bindings.find((b) => b.hostname === "a")).toMatchObject({
      tenantId: tenant.id,
      accountId: tenant.accountId,
      allowUiOverrides: false,
      allowBackendOverrides: true,
      allowSsr: true,
      status: "active",
    });
  });

  it("setPrimaryBinding demotes previous primary to false", async () => {
    const layer = freshLayer();
    const tenant = await runService(layer, (svc) => svc.createTenant(tenantBase));
    const a = await runService(layer, (svc) =>
      svc.createBinding({ tenantId: tenant.id, hostname: "a.citynode.app", isPrimary: true }),
    );
    const b = await runService(layer, (svc) =>
      svc.createBinding({ tenantId: tenant.id, hostname: "b.citynode.app" }),
    );

    const updated = await runService(layer, (svc) => svc.setPrimaryBinding(tenant.id, b.id));
    expect(updated.isPrimary).toBe(true);

    const bindings = await runService(layer, (svc) => svc.listBindingsForTenant(tenant.id));
    const primaryCount = bindings.filter((x) => x.isPrimary).length;
    expect(primaryCount).toBe(1);
    expect(bindings.find((x) => x.id === a.id)?.isPrimary).toBe(false);
    expect(bindings.find((x) => x.id === b.id)?.isPrimary).toBe(true);
  });

  it("activates a custom domain only after its exact TXT token is found", async () => {
    const layer = freshLayer();
    const tenant = await runService(layer, (svc) => svc.createTenant(tenantBase));
    const binding = await runService(layer, (svc) =>
      svc.createBinding({ tenantId: tenant.id, hostname: "acme.com" }),
    );

    expect(await runService(layer, (svc) => svc.listBindings)).toEqual([]);
    vi.mocked(resolveTxt).mockResolvedValue([
      ["unrelated-record"],
      ["everything-verify=", binding.verificationToken],
    ]);
    const verified = await runService(layer, (svc) =>
      svc.verifyCustomDomain(tenant.id, binding.id),
    );
    expect(verified.isVerified).toBe(true);
    expect(verified.verifiedAt).toEqual(expect.any(String));
    expect(resolveTxt).toHaveBeenCalledWith("acme.com");
    expect(await runService(layer, (svc) => svc.listBindings)).toMatchObject([
      { hostname: "acme.com" },
    ]);
  });

  it.each([
    "missing",
    "mismatch",
    "dns-failure",
  ])("leaves a custom domain unverified on %s", async (mode) => {
    const layer = freshLayer();
    const tenant = await runService(layer, (svc) => svc.createTenant(tenantBase));
    const binding = await runService(layer, (svc) =>
      svc.createBinding({ tenantId: tenant.id, hostname: "acme.com" }),
    );
    if (mode === "dns-failure")
      vi.mocked(resolveTxt).mockRejectedValue(new Error("DNS unavailable"));
    else
      vi.mocked(resolveTxt).mockResolvedValue(
        mode === "missing" ? [] : [["everything-verify=wrong"]],
      );
    const error = await squashServiceError(layer, (svc) =>
      svc.verifyCustomDomain(tenant.id, binding.id),
    );
    expect(error).toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await runService(layer, (svc) => svc.resolveBindingByHostname("acme.com")),
    ).toMatchObject({ isVerified: false, verifiedAt: null });
    expect(await runService(layer, (svc) => svc.listBindings)).toEqual([]);
  });

  it("activates a platform alias without querying DNS", async () => {
    const layer = freshLayer();
    const tenant = await runService(layer, (svc) => svc.createTenant(tenantBase));
    const binding = await runService(layer, (svc) =>
      svc.createBinding({ tenantId: tenant.id, hostname: "chicago" }),
    );
    expect(binding.isVerified).toBe(true);
    await runService(layer, (svc) => svc.verifyCustomDomain(tenant.id, binding.id));
    expect(resolveTxt).not.toHaveBeenCalled();
    expect(await runService(layer, (svc) => svc.listBindings)).toMatchObject([
      { hostname: "chicago" },
    ]);
  });

  it("scopes removal and verification to the owning tenant", async () => {
    const layer = freshLayer();
    const tenant = await runService(layer, (svc) => svc.createTenant(tenantBase));
    const binding = await runService(layer, (svc) =>
      svc.createBinding({ tenantId: tenant.id, hostname: "chicago" }),
    );
    expect(
      await squashServiceError(layer, (svc) => svc.deleteBinding(MISSING_ID, binding.id)),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(
      await squashServiceError(layer, (svc) => svc.verifyCustomDomain(MISSING_ID, binding.id)),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(
      await runService(layer, (svc) => svc.resolveBindingByHostname("chicago")),
    ).not.toBeNull();
    await runService(layer, (svc) => svc.deleteBinding(tenant.id, binding.id));
    expect(await runService(layer, (svc) => svc.resolveBindingByHostname("chicago"))).toBeNull();
    expect(await runService(layer, (svc) => svc.listBindings)).toEqual([]);
    expect(
      await squashServiceError(layer, (svc) => svc.deleteBinding(tenant.id, binding.id)),
    ).toMatchObject({ code: "NOT_FOUND" });
  });

  it("resolveBindingByHostname returns the binding for a hostname", async () => {
    const layer = freshLayer();
    const tenant = await runService(layer, (svc) => svc.createTenant(tenantBase));
    await runService(layer, (svc) =>
      svc.createBinding({ tenantId: tenant.id, hostname: "acme.com" }),
    );

    const found = await runService(layer, (svc) => svc.resolveBindingByHostname("acme.com"));
    expect(found?.tenantId).toBe(tenant.id);

    const missing = await runService(layer, (svc) => svc.resolveBindingByHostname("nope.com"));
    expect(missing).toBeNull();
  });
});
