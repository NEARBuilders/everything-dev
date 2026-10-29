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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route as OnboardRoute } from "./onboard";

const harness = vi.hoisted(() => ({
  session: null as {
    user: { id: string; name: string };
    session: { activeOrganizationId: string | null };
  } | null,
  getOnboardingCodeInfo: vi.fn(),
  redeemOnboardingCode: vi.fn(),
  listOrganizations: vi.fn(),
  setActiveOrganization: vi.fn(),
  clipboardWriteText: vi.fn(async () => undefined),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: harness.toastSuccess, error: vi.fn() } }));

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

const CODE = "valid-code-12345";
const ORG_ID = "org-chicago";
const info = {
  organizationName: "Chicago Builders",
  eventName: "Launch Night",
  inviterName: "Ada",
  revoked: false,
  expired: false,
  usedUp: false,
};

const joined = {
  success: true,
  alreadyRedeemed: false,
  organizationId: ORG_ID,
  organizationName: "Chicago Builders",
  eventName: "Launch Night",
};

function signedIn(name = "Grace", activeOrganizationId: string | null = null) {
  harness.session = { user: { id: "user-1", name }, session: { activeOrganizationId } };
}

function membershipEnded() {
  return Object.assign(new Error("You are no longer a member of this organization"), {
    code: "FORBIDDEN",
    data: { action: "rejoin-organization" },
  });
}

function renderOnboard(onboard?: Record<string, unknown>) {
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
          listOrganizations: harness.listOrganizations,
          setActiveOrganization: harness.setActiveOrganization,
        },
      },
      runtimeConfig: {
        networkId: "mainnet",
        runtime: { gatewayId: "citynode.app" },
        ...(onboard ? { auth: { variables: { onboard } } } : {}),
      },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: harness.clipboardWriteText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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

  it("asks an unnamed returning member for a name, then shows the done state", async () => {
    signedIn("Passkey user");
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockResolvedValue(joined);

    renderOnboard();

    await waitFor(() => expect(harness.redeemOnboardingCode).toHaveBeenCalledWith({ code: CODE }));
    expect(await screen.findByTestId("onboard.display-name")).toBeTruthy();
    expect(screen.getByTestId("onboard.progress").getAttribute("data-step")).toBe("3");
    expect(screen.getByTestId("onboard.success").textContent).toContain("Chicago Builders");

    fireEvent.click(screen.getByTestId("onboard.display-name-skip"));

    expect(await screen.findByTestId("onboard.continue-on-computer")).toBeTruthy();
    expect(screen.getByTestId("onboard.gateway-origin").textContent).toBe(
      "localhost:3000/login?method=phone",
    );
    expect(screen.queryByTestId("onboard.display-name")).toBeNull();
  });

  it("skips the name step for a returning member who already chose a name", async () => {
    signedIn();
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockResolvedValue(joined);

    renderOnboard();

    expect(await screen.findByTestId("onboard.continue-on-computer")).toBeTruthy();
    expect(screen.queryByTestId("onboard.display-name")).toBeNull();
  });

  it("points the done state at the build page", async () => {
    signedIn();
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockResolvedValue(joined);

    renderOnboard();

    const buildButton = await screen.findByTestId("onboard.build-button");
    expect(buildButton.getAttribute("href")).toBe("/build");
    expect(screen.queryByTestId("build.prompts")).toBeNull();
  });

  it("copies the desktop pairing link from the continue card", async () => {
    signedIn();
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockResolvedValue(joined);

    renderOnboard();

    fireEvent.click(await screen.findByTestId("onboard.continue-copy-link"));

    await waitFor(() =>
      expect(harness.clipboardWriteText).toHaveBeenCalledWith(
        "http://localhost:3000/login?method=phone",
      ),
    );
  });
  it("keeps the happy path to the redeem alone", async () => {
    signedIn();
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockResolvedValue(joined);

    renderOnboard();

    expect(await screen.findByTestId("onboard.continue-on-computer")).toBeTruthy();
    expect(harness.listOrganizations).not.toHaveBeenCalled();
    expect(harness.toastSuccess).toHaveBeenCalledWith("You've joined Chicago Builders");
  });
});

describe("onboard rescan", () => {
  it("shows the joined state to a prior joiner who is still a member", async () => {
    signedIn("Grace", ORG_ID);
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockResolvedValue({ ...joined, alreadyRedeemed: true });
    harness.listOrganizations.mockResolvedValue([{ id: ORG_ID, name: "Chicago Builders" }]);

    renderOnboard();

    expect(await screen.findByTestId("onboard.continue-on-computer")).toBeTruthy();
    expect(screen.getByTestId("onboard.success").textContent).toContain("Chicago Builders");
    expect(harness.setActiveOrganization).not.toHaveBeenCalled();
  });

  it("tells a member who left that they are no longer a member, matching by ID not name", async () => {
    signedIn("Grace", ORG_ID);
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockResolvedValue({ ...joined, alreadyRedeemed: true });
    harness.listOrganizations.mockResolvedValue([
      { id: "org-other-chicago", name: "Chicago Builders" },
    ]);
    harness.setActiveOrganization.mockResolvedValue({ success: true });

    renderOnboard();

    const left = await screen.findByTestId("onboard.left");
    expect(left.textContent).toBe(
      "You’re no longer a member of this community. Ask an organizer for a new code or an invitation.",
    );
    expect(harness.setActiveOrganization).toHaveBeenCalledWith({ organizationId: null });
    expect(screen.queryByTestId("onboard.success")).toBeNull();
    expect(screen.queryByTestId("onboard.continue-on-computer")).toBeNull();
    expect(harness.toastSuccess).not.toHaveBeenCalled();
  });

  it("treats the server's membership-ended refusal as left and clears a stale active organization", async () => {
    signedIn("Grace", ORG_ID);
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockRejectedValue(membershipEnded());
    harness.listOrganizations.mockResolvedValue([{ id: "org-personal", name: "Grace" }]);
    harness.setActiveOrganization.mockResolvedValue({ success: true });

    renderOnboard();

    expect(await screen.findByTestId("onboard.left")).toBeTruthy();
    expect(harness.setActiveOrganization).toHaveBeenCalledWith({ organizationId: null });
    expect(screen.queryByTestId("onboard.error")).toBeNull();
  });

  it("leaves a valid active organization alone", async () => {
    signedIn("Grace", "org-personal");
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockRejectedValue(membershipEnded());
    harness.listOrganizations.mockResolvedValue([{ id: "org-personal", name: "Grace" }]);

    renderOnboard();

    expect(await screen.findByTestId("onboard.left")).toBeTruthy();
    expect(harness.setActiveOrganization).not.toHaveBeenCalled();
  });

  it("shows a retryable error when the membership lookup fails, then recovers", async () => {
    signedIn("Grace", ORG_ID);
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockResolvedValue({ ...joined, alreadyRedeemed: true });
    harness.listOrganizations
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce([{ id: ORG_ID, name: "Chicago Builders" }]);

    renderOnboard();

    expect(await screen.findByTestId("onboard.verify-failed")).toBeTruthy();
    expect(screen.queryByTestId("onboard.success")).toBeNull();
    expect(screen.queryByTestId("onboard.left")).toBeNull();

    fireEvent.click(screen.getByTestId("onboard.verify-retry"));

    expect(await screen.findByTestId("onboard.continue-on-computer")).toBeTruthy();
    expect(harness.redeemOnboardingCode).toHaveBeenCalledTimes(1);
  });

  it("stays in the error state when the stale active organization cannot be cleared", async () => {
    signedIn("Grace", ORG_ID);
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockResolvedValue({ ...joined, alreadyRedeemed: true });
    harness.listOrganizations.mockResolvedValue([]);
    harness.setActiveOrganization.mockRejectedValue(new Error("session write failed"));

    renderOnboard();

    expect(await screen.findByTestId("onboard.verify-failed")).toBeTruthy();
    expect(screen.queryByTestId("onboard.left")).toBeNull();
  });
});

describe("onboard links", () => {
  it("keeps /dashboard and /explore as the defaults", async () => {
    signedIn();
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockRejectedValue(new Error("Organization requires approval"));

    renderOnboard();

    expect((await screen.findByTestId("onboard.explore-button")).getAttribute("href")).toBe(
      "/explore",
    );
  });

  it("uses the configured links with the joined organization ID", async () => {
    signedIn();
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockResolvedValue(joined);

    renderOnboard({
      links: {
        next: { href: "/communities/{organizationId}", label: "Open your community" },
        home: { href: "/home" },
      },
    });

    const next = await screen.findByTestId("onboard.build-button");
    expect(next.getAttribute("href")).toBe(`/communities/${ORG_ID}`);
    expect(next.textContent).toBe("Open your community");
    const home = screen.getByTestId("onboard.home-button");
    expect(home.getAttribute("href")).toBe("/home");
    expect(home.textContent).toBe("Go to Home");
  });

  it("can hide the build link", async () => {
    signedIn();
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockResolvedValue(joined);

    renderOnboard({ links: { next: false } });

    expect(await screen.findByTestId("onboard.home-button")).toBeTruthy();
    expect(screen.queryByTestId("onboard.build-button")).toBeNull();
  });

  it("uses the configured explore link on the error panels", async () => {
    signedIn();
    harness.getOnboardingCodeInfo.mockResolvedValue({ ...info, expired: true });

    renderOnboard({ links: { explore: { href: "/communities", label: "Find a community" } } });

    const explore = await screen.findByTestId("onboard.explore-button");
    expect(explore.getAttribute("href")).toBe("/communities");
    expect(explore.textContent).toBe("Find a community");
  });

  it("ignores an unsafe configured link", async () => {
    signedIn();
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockResolvedValue(joined);

    renderOnboard({ links: { next: { href: "javascript:alert(1)" } } });

    expect((await screen.findByTestId("onboard.build-button")).getAttribute("href")).toBe("/build");
  });
});

describe("onboard community", () => {
  const community = { url: "/api/communities/by-organization/{organizationId}" };

  function stubCommunity(response: () => Promise<Response>) {
    const fetchMock = vi.fn(response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("shows Visit and the community's channels for the joined organization", async () => {
    signedIn();
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockResolvedValue(joined);
    const fetchMock = stubCommunity(() =>
      Promise.resolve(
        Response.json({
          name: "Chicago",
          href: "/n/chicago",
          channels: [
            { label: "Telegram", url: "https://t.me/chicago" },
            { label: "X", url: "https://x.com/chicago" },
          ],
        }),
      ),
    );

    renderOnboard({ community });

    const visit = await screen.findByTestId("onboard.visit-button");
    expect(visit.textContent).toBe("Visit Chicago");
    expect(visit.getAttribute("href")).toBe("/n/chicago");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/communities/by-organization/${ORG_ID}`,
      expect.objectContaining({ credentials: "same-origin" }),
    );
    const channels = screen.getAllByTestId("onboard.channel-link");
    expect(channels.map((channel) => channel.textContent)).toEqual(["Telegram", "X"]);
    for (const channel of channels) {
      expect(channel.getAttribute("target")).toBe("_blank");
      expect(channel.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("shows Visit without a channel list when the community has none", async () => {
    signedIn();
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockResolvedValue(joined);
    stubCommunity(() => Promise.resolve(Response.json({ href: "/n/chicago", channels: [] })));

    renderOnboard({ community });

    expect((await screen.findByTestId("onboard.visit-button")).textContent).toBe(
      "Visit Chicago Builders",
    );
    expect(screen.queryByTestId("onboard.channels")).toBeNull();
  });

  it("keeps the joined screen when the community lookup fails", async () => {
    signedIn();
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockResolvedValue(joined);
    const fetchMock = stubCommunity(() => Promise.reject(new Error("offline")));

    renderOnboard({ community });

    expect(await screen.findByTestId("onboard.continue-on-computer")).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("onboard.visit-button")).toBeNull();
    expect(screen.queryByTestId("onboard.channels")).toBeNull();
  });

  it("never loads a community for a member who left", async () => {
    signedIn("Grace", ORG_ID);
    harness.getOnboardingCodeInfo.mockResolvedValue(info);
    harness.redeemOnboardingCode.mockResolvedValue({ ...joined, alreadyRedeemed: true });
    harness.listOrganizations.mockResolvedValue([]);
    harness.setActiveOrganization.mockResolvedValue({ success: true });
    const fetchMock = stubCommunity(() => Promise.resolve(Response.json({ href: "/n/chicago" })));

    renderOnboard({ community });

    expect(await screen.findByTestId("onboard.left")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
