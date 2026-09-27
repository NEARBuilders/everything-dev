// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileSettings } from "./-components/profile-settings";

const harness = vi.hoisted(() => ({
  session: null as { user: { id: string; name: string; email: string } } | null,
  updateUser: vi.fn(),
  getSession: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("everything-dev/ui/auth", () => ({
  sessionQueryKey: ["session"],
  sessionQueryOptions: (auth: { getSession: typeof harness.getSession }) => ({
    queryKey: ["session"],
    queryFn: async () => {
      const { data } = await auth.getSession();
      return data;
    },
    staleTime: 0,
  }),
  useAuthClient: () => ({
    getSession: harness.getSession,
    updateUser: harness.updateUser,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: (props: Record<string, unknown>) => <a {...props} />,
}));

vi.mock("sonner", () => ({
  toast: { success: harness.success, error: harness.error },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("profile settings", () => {
  it("refreshes the authoritative session after changing the display name", async () => {
    const oldSession = {
      user: { id: "user-1", name: "Old name", email: "person@example.com" },
    };
    const freshSession = {
      user: { id: "user-1", name: "New name", email: "person@example.com" },
    };
    harness.session = oldSession;
    harness.getSession.mockImplementation(async () => ({ data: harness.session, error: null }));
    harness.updateUser.mockImplementation(async ({ name }: { name: string }) => {
      harness.session = { ...freshSession, user: { ...freshSession.user, name } };
      return { data: null, error: null };
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <ProfileSettings />
      </QueryClientProvider>,
    );

    const nameInput = await screen.findByPlaceholderText("Your display name");
    fireEvent.change(nameInput, { target: { value: "New name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(harness.updateUser).toHaveBeenCalledWith({ name: "New name" }));
    await waitFor(() => expect(queryClient.getQueryData(["session"])).toEqual(freshSession));
    expect(harness.success).toHaveBeenCalledWith("Profile updated");
  });
});
