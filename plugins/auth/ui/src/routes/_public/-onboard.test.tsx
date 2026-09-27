// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route as OnboardRoute } from "./onboard";

const harness = vi.hoisted(() => ({
  session: null as { user: { id: string; name: string } } | null,
  getOnboardingCodeInfo: vi.fn(),
  redeemOnboardingCode: vi.fn(),
}));

vi.mock("everything-dev/ui/auth", () => ({
  sessionQueryOptions: () => ({
    queryKey: ["session"],
    queryFn: async () => harness.session,
  }),
  refreshSessionCache: vi.fn(async () => harness.session),
  createAccountWithPasskey: vi.fn(),
  signInWithPasskey: vi.fn(),
  isUnsupportedAuthenticatorError: () => false,
  useAuthClient: () => ({
    near: { detectNearAccount: async () => null },
    updateUser: vi.fn(async () => ({ error: null })),
  }),
}));

vi.mock("better-near-auth/client", () => ({ isPasskeyWalletAvailable: () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const CODE = "valid-code-12345";
const info = {
  organizationName: "Chicago Builders",
  eventName: "Launch Night",
  inviterName: "Ada",
  revoked: false,
  expired: false,
  usedUp: false,
};

function renderOnboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRouteWithContext<Record<string, unknown>>()({ component: Outlet });
  const onboardRoute = OnboardRoute.update({
    ...OnboardRoute.options,
    getParentRoute: () => root,
    path: "/onboard",
    id: undefined,
  } as never);
  const router = createRouter({
    routeTree: root.addChildren([onboardRoute as never]),
    history: createMemoryHistory({ initialEntries: [`/onboard?code=${CODE}`] }),
    context: {
      queryClient,
      apiClient: {
        auth: {
          getOnboardingCodeInfo: harness.getOnboardingCodeInfo,
          redeemOnboardingCode: harness.redeemOnboardingCode,
        },
      },
      runtimeConfig: { networkId: "mainnet", runtime: { gatewayId: "citynode.app" } },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  harness.session = null;
});

describe("onboard join flow", () => {
  it("invites a signed-out visitor at step 1 with account creation first", async () => {
    harness.getOnboardingCodeInfo.mockResolvedValue(info);

    renderOnboard();

    const invite = await screen.findByTestId("onboard.invite");
    expect(invite.textContent).toContain("Chicago Builders");
    expect(invite.textContent).toContain("Launch Night");
    expect(screen.getByTestId("onboard.progress").getAttribute("data-step")).toBe("1");
    expect(screen.getByTestId("onboard.create-account-button")).toBeTruthy();
    expect(harness.redeemOnboardingCode).not.toHaveBeenCalled();
  });

  it("redeems for a signed-in member, asks for a name, then shows the done state", async () => {
    harness.session = { user: { id: "user-1", name: "Grace" } };
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockResolvedValue({
      organizationName: "Chicago Builders",
      eventName: "Launch Night",
    });

    renderOnboard();

    await waitFor(() => expect(harness.redeemOnboardingCode).toHaveBeenCalledWith({ code: CODE }));
    expect(await screen.findByTestId("onboard.display-name")).toBeTruthy();
    expect(screen.getByTestId("onboard.progress").getAttribute("data-step")).toBe("3");
    expect(screen.getByTestId("onboard.success").textContent).toContain("Chicago Builders");

    fireEvent.click(screen.getByTestId("onboard.display-name-skip"));

    expect(await screen.findByTestId("onboard.continue-on-computer")).toBeTruthy();
    expect(screen.getByTestId("onboard.gateway-origin").textContent).toBe("localhost:3000");
    expect(screen.queryByTestId("onboard.display-name")).toBeNull();
  });
});
