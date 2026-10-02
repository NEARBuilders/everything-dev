// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RouterContext } from "@/app";
import { nodeQueryKeys } from "@/lib/queries/nodes";
import { tenantQueryKeys } from "@/lib/queries/tenants";
import { TenantDetailContent } from "./-tenant-detail";

const TENANT_ID = "00000000-0000-4000-8000-000000000071";
const GATEWAY_ID = "citynode.app";
const ORG_ID = "org-tenant-1";
const USER_ID = "user-tenant-1";

type TenantStatus = "active" | "pending" | "suspended" | "pending_deletion";
type MemberRole = "owner" | "admin" | "member";

type Tenant = {
  id: string;
  accountId: string;
  orgId: string;
  name: string;
  status: TenantStatus;
  ownerKind: "platform" | "dao";
  allowUiOverrides: boolean;
  allowBackendOverrides: boolean;
  allowSsr: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type Node = {
  id: string;
  parentId: string | null;
  tenantId: string;
  slug: string;
  name: string;
  kind: "country" | "state" | "city";
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type Binding = {
  id: string;
  tenantId: string;
  hostname: string;
  isPrimary: boolean;
  isVerified: boolean;
  verificationToken: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Harness = {
  apiClient: Record<string, (...args: never[]) => unknown>;
  auth: {
    getSession: ReturnType<typeof vi.fn>;
    organization: {
      list: ReturnType<typeof vi.fn>;
      listMembers: ReturnType<typeof vi.fn>;
    };
  };
  daoConnection: { status: "idle"; daoAccountId: null };
  nearAccount: string;
  publish: (...args: unknown[]) => unknown;
  navigate: (...args: unknown[]) => unknown;
  toast: {
    success: (...args: unknown[]) => unknown;
    error: (...args: unknown[]) => unknown;
    warning: (...args: unknown[]) => unknown;
  };
  events: string[];
  server: {
    tenant: Tenant;
    nodes: Node[];
    bindings: Binding[];
  };
};

const harness = vi.hoisted(() => ({ current: null as Harness | null }));

vi.mock("@/app", () => ({
  buildTenantUrl: (label: string, gatewayId: string) => `https://${label}.${gatewayId}`,
  getAccount: (config: { account?: string } | undefined) => config?.account ?? "every.near",
  getActiveRuntime: (config: { runtime?: unknown } | undefined) => config?.runtime,
  useApiClient: () => harness.current?.apiClient,
  useAuthClient: () => harness.current?.auth,
}));

vi.mock("@/components/connect-dao", () => ({
  ConnectDao: () => <div data-testid="connect-dao" />,
}));

vi.mock("@/lib/dao-connect", () => ({
  useDaoConnection: () => harness.current?.daoConnection,
}));

vi.mock("@/lib/tenant-deploy", () => ({
  publishTenantConfigForMode: (...args: unknown[]) => harness.current?.publish(...args),
}));

vi.mock("@/lib/use-near-account", () => ({
  useNearAccount: () => harness.current?.nearAccount ?? null,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="/dashboard">{children}</a>,
  useRouter: () => ({ navigate: (...args: unknown[]) => harness.current?.navigate(...args) }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => harness.current?.toast.success(...args),
    error: (...args: unknown[]) => harness.current?.toast.error(...args),
    warning: (...args: unknown[]) => harness.current?.toast.warning(...args),
  },
}));

vi.mock("../dashboard/node/-community-header", () => ({
  CommunityHeader: () => <div data-testid="community-header" />,
}));

vi.mock("./-node-validators", () => ({
  TenantNodeValidators: () => <div data-testid="tenant-node-validators" />,
}));

function makeTenant(status: TenantStatus = "active", name = "Original tenant"): Tenant {
  return {
    id: TENANT_ID,
    accountId: "tenant.near",
    orgId: ORG_ID,
    name,
    status,
    ownerKind: "platform",
    allowUiOverrides: true,
    allowBackendOverrides: false,
    allowSsr: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

function makeNode(slug = "original-node"): Node {
  return {
    id: "00000000-0000-4000-8000-000000000072",
    parentId: null,
    tenantId: TENANT_ID,
    slug,
    name: slug,
    kind: "city",
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeBinding(): Binding {
  return {
    id: "00000000-0000-4000-8000-000000000073",
    tenantId: TENANT_ID,
    hostname: "tenant.citynode.app",
    isPrimary: true,
    isVerified: true,
    verificationToken: "token",
    verifiedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createHarness({
  role = "owner",
  status = "active",
  publishError,
  updateError,
}: {
  role?: MemberRole;
  status?: TenantStatus;
  publishError?: Error;
  updateError?: Error;
} = {}): Harness {
  const events: string[] = [];
  const server = {
    tenant: makeTenant(status),
    nodes: [makeNode()],
    bindings: [makeBinding()],
  };
  const publish = vi.fn(async () => {
    events.push("publish");
    if (publishError) throw publishError;
  });
  const navigate = vi.fn(async () => {
    events.push("navigate");
  });
  const toast = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  };
  const auth = {
    getSession: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
    organization: {
      list: vi.fn(async () => ({ data: [{ id: ORG_ID, slug: "tenant-org" }], error: null })),
      listMembers: vi.fn(async () => ({
        data: { members: [{ userId: USER_ID, role }] },
        error: null,
      })),
    },
    near: {
      getGasKeyScope: vi.fn(async () => ({ data: { enabled: false }, error: null })),
      isGasKeyWalletSupported: vi.fn(async () => false),
      addSessionGasKey: vi.fn(async () => undefined),
      ensureGasKeyFunded: vi.fn(async () => false),
      refreshGasKeyInfo: vi.fn(async () => null),
    },
    $store: {
      atoms: {
        nearState: { get: () => null, set: () => {}, subscribe: () => () => {} },
        walletConnected: { get: () => false, set: () => {}, subscribe: () => () => {} },
        activeNetwork: { get: () => "mainnet", set: () => {}, subscribe: () => () => {} },
        gasKeyState: { get: () => null, set: () => {}, subscribe: () => () => {} },
      },
    },
  };

  const apiClient = {
    listTenants: vi.fn(async () => {
      events.push("listTenants");
      return [server.tenant];
    }),
    resolveBindingByHostname: vi.fn(async () => null),
    resolveNodeBySlug: vi.fn(async () => null),
    listNodes: vi.fn(async () => {
      events.push("listNodes");
      return server.nodes;
    }),
    listTenantBindingsForTenant: vi.fn(async () => server.bindings),
    updateTenant: vi.fn(async ({ name }: { tenantId: string; name: string }) => {
      events.push("updateTenant");
      if (updateError) throw updateError;
      server.tenant = { ...server.tenant, name, updatedAt: "2026-01-02T00:00:00.000Z" };
      server.nodes = [makeNode("updated-node")];
      return server.tenant;
    }),
    suspendTenant: vi.fn(async () => {
      events.push("suspendTenant");
      server.tenant = {
        ...server.tenant,
        status: "suspended",
        updatedAt: "2026-01-03T00:00:00.000Z",
      };
      server.nodes = [makeNode("suspended-node")];
      return server.tenant;
    }),
    reactivateTenant: vi.fn(async () => {
      events.push("reactivateTenant");
      server.tenant = {
        ...server.tenant,
        status: "active",
        updatedAt: "2026-01-04T00:00:00.000Z",
      };
      server.nodes = [makeNode("reactivated-node")];
      return server.tenant;
    }),
    deleteTenant: vi.fn(async () => {
      events.push("deleteTenant");
      server.tenant = {
        ...server.tenant,
        status: "pending_deletion",
        deletedAt: "2026-01-05T00:00:00.000Z",
      };
      server.nodes = [makeNode("pending-deletion-node")];
      return server.tenant;
    }),
  } as unknown as Harness["apiClient"];

  return {
    apiClient,
    auth,
    daoConnection: { status: "idle", daoAccountId: null },
    nearAccount: "wallet.near",
    publish,
    navigate,
    toast,
    events,
    server,
  };
}

const runtimeConfig: RouterContext["runtimeConfig"] = {
  env: "development",
  account: "base.near",
  networkId: "mainnet",
  assetsUrl: "http://localhost/assets",
  apiBase: "/api",
  rpcBase: "/api/rpc",
  hostUrl: "http://localhost",
  runtime: {
    accountId: "base.near",
    gatewayId: GATEWAY_ID,
    runtimeBasePath: "/",
    title: "City Nodes",
    description: "",
    hostUrl: "http://localhost",
  },
};

function renderTenant(current: Harness) {
  harness.current = current;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(tenantQueryKeys.byKey(TENANT_ID, GATEWAY_ID), current.server.tenant);
  queryClient.setQueryData(tenantQueryKeys.list(), [current.server.tenant]);
  queryClient.setQueryData(nodeQueryKeys.tenant(TENANT_ID), current.server.nodes);
  queryClient.setQueryData(tenantQueryKeys.bindings(TENANT_ID), current.server.bindings);
  queryClient.setQueryData(["organizations"], [{ id: ORG_ID, slug: "tenant-org" }]);
  queryClient.setQueryData(["session"], { user: { id: USER_ID } });

  render(
    <QueryClientProvider client={queryClient}>
      <TenantDetailContent tenantId={TENANT_ID} runtimeConfig={runtimeConfig} />
    </QueryClientProvider>,
  );
  return { queryClient };
}

async function confirmDelete() {
  fireEvent.click(await screen.findByRole("button", { name: "Delete community" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete community" }));
}

async function confirmSuspend() {
  fireEvent.click(await screen.findByRole("button", { name: "Suspend" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Suspend" }));
}

afterEach(() => {
  cleanup();
  harness.current = null;
  vi.clearAllMocks();
});

describe("tenant detail mutations", () => {
  it("refreshes pre-seeded tenant and node data after update, suspend, and reactivate", async () => {
    const current = createHarness();
    const { queryClient } = renderTenant(current);

    expect(await screen.findByText("Original tenant")).toBeTruthy();
    await waitFor(() =>
      expect(queryClient.getQueryData(nodeQueryKeys.tenant(TENANT_ID))).toEqual([
        expect.objectContaining({ slug: "original-node" }),
      ]),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Rename" }));
    const nameInput = screen.getByDisplayValue("Original tenant");
    fireEvent.change(nameInput, { target: { value: "Updated tenant" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(current.apiClient.updateTenant).toHaveBeenCalledOnce());
    expect(await screen.findByText("Updated tenant")).toBeTruthy();
    await waitFor(() =>
      expect(queryClient.getQueryData(nodeQueryKeys.tenant(TENANT_ID))).toEqual([
        expect.objectContaining({ slug: "updated-node" }),
      ]),
    );
    expect(current.publish).not.toHaveBeenCalled();

    await confirmSuspend();
    await waitFor(() => expect(current.apiClient.suspendTenant).toHaveBeenCalledOnce());
    expect(await screen.findByRole("button", { name: "Reactivate" })).toBeTruthy();
    await waitFor(() =>
      expect(queryClient.getQueryData(nodeQueryKeys.tenant(TENANT_ID))).toEqual([
        expect.objectContaining({ slug: "suspended-node" }),
      ]),
    );
    expect(current.publish).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }));
    await waitFor(() => expect(current.apiClient.reactivateTenant).toHaveBeenCalledOnce());
    expect(await screen.findByRole("button", { name: "Suspend" })).toBeTruthy();
    await waitFor(() =>
      expect(queryClient.getQueryData(nodeQueryKeys.tenant(TENANT_ID))).toEqual([
        expect.objectContaining({ slug: "reactivated-node" }),
      ]),
    );
    expect(current.publish).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(tenantQueryKeys.byKey(TENANT_ID, GATEWAY_ID))).toMatchObject({
      name: "Updated tenant",
      status: "active",
    });
    expect(queryClient.getQueryData(nodeQueryKeys.tenant(TENANT_ID))).toEqual([
      expect.objectContaining({ slug: "reactivated-node" }),
    ]);
  });

  it("refreshes persisted state and reports a partial success when suspension publication fails", async () => {
    const current = createHarness({ publishError: new Error("publisher unavailable") });
    const { queryClient } = renderTenant(current);

    await screen.findByText("Original tenant");
    await confirmSuspend();

    await waitFor(() => expect(current.apiClient.suspendTenant).toHaveBeenCalledOnce());
    expect(await screen.findByRole("button", { name: "Reactivate" })).toBeTruthy();
    expect(current.toast.error).toHaveBeenCalledWith(
      "Community suspended, but config publication failed: publisher unavailable",
    );
    expect(current.navigate).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(tenantQueryKeys.byKey(TENANT_ID, GATEWAY_ID))).toMatchObject({
      status: "suspended",
    });
  });

  it("refreshes a persisted soft delete before navigating", async () => {
    const current = createHarness();
    const { queryClient } = renderTenant(current);

    await screen.findByText("Original tenant");
    await confirmDelete();

    await waitFor(() => expect(current.navigate).toHaveBeenCalledWith({ to: "/" }));
    const navigateIndex = current.events.lastIndexOf("navigate");
    expect(navigateIndex).toBeGreaterThan(current.events.lastIndexOf("listTenants"));
    expect(navigateIndex).toBeGreaterThan(current.events.lastIndexOf("listNodes"));
    expect(queryClient.getQueryData(tenantQueryKeys.byKey(TENANT_ID, GATEWAY_ID))).toMatchObject({
      status: "pending_deletion",
    });
    expect(current.toast.success).toHaveBeenCalledWith("Community queued for deletion");
  });

  it("keeps a persisted soft delete visible when publication fails", async () => {
    const current = createHarness({ publishError: new Error("registry write failed") });
    const { queryClient } = renderTenant(current);

    await screen.findByText("Original tenant");
    await confirmDelete();

    await waitFor(() => expect(current.apiClient.deleteTenant).toHaveBeenCalledOnce());
    expect(current.toast.error).toHaveBeenCalledWith(
      "Community deletion saved, but config publication failed: registry write failed",
    );
    expect(current.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(queryClient.getQueryData(tenantQueryKeys.byKey(TENANT_ID, GATEWAY_ID))).toMatchObject({
      status: "pending_deletion",
    });
  });

  it("asks for confirmation before suspending", async () => {
    const current = createHarness();
    renderTenant(current);

    await screen.findByText("Original tenant");
    fireEvent.click(await screen.findByRole("button", { name: "Suspend" }));
    const dialog = await screen.findByRole("dialog");
    expect(current.apiClient.suspendTenant).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(current.apiClient.suspendTenant).not.toHaveBeenCalled();
  });

  it("does not publish when the database update fails", async () => {
    const current = createHarness({ updateError: new Error("database unavailable") });
    renderTenant(current);

    await screen.findByText("Original tenant");
    fireEvent.click(await screen.findByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByDisplayValue("Original tenant"), {
      target: { value: "Unavailable update" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(current.toast.error).toHaveBeenCalledWith("database unavailable"));
    expect(current.publish).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Unavailable update")).toBeTruthy();
  });

  it("does not expose owner edit or delete controls to a member", async () => {
    const current = createHarness({ role: "member" });
    renderTenant(current);

    await screen.findByText("Original tenant");
    await waitFor(() => expect(current.auth.organization.listMembers).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete community" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull();
    expect(screen.queryByTestId("tenant.danger-zone")).toBeNull();
  });
});
