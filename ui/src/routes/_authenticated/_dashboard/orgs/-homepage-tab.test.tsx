// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Near } from "near-kit";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomepageTab } from "./-homepage-tab";

const harness = vi.hoisted(() => ({
  nearAccount: null as string | null,
  authNear: { ensureConnected: vi.fn(), getAccountId: vi.fn(), getNearClient: vi.fn() },
  resolveTenantByOrgId: vi.fn(),
  listTenantBindingsForTenant: vi.fn(),
  getRegistryApp: vi.fn(),
  updateTenant: vi.fn(),
  activeNetwork: "mainnet",
  proposeTenantConfigAsMember: vi.fn(),
  publishTenantConfigForMode: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/app", async () => {
  const actual = await vi.importActual<typeof import("@/app")>("@/app");
  return {
    ...actual,
    useApiClient: () => ({
      resolveTenantByOrgId: harness.resolveTenantByOrgId,
      listTenantBindingsForTenant: harness.listTenantBindingsForTenant,
      registry: { getRegistryApp: harness.getRegistryApp },
      updateTenant: harness.updateTenant,
    }),
    useAuthClient: () => ({
      near: harness.authNear,
      useActiveNetwork: () => harness.activeNetwork,
    }),
  };
});

vi.mock("@/lib/use-near-account", () => ({ useNearAccount: () => harness.nearAccount }));

vi.mock("@/lib/tenant-deploy", () => ({
  proposeTenantConfigAsMember: (...args: unknown[]) => harness.proposeTenantConfigAsMember(...args),
  publishTenantConfigForMode: (...args: unknown[]) => harness.publishTenantConfigForMode(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => harness.toastError(...args),
    success: (...args: unknown[]) => harness.toastSuccess(...args),
  },
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    Link: ({ children }: { children?: ReactNode }) => <a href="/tenant">{children}</a>,
  };
});

const DAO = "chicago.sputnik-dao.near";

function policy(members: string[], permissions = ["*:AddProposal", "*:VoteApprove"]) {
  return {
    roles: [{ name: "council", kind: { Group: members }, permissions, vote_policy: {} }],
    default_vote_policy: { threshold: [1, 2] },
  };
}

const pendingProposal = {
  id: 7,
  proposer: "alice.near",
  description: "Set homepage",
  kind: {
    FunctionCall: {
      receiver_id: "dev.everything.near",
      actions: [{ method_name: "__fastdata_kv", args: "e30=", deposit: "0", gas: "1" }],
    },
  },
  status: "InProgress",
  vote_counts: { council: ["1", "0", "0"] },
  votes: {},
  submission_time: "0",
};

function mockChain(options: { policy: unknown; proposals?: unknown[] }) {
  vi.spyOn(Near.prototype, "view").mockImplementation((async (
    _contract: string,
    method: string,
  ) => {
    if (method === "get_policy") return options.policy;
    if (method === "get_last_proposal_id") return options.proposals?.length ? 7 : 0;
    if (method === "get_proposals") return options.proposals ?? [];
    return null;
  }) as never);
}

function mockTenant(overrides: Record<string, unknown> = {}) {
  harness.resolveTenantByOrgId.mockResolvedValue({
    id: "tenant-1",
    name: "Chicago Node",
    accountId: DAO,
    ownerKind: "dao",
    status: "active",
    allowUiOverrides: true,
    allowSsr: false,
    ...overrides,
  });
  harness.listTenantBindingsForTenant.mockResolvedValue([
    { hostname: "chicago.citynode.app", isPrimary: true },
  ]);
  harness.getRegistryApp.mockResolvedValue({
    data: { resolvedConfig: { title: "Chicago Node", description: "Chicago builders" } },
  });
}

function renderTab(canManage = true, isActive = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <HomepageTab
        orgId="org-1"
        gatewayId="citynode.app"
        baseAccount="v1.citynode.near"
        canManage={canManage}
        isActive={isActive}
      />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

async function editTitle(value: string) {
  const title = (await screen.findByTestId("orgs-homepage-title")) as HTMLInputElement;
  await waitFor(() => expect(title.value).toBe("Chicago Node"));
  fireEvent.change(title, { target: { value } });
}

beforeEach(() => {
  harness.nearAccount = "alice.near";
  harness.activeNetwork = "mainnet";
  harness.updateTenant.mockResolvedValue({});
  harness.proposeTenantConfigAsMember.mockResolvedValue({});
  harness.publishTenantConfigForMode.mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("HomepageTab", () => {
  it("stages a DAO proposal with the session wallet", async () => {
    mockTenant();
    mockChain({ policy: policy(["alice.near"]) });
    renderTab();

    await editTitle("Chicago Builders");
    const propose = screen.getByTestId("orgs-homepage-propose") as HTMLButtonElement;
    await waitFor(() => expect(propose.disabled).toBe(false));
    fireEvent.click(propose);

    await waitFor(() => expect(harness.proposeTenantConfigAsMember).toHaveBeenCalledTimes(1));
    expect(harness.proposeTenantConfigAsMember).toHaveBeenCalledWith(
      expect.anything(),
      harness.authNear,
      {
        daoAccountId: "chicago.sputnik-dao.near",
        gatewayId: "citynode.app",
        baseAccount: "v1.citynode.near",
        hostname: "chicago.citynode.app",
        title: "Chicago Builders",
        description: "Chicago builders",
      },
    );
    expect(harness.publishTenantConfigForMode).not.toHaveBeenCalled();
    expect(harness.updateTenant).not.toHaveBeenCalled();
  });

  it("refills the form when the published config arrives after a failed first read", async () => {
    mockTenant();
    mockChain({ policy: policy(["alice.near"]) });
    harness.getRegistryApp.mockRejectedValueOnce(new Error("api warming up"));
    const { client } = renderTab();

    const description = (await screen.findByTestId(
      "orgs-homepage-description",
    )) as HTMLInputElement;
    await waitFor(() => expect(harness.getRegistryApp).toHaveBeenCalledTimes(1));
    expect(description.value).not.toBe("Chicago builders");

    await client.invalidateQueries({ queryKey: ["node-config", "registry-app"] });

    await waitFor(() => expect(description.value).toBe("Chicago builders"));
  });

  it("keeps the member's edits when the published config refreshes", async () => {
    mockTenant();
    mockChain({ policy: policy(["alice.near"]) });
    const { client } = renderTab();

    await editTitle("Chicago Builders");
    await client.invalidateQueries({ queryKey: ["node-config", "registry-app"] });
    await waitFor(() => expect(harness.getRegistryApp).toHaveBeenCalledTimes(2));

    expect((screen.getByTestId("orgs-homepage-title") as HTMLInputElement).value).toBe(
      "Chicago Builders",
    );
  });

  it("asks to make the organization active before proposing", async () => {
    mockTenant();
    mockChain({ policy: policy(["alice.near"]) });
    renderTab(true, false);

    await waitFor(() =>
      expect(screen.getByTestId("orgs-homepage-block-reason").textContent).toBe(
        "Make this organization active to propose a new homepage.",
      ),
    );
    expect((screen.getByTestId("orgs-homepage-propose") as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks proposing while the wallet is on testnet", async () => {
    harness.activeNetwork = "testnet";
    mockTenant();
    mockChain({ policy: policy(["alice.near"]) });
    renderTab();

    await waitFor(() =>
      expect(screen.getByTestId("orgs-homepage-block-reason").textContent).toBe(
        "Switch your NEAR wallet to mainnet to propose.",
      ),
    );
    expect((screen.getByTestId("orgs-homepage-propose") as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    {
      name: "non-manager",
      canManage: false,
      tenant: {},
      account: "alice.near",
      members: ["alice.near"],
      reason: "Only owners and admins can propose a new homepage.",
    },
    {
      name: "inactive tenant",
      canManage: true,
      tenant: { status: "suspended" },
      account: "alice.near",
      members: ["alice.near"],
      reason: "This community is suspended.",
    },
    {
      name: "no wallet",
      canManage: true,
      tenant: {},
      account: null,
      members: ["alice.near"],
      reason: "Connect your NEAR wallet to propose.",
    },
    {
      name: "missing AddProposal",
      canManage: true,
      tenant: {},
      account: "bob.near",
      members: ["alice.near"],
      reason: "bob.near has no AddProposal permission on chicago.sputnik-dao.near.",
    },
  ])("blocks proposing for $name", async ({ canManage, tenant, account, members, reason }) => {
    harness.nearAccount = account;
    mockTenant(tenant);
    mockChain({ policy: policy(members) });
    renderTab(canManage);

    await waitFor(() =>
      expect(screen.getByTestId("orgs-homepage-block-reason").textContent).toBe(reason),
    );
    expect((screen.getByTestId("orgs-homepage-propose") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the pending proposal with its vote progress and a Trezu link", async () => {
    mockTenant();
    mockChain({ policy: policy(["alice.near", "bob.near"]), proposals: [pendingProposal] });
    renderTab();

    await waitFor(() =>
      expect(screen.getByTestId("orgs-homepage-pending").textContent).toBe("Awaiting votes · #7"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("orgs-homepage-threshold").textContent).toBe("1/2 approvals"),
    );
    expect(screen.getByTestId("orgs-homepage-trezu-link").getAttribute("href")).toBe(
      "https://trezu.app/chicago.sputnik-dao.near",
    );
  });

  it("publishes directly when the platform owns the tenant", async () => {
    harness.nearAccount = "chicago.near";
    mockTenant({ ownerKind: "platform", accountId: "chicago.near" });
    mockChain({ policy: null });
    renderTab();

    await editTitle("Chicago Builders");
    const publish = screen.getByTestId("orgs-homepage-propose") as HTMLButtonElement;
    expect(publish.textContent).toContain("Publish new homepage");
    await waitFor(() => expect(publish.disabled).toBe(false));
    fireEvent.click(publish);

    await waitFor(() => expect(harness.publishTenantConfigForMode).toHaveBeenCalledTimes(1));
    expect(harness.publishTenantConfigForMode).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        accountId: "chicago.near",
        gatewayId: "citynode.app",
        baseAccount: "v1.citynode.near",
        hostname: "chicago.citynode.app",
        title: "Chicago Builders",
        description: "Chicago builders",
        mode: "platform",
      },
    );
    expect(harness.updateTenant).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      name: "Chicago Builders",
    });
    expect(harness.proposeTenantConfigAsMember).not.toHaveBeenCalled();
  });
});
