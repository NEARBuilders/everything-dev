import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/app";
import { createTenantResources } from "./-tenant-creation";

const values = {
  kind: "city" as const,
  parentId: "state-1",
  name: "Chicago",
  slug: "chicago",
  tenantName: "Chicago City Node",
};

function api() {
  return {
    createTenant: vi.fn().mockResolvedValue({ id: "tenant-1" }),
    createNode: vi.fn().mockResolvedValue({ id: "node-1" }),
    createBinding: vi.fn().mockResolvedValue({ id: "binding-1" }),
    deleteNode: vi.fn().mockResolvedValue(undefined),
    deleteTenant: vi.fn().mockResolvedValue(undefined),
  };
}

describe("tenant creation orchestration", () => {
  it("creates tenant, node, and binding in order and enters the deploy phase", async () => {
    const client = api();
    const onStep = vi.fn();
    const onTenantCreated = vi.fn();

    const result = await createTenantResources({
      apiClient: client as unknown as ApiClient,
      values,
      daoAccountId: "dao.sputnik-dao.near",
      gatewayId: "citynode.app",
      onStep,
      onTenantCreated,
    });

    expect(result).toEqual({
      tenant: { id: "tenant-1" },
      node: { id: "node-1" },
      binding: { id: "binding-1" },
    });
    expect(client.createTenant).toHaveBeenCalledWith({
      name: values.tenantName,
      accountId: "dao.sputnik-dao.near",
      status: "active",
    });
    expect(client.createNode).toHaveBeenCalledWith({
      kind: values.kind,
      slug: values.slug,
      name: values.name,
      parentId: values.parentId,
      tenantId: "tenant-1",
    });
    expect(client.createBinding).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      hostname: "chicago.citynode.app",
      isPrimary: true,
    });
    expect(client.createTenant.mock.invocationCallOrder[0]).toBeLessThan(
      client.createNode.mock.invocationCallOrder[0],
    );
    expect(client.createNode.mock.invocationCallOrder[0]).toBeLessThan(
      client.createBinding.mock.invocationCallOrder[0],
    );
    expect(onStep).toHaveBeenNthCalledWith(1, "running");
    expect(onStep).toHaveBeenLastCalledWith("success");
    expect(onTenantCreated).toHaveBeenCalledWith("tenant-1");
  });

  it("rolls back created records when binding creation is rejected", async () => {
    const client = api();
    client.createBinding.mockRejectedValueOnce(new Error("binding rejected"));
    const onStep = vi.fn();

    await expect(
      createTenantResources({
        apiClient: client as unknown as ApiClient,
        values,
        daoAccountId: "dao.sputnik-dao.near",
        gatewayId: "citynode.app",
        onStep,
        onTenantCreated: vi.fn(),
      }),
    ).rejects.toThrow("binding rejected");

    expect(client.deleteNode).toHaveBeenCalledWith({ nodeId: "node-1" });
    expect(client.deleteTenant).toHaveBeenCalledWith({ tenantId: "tenant-1" });
    expect(client.deleteNode.mock.invocationCallOrder[0]).toBeLessThan(
      client.deleteTenant.mock.invocationCallOrder[0],
    );
    expect(onStep).toHaveBeenLastCalledWith("failed", "binding rejected");
  });

  it.each([
    "createTenant",
    "createNode",
  ] as const)("rolls back only completed resources when %s fails", async (failedStep) => {
    const client = api();
    client[failedStep].mockRejectedValueOnce(new Error("creation rejected"));
    const onTenantCreated = vi.fn();

    await expect(
      createTenantResources({
        apiClient: client as unknown as ApiClient,
        values,
        daoAccountId: "dao.sputnik-dao.near",
        gatewayId: "citynode.app",
        onStep: vi.fn(),
        onTenantCreated,
      }),
    ).rejects.toThrow("creation rejected");

    expect(client.createBinding).not.toHaveBeenCalled();
    expect(client.deleteNode).not.toHaveBeenCalled();
    expect(onTenantCreated).not.toHaveBeenCalled();
    if (failedStep === "createTenant") {
      expect(client.createNode).not.toHaveBeenCalled();
      expect(client.deleteTenant).not.toHaveBeenCalled();
    } else {
      expect(client.deleteTenant).toHaveBeenCalledWith({ tenantId: "tenant-1" });
    }
  });
});
