// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { AppI18nProvider } from "@/i18n/runtime";
import { nodeQueryKeys } from "@/lib/queries/nodes";
import { proposalReviewQueryKeys } from "@/lib/queries/proposals";
import { tenantQueryKeys } from "@/lib/queries/tenants";
import { Route } from "./apply";

type ApplyApiClient = {
  listRootNodes: ReturnType<typeof vi.fn>;
  listChildren: ReturnType<typeof vi.fn>;
  bindingPreflight: ReturnType<typeof vi.fn>;
  proposals: { propose: ReturnType<typeof vi.fn> };
};

type ApplyAuthClient = {
  organization: { list: ReturnType<typeof vi.fn> };
};

const TEST_RUNTIME_CONFIG = vi.hoisted(() => ({
  env: "development",
  account: "base.near",
  networkId: "mainnet",
  assetsUrl: "http://localhost/assets",
  apiBase: "/api",
  rpcBase: "/api/rpc",
  hostUrl: "http://localhost",
  runtime: {
    accountId: "base.near",
    gatewayId: "citynode.app",
    runtimeBasePath: "/",
    title: "City Nodes",
    description: "",
    hostUrl: "http://localhost",
  },
}));

const harness = vi.hoisted(() => ({
  apiClient: null as ApplyApiClient | null,
  authClient: null as ApplyAuthClient | null,
  activeOrganizationId: "org-1" as string | null,
  daoConnection: { status: "connected", daoAccountId: "dao.sputnik" } as {
    status: string;
    daoAccountId: string | null;
  },
  daoAccountIdForVerification: "dao.sputnik",
  nearAccount: "applicant.near" as string | null,
  initialRootNodes: [{ id: "country-1", name: "United States", kind: "country" }],
  routeContext: {
    auth: { activeOrganizationId: "org-1" as string | null },
    runtimeConfig: TEST_RUNTIME_CONFIG,
  },
  switchOrganization: { isError: false, mutate: vi.fn() },
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/app", async () => {
  const actual = await vi.importActual<typeof import("@/app")>("@/app");
  return {
    ...actual,
    getActiveRuntime: () => ({ gatewayId: "citynode.app" }),
    useApiClient: () => harness.apiClient,
    useAuthClient: () => harness.authClient,
  };
});

vi.mock("@/components/connect-dao", () => ({
  ConnectDao: ({ onVerified }: { onVerified?: (value: { daoAccountId: string }) => void }) => (
    <Button
      type="button"
      onClick={() => onVerified?.({ daoAccountId: harness.daoAccountIdForVerification })}
    >
      verify DAO
    </Button>
  ),
}));

vi.mock("@/components/layout/use-switch-organization", () => ({
  useSwitchOrganization: () => harness.switchOrganization,
}));

vi.mock("@/lib/dao-connect", () => ({
  useDaoConnection: () => harness.daoConnection,
}));

vi.mock("@/lib/use-near-account", () => ({
  useNearAccount: () => harness.nearAccount,
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => harness.success(...args),
    warning: (...args: unknown[]) => harness.warning(...args),
    error: (...args: unknown[]) => harness.error(...args),
  },
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    createFileRoute: () => (options: { component?: ComponentType }) => ({
      options,
      useLoaderData: () => harness.initialRootNodes,
      useRouteContext: () => harness.routeContext,
    }),
    Link: ({ children, to }: { children?: ReactNode; to?: unknown }) => (
      <a href={typeof to === "string" ? to : "#"}>{children}</a>
    ),
  };
});

function createApiClient(): ApplyApiClient {
  return {
    listRootNodes: vi.fn().mockResolvedValue(harness.initialRootNodes),
    listChildren: vi.fn().mockResolvedValue([]),
    bindingPreflight: vi.fn().mockResolvedValue({
      hostname: { available: true, format: "valid" },
    }),
    proposals: {
      propose: vi.fn().mockResolvedValue({ data: { id: "proposal-1" } }),
    },
  };
}

function createAuthClient(): ApplyAuthClient {
  return {
    organization: {
      list: vi.fn().mockResolvedValue({
        data: [{ id: "org-1", name: "CityNode" }],
        error: null,
      }),
    },
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderApply(queryClient = createQueryClient()) {
  const Component = Route.options.component;
  if (!Component) throw new Error("Apply route has no component");
  render(
    <AppI18nProvider>
      <QueryClientProvider client={queryClient}>
        <Component />
      </QueryClientProvider>
    </AppI18nProvider>,
  );
  return queryClient;
}

async function fillValidApplication() {
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Chicago" },
  });
  fireEvent.change(screen.getByLabelText("Why you want to run it"), {
    target: { value: "Serve the local community." },
  });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeTruthy();
  });
}

function stepStatus(id: string) {
  return screen.getByTestId(`apply.step-${id}`).getAttribute("data-status");
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.apiClient = createApiClient();
  harness.authClient = createAuthClient();
  harness.activeOrganizationId = "org-1";
  harness.daoConnection = { status: "connected", daoAccountId: "dao.sputnik" };
  harness.daoAccountIdForVerification = "dao.sputnik";
  harness.nearAccount = "applicant.near";
  harness.initialRootNodes = [{ id: "country-1", name: "United States", kind: "country" }];
  harness.routeContext = {
    auth: { activeOrganizationId: "org-1" },
    runtimeConfig: TEST_RUNTIME_CONFIG,
  };
  harness.switchOrganization = { isError: false, mutate: vi.fn() };
});

afterEach(() => {
  cleanup();
  harness.apiClient = null;
  harness.authClient = null;
});

describe("apply route submission", () => {
  it("submits the validated payload, shows the proposal id, and only invalidates proposal queries", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(proposalReviewQueryKeys.list("pending"), []);
    queryClient.setQueryData(proposalReviewQueryKeys.pendingCount(), 0);
    queryClient.setQueryData(nodeQueryKeys.roots(), harness.initialRootNodes);
    queryClient.setQueryData(tenantQueryKeys.preflight("chicago.citynode.app"), {
      hostname: { available: true, format: "valid" },
    });
    renderApply(queryClient);

    expect(stepStatus("organization")).toBe("complete");
    expect(stepStatus("near")).toBe("complete");
    expect(stepStatus("dao")).toBe("current");
    expect(stepStatus("details")).toBe("upcoming");
    fireEvent.click(screen.getByRole("button", { name: "verify DAO" }));
    await waitFor(() => expect(stepStatus("details")).toBe("current"));
    expect(stepStatus("dao")).toBe("complete");
    await fillValidApplication();
    const submitButton = screen.getByRole("button", { name: "Submit for review" });
    await waitFor(() => expect(submitButton).toHaveProperty("disabled", false));
    fireEvent.click(submitButton);

    await waitFor(() =>
      expect(harness.apiClient?.proposals.propose).toHaveBeenCalledWith({
        pluginId: "node",
        entityId: "chicago",
        payload: {
          kind: "country",
          parentId: null,
          name: "Chicago",
          slug: "chicago",
          motivation: "Serve the local community.",
          orgId: "org-1",
          accountId: "dao.sputnik",
          submitterAccountId: "applicant.near",
        },
        source: "/apply",
      }),
    );
    expect(await screen.findByText("Application submitted")).toBeTruthy();
    expect(screen.getByText("proposal-1")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View proposals" }).getAttribute("href")).toBe(
      "/dashboard/node/proposals",
    );
    await waitFor(() => {
      expect(
        queryClient.getQueryState(proposalReviewQueryKeys.list("pending"))?.isInvalidated,
      ).toBe(true);
      expect(queryClient.getQueryState(proposalReviewQueryKeys.pendingCount())?.isInvalidated).toBe(
        true,
      );
    });
    expect(queryClient.getQueryState(nodeQueryKeys.roots())?.isInvalidated).toBe(false);
    expect(
      queryClient.getQueryState(tenantQueryKeys.preflight("chicago.citynode.app"))?.isInvalidated,
    ).toBe(false);
  });

  it.each([
    {
      label: "missing DAO connection",
      daoConnection: { status: "idle", daoAccountId: null },
    },
    {
      label: "unverified DAO connection",
      daoConnection: { status: "connected", daoAccountId: "dao.sputnik" },
    },
  ])("keeps the details step locked with a $label", async ({ daoConnection }) => {
    harness.daoConnection = daoConnection;
    renderApply();

    expect(stepStatus("dao")).toBe("current");
    expect(stepStatus("details")).toBe("upcoming");
    expect(screen.queryByRole("button", { name: "Submit for review" })).toBeNull();
    expect(harness.apiClient?.proposals.propose).not.toHaveBeenCalled();
  });

  it("returns to details after reopening a verified DAO step", async () => {
    renderApply();
    fireEvent.click(screen.getByRole("button", { name: "verify DAO" }));
    await waitFor(() => expect(stepStatus("details")).toBe("current"));

    fireEvent.click(screen.getByTestId("apply.step-dao-change"));
    expect(stepStatus("dao")).toBe("current");
    fireEvent.click(screen.getByTestId("apply.dao-continue"));
    expect(stepStatus("details")).toBe("current");
  });

  it("opens the organization step first when there is no active organization", async () => {
    harness.routeContext = {
      auth: { activeOrganizationId: null },
      runtimeConfig: TEST_RUNTIME_CONFIG,
    };
    harness.authClient = {
      organization: { list: vi.fn().mockResolvedValue({ data: [], error: null }) },
    };
    renderApply();

    expect(stepStatus("organization")).toBe("current");
    expect(await screen.findByRole("link", { name: /Create organization/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "verify DAO" })).toBeNull();
  });
});
