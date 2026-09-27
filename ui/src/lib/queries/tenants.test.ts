import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/app";
import {
  bindingPreflightQueryOptions,
  invalidateTenantQueries,
  tenantBindingsQueryOptions,
  tenantQueryKeys,
  tenantsQueryOptions,
} from "./tenants";

describe("tenant query options", () => {
  it("builds hierarchical tenant, binding, and preflight keys", () => {
    expect(tenantQueryKeys.list()).toEqual(["tenants", "list", "all"]);
    expect(tenantQueryKeys.bindings("tenant-1")).toEqual([
      "tenants",
      "detail",
      "id",
      "tenant-1",
      "bindings",
    ]);
    expect(tenantQueryKeys.preflight("chicago.citynode.app")).toEqual([
      "tenants",
      "binding-preflight",
      "chicago.citynode.app",
    ]);
    expect(tenantQueryKeys.preflight("chicago.citynode.app")).not.toEqual(
      tenantQueryKeys.preflight("boston.citynode.app"),
    );
  });

  it("delegates tenant, binding, and preflight queries to the API client", async () => {
    const listTenants = vi.fn().mockResolvedValue([]);
    const listTenantBindingsForTenant = vi.fn().mockResolvedValue([]);
    const bindingPreflight = vi.fn().mockResolvedValue({ hostname: { available: true } });
    const apiClient = {
      listTenants,
      listTenantBindingsForTenant,
      bindingPreflight,
    } as unknown as ApiClient;
    const queryClient = new QueryClient();

    await queryClient.fetchQuery(tenantsQueryOptions(apiClient));
    await queryClient.fetchQuery(tenantBindingsQueryOptions(apiClient, "tenant-1"));
    await queryClient.fetchQuery(bindingPreflightQueryOptions(apiClient, "chicago.citynode.app"));

    expect(listTenants).toHaveBeenCalledOnce();
    expect(listTenantBindingsForTenant).toHaveBeenCalledWith({ tenantId: "tenant-1" });
    expect(bindingPreflight).toHaveBeenCalledWith({ hostname: "chicago.citynode.app" });
  });

  it("keeps hostname preflight fresh for five seconds", () => {
    const apiClient = {} as ApiClient;
    expect(bindingPreflightQueryOptions(apiClient, "chicago.citynode.app").staleTime).toBe(5000);
  });

  it("invalidates every tenant query through the shared prefix", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(tenantQueryKeys.list(), []);
    queryClient.setQueryData(tenantQueryKeys.bindings("tenant-1"), []);
    queryClient.setQueryData(["unrelated"], true);

    await invalidateTenantQueries(queryClient);

    expect(queryClient.getQueryState(tenantQueryKeys.list())?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(tenantQueryKeys.bindings("tenant-1"))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(["unrelated"])?.isInvalidated).toBe(false);
  });
});
