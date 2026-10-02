// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeStakeSection } from "./node-stake-section";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string;
    search?: { nodeId?: string };
    children?: ReactNode;
  }) => (
    <a href={search?.nodeId ? `${to}?nodeId=${search.nodeId}` : to} {...rest}>
      {children}
    </a>
  ),
}));

const node = {
  id: "state",
  name: "Illinois",
  slug: "illinois",
  kind: "state" as const,
  parentId: "country",
  tenantId: "tenant",
  metadata: {},
  createdAt: "2026-09-10",
  updatedAt: "2026-09-10",
};
const source = {
  ...node,
  id: "country",
  name: "USA",
  slug: "usa",
  kind: "country" as const,
  parentId: null,
};
const validator = {
  id: "validator",
  nodeId: "state",
  accountId: "pool.example",
  network: "mainnet",
  protocol: "other",
  role: "official" as const,
  isDefault: true,
  metadata: {},
  createdAt: "2026-09-10",
  updatedAt: "2026-09-10",
};
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

function show(props: Partial<ComponentProps<typeof NodeStakeSection>> = {}) {
  const client = new QueryClient();
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <NodeStakeSection
        node={node}
        children={[]}
        gateway="citynode.app"
        validators={[]}
        sourceNodeId={node.id}
        apiClient={{
          getNode: vi.fn().mockResolvedValue(source),
          getSubtree: vi.fn().mockResolvedValue([{ ...node, validators: [] }]),
        }}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("public node staking", () => {
  it("does not claim that an empty resolver result is an owned pool", () => {
    show();
    expect(screen.getByText("This node doesn't run a validator yet.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Stake to Illinois" })).toBeNull();
  });

  it("keeps the own stake link and shows every resolved pool, including grandchildren", () => {
    show({
      validators: [
        validator,
        { ...validator, id: "grandchild", nodeId: "grandchild", accountId: "grandchild.pool" },
      ],
    });
    expect(screen.getByRole("link", { name: "Stake to Illinois" }).getAttribute("href")).toBe(
      "/stake?nodeId=state",
    );
    expect(screen.getByRole("heading", { name: "pool.example" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "grandchild.pool" })).toBeTruthy();
  });

  it("names ancestor inheritance and keeps pools from multiple ancestors", async () => {
    show({
      validators: [
        { ...validator, nodeId: "country" },
        { ...validator, id: "ancestor-2", nodeId: "other-ancestor", accountId: "ancestor.pool" },
      ],
      sourceNodeId: "country",
    });
    expect(await screen.findByText(/Stake inherited from USA/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "ancestor.pool" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Stake to USA" }).getAttribute("href")).toBe(
      "/stake?nodeId=country",
    );
  });

  it("keeps child stake links and does not mislabel a child as an ancestor", async () => {
    const child = {
      ...node,
      id: "city",
      name: "Chicago",
      slug: "chicago",
      kind: "city" as const,
      parentId: "state",
    };
    show({
      children: [child],
      validators: [{ ...validator, nodeId: "city" }],
      sourceNodeId: "city",
      apiClient: {
        getNode: vi.fn().mockResolvedValue(child),
        getSubtree: vi.fn().mockResolvedValue([
          { ...node, validators: [] },
          { ...child, validators: [validator] },
        ]),
      },
    });
    expect(screen.getByRole("link", { name: /Chicago/ }).getAttribute("href")).toBe(
      "/stake?nodeId=city",
    );
    expect(await screen.findByText(/Pools across this node and its descendants/)).toBeTruthy();
    expect(screen.queryByText(/Stake inherited/)).toBeNull();
  });

  it("shows a grandchild-only pool even when no direct child owns a validator", async () => {
    const grandchild = {
      ...node,
      id: "grandchild",
      name: "Chicago",
      slug: "chicago",
      kind: "city" as const,
      parentId: "child",
    };
    show({
      children: [{ ...node, id: "child", parentId: node.id }],
      validators: [{ ...validator, nodeId: "grandchild" }],
      sourceNodeId: "grandchild",
      apiClient: {
        getNode: vi.fn().mockResolvedValue(grandchild),
        getSubtree: vi.fn().mockResolvedValue([
          { ...node, validators: [] },
          { ...grandchild, validators: [validator] },
        ]),
      },
    });
    expect(await screen.findByRole("link", { name: "Stake to Chicago" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "pool.example" })).toBeTruthy();
    expect(screen.queryByText(/Stake inherited/)).toBeNull();
    expect(screen.queryByText(/doesn't run a validator yet/)).toBeNull();
  });
});
