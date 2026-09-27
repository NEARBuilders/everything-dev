import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/app";
import {
  adminNodeListQueryOptions,
  childNodesQueryOptions,
  invalidateNodeQueries,
  nodeQueryKeys,
  rootNodesQueryOptions,
  tenantNodesQueryOptions,
} from "./nodes";

describe("node query options", () => {
  it("builds hierarchical, parameter-specific keys", () => {
    expect(nodeQueryKeys.roots()).toEqual(["nodes", "list", "roots"]);
    expect(nodeQueryKeys.children("country-1")).toEqual(["nodes", "list", "children", "country-1"]);
    expect(nodeQueryKeys.children("country-2")).not.toEqual(nodeQueryKeys.children("country-1"));
    expect(nodeQueryKeys.tenant("tenant-1")).toEqual(["nodes", "list", "tenant", "tenant-1"]);
    expect(nodeQueryKeys.bySlug("chicago", null)).not.toEqual(nodeQueryKeys.bySlug("chicago"));
  });

  it("delegates root, child, and tenant lists to the API client", async () => {
    const listRootNodes = vi.fn().mockResolvedValue([]);
    const listChildren = vi.fn().mockResolvedValue([]);
    const listNodes = vi.fn().mockResolvedValue([]);
    const apiClient = { listRootNodes, listChildren, listNodes } as unknown as ApiClient;
    const queryClient = new QueryClient();

    await queryClient.fetchQuery(rootNodesQueryOptions(apiClient));
    await queryClient.fetchQuery(childNodesQueryOptions(apiClient, "country-1"));
    await queryClient.fetchQuery(tenantNodesQueryOptions(apiClient, "tenant-1"));

    expect(listRootNodes).toHaveBeenCalledOnce();
    expect(listChildren).toHaveBeenCalledWith({ nodeId: "country-1" });
    expect(listNodes).toHaveBeenCalledWith({ tenantId: "tenant-1" });
  });

  it("loads admin rows with one batched summary request keyed by scope and kind", async () => {
    const root = {
      id: "country-1",
      kind: "country" as const,
      slug: "pakistan",
      name: "Pakistan",
      parentId: null,
      tenantId: "tenant-1",
      metadata: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const listNodeSummaries = vi
      .fn()
      .mockResolvedValue([{ node: root, childrenCount: 2, validatorCount: 1 }]);
    const listNodes = vi.fn().mockResolvedValue([root]);
    const listTenants = vi.fn().mockResolvedValue([{ id: "tenant-1", status: "active" }]);
    const getNodeSummary = vi.fn();
    const apiClient = {
      listNodeSummaries,
      listNodes,
      listTenants,
      getNodeSummary,
    } as unknown as ApiClient;
    const queryClient = new QueryClient();

    const rows = await queryClient.fetchQuery(
      adminNodeListQueryOptions(apiClient, "roots", "country"),
    );

    expect(nodeQueryKeys.adminList("roots", "country")).toEqual([
      "nodes",
      "list",
      "admin",
      "roots",
      "country",
    ]);
    expect(listNodeSummaries).toHaveBeenCalledOnce();
    expect(listNodeSummaries).toHaveBeenCalledWith({ scope: "roots", kind: "country" });
    expect(getNodeSummary).not.toHaveBeenCalled();
    expect(rows).toEqual([
      {
        node: root,
        parent: undefined,
        status: "active",
        childrenCount: 2,
        validatorCount: 1,
      },
    ]);
  });

  it("invalidates every node query through the shared prefix", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(nodeQueryKeys.roots(), []);
    queryClient.setQueryData(nodeQueryKeys.children("country-1"), []);
    queryClient.setQueryData(["unrelated"], true);

    await invalidateNodeQueries(queryClient);

    expect(queryClient.getQueryState(nodeQueryKeys.roots())?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(nodeQueryKeys.children("country-1"))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(["unrelated"])?.isInvalidated).toBe(false);
  });
});
