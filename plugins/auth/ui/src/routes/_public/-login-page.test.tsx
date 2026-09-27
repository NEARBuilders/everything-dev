// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route as LoginRoute } from "./login/index";

const harness = vi.hoisted(() => ({
  createAccountWithPasskey: vi.fn(),
  signInWithPasskey: vi.fn(),
  refreshSessionCache: vi.fn(),
}));

vi.mock("everything-dev/ui/auth", () => ({
  sessionQueryOptions: () => ({ queryKey: ["session"], queryFn: async () => null }),
  refreshSessionCache: harness.refreshSessionCache,
  createAccountWithPasskey: harness.createAccountWithPasskey,
  signInWithPasskey: harness.signInWithPasskey,
  isPasskeyAutofillAvailable: async () => false,
  isUnsupportedAuthenticatorError: (error: { code?: string }) =>
    error.code === "PASSKEY_UNSUPPORTED_AUTHENTICATOR",
  useAuthClient: () => ({ near: { detectNearAccount: async () => null } }),
}));

vi.mock("better-near-auth/client", () => ({ isPasskeyWalletAvailable: () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderLogin(initialEntry = "/login?redirect=%2Forgs") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRouteWithContext<Record<string, unknown>>()({ component: Outlet });
  const loginRoute = LoginRoute.update({
    ...LoginRoute.options,
    getParentRoute: () => root,
    path: "/login",
    id: undefined,
  } as never);
  const targetRoute = createRoute({
    getParentRoute: () => root,
    path: "/orgs",
    component: () => <div data-testid="target">orgs</div>,
  });
  const router = createRouter({
    routeTree: root.addChildren([loginRoute as never, targetRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    context: { queryClient, authClient: {}, runtimeConfig: { networkId: "mainnet" } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return router;
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  vi.clearAllMocks();
});

describe("login page", () => {
  it("leads with passkey sign-in and hints at other methods when none is found", async () => {
    harness.signInWithPasskey.mockImplementation(
      async (_auth: unknown, options?: { onError?: (error: Error) => void }) => {
        options?.onError?.(new Error("no passkey"));
      },
    );
    renderLogin();

    expect((await screen.findByTestId("login.heading")).textContent).toBe("Sign in to CityNode");
    fireEvent.click(screen.getByTestId("login.passkey-button"));

    expect(await screen.findByTestId("login.no-passkey-hint")).toBeTruthy();
    expect(screen.getByTestId("near.signin-button")).toBeTruthy();
    expect(screen.getByTestId("login.device-button")).toBeTruthy();
  });

  it("tells visitors coming from staking that signing in lets them stake", async () => {
    renderLogin(`/login?redirect=${encodeURIComponent("/stake?node=india")}`);
    expect(await screen.findByText("Sign in to stake with a CityNode community.")).toBeTruthy();
    cleanup();
    renderLogin();
    expect(await screen.findByText("Welcome back. Pick how you want to sign in.")).toBeTruthy();
    expect(screen.queryByText("Sign in to stake with a CityNode community.")).toBeNull();
  });

  it("creates an account with a passkey and continues to the redirect target", async () => {
    harness.createAccountWithPasskey.mockImplementation(
      async (_auth: unknown, options?: { onSuccess?: (result: object) => void }) => {
        options?.onSuccess?.({});
      },
    );
    const router = renderLogin();

    fireEvent.click(await screen.findByTestId("login.create-account-link"));
    expect(screen.getByTestId("login.heading").textContent).toBe("Create your account");
    fireEvent.click(screen.getByTestId("login.create-account-button"));

    await waitFor(() => expect(router.state.location.pathname).toBe("/orgs"));
    expect(harness.refreshSessionCache).toHaveBeenCalledOnce();
  });

  it("offers a NEAR wallet when the device cannot create a supported passkey", async () => {
    harness.createAccountWithPasskey.mockImplementation(
      async (
        _auth: unknown,
        options?: { onError?: (error: Error & { code?: string }) => void },
      ) => {
        options?.onError?.(
          Object.assign(new Error("unsupported"), { code: "PASSKEY_UNSUPPORTED_AUTHENTICATOR" }),
        );
      },
    );
    renderLogin();

    fireEvent.click(await screen.findByTestId("login.create-account-link"));
    fireEvent.click(screen.getByTestId("login.create-account-button"));

    expect(await screen.findByTestId("login.unsupported-authenticator")).toBeTruthy();
    expect(screen.getByTestId("near.signin-button")).toBeTruthy();
  });

  it("hides the phone sign-in option on mobile", async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderLogin();

    await screen.findByTestId("login.heading");
    expect(screen.queryByTestId("login.device-button")).toBeNull();
    expect(screen.getByTestId("near.signin-button")).toBeTruthy();
  });
});
