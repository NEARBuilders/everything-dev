import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSwitchOrganization } from "./use-switch-organization";

interface SwitchOptions {
  mutationFn: (organizationId: string) => Promise<void>;
  onSuccess: () => Promise<void>;
}

const harness = vi.hoisted(() => ({
  options: null as SwitchOptions | null,
  setActive: vi.fn(),
  setActiveTeam: vi.fn(),
  getSession: vi.fn(),
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
  invalidateRouter: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: SwitchOptions) => {
    harness.options = options;
    return {};
  },
  useQueryClient: () => ({
    setQueryData: harness.setQueryData,
    invalidateQueries: harness.invalidateQueries,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: harness.invalidateRouter }),
}));

vi.mock("sonner", () => ({
  toast: { success: harness.success, error: vi.fn() },
}));

vi.mock("@/app", () => ({
  sessionQueryKey: ["session"],
  useAuthClient: () => ({
    organization: { setActive: harness.setActive, setActiveTeam: harness.setActiveTeam },
    getSession: harness.getSession,
  }),
}));

describe("organization switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.options = null;
    harness.setActive.mockResolvedValue({ error: null });
    harness.setActiveTeam.mockResolvedValue({ error: null });
    harness.invalidateQueries.mockResolvedValue(undefined);
    harness.invalidateRouter.mockResolvedValue(undefined);
  });

  it("replaces the cached session with a fresh active organization", async () => {
    const freshSession = {
      session: { activeOrganizationId: "org-2" },
      user: { id: "user-1" },
    };
    harness.getSession.mockResolvedValue({ data: freshSession, error: null });

    useSwitchOrganization();
    expect(harness.options).not.toBeNull();

    await harness.options?.mutationFn("org-2");
    await harness.options?.onSuccess();

    expect(harness.setActive).toHaveBeenCalledWith({ organizationId: "org-2" });
    expect(harness.setActiveTeam).toHaveBeenCalledWith({ teamId: null });
    expect(harness.invalidateQueries).toHaveBeenNthCalledWith(
      1,
      { queryKey: ["organizations"], refetchType: "active" },
      { throwOnError: true },
    );
    expect(harness.invalidateQueries).toHaveBeenNthCalledWith(
      2,
      { queryKey: ["team-workspace"], refetchType: "active" },
      { throwOnError: true },
    );
    expect(harness.getSession).toHaveBeenCalledWith({
      query: { disableCookieCache: true },
    });
    expect(harness.setQueryData).toHaveBeenCalledWith(["session"], freshSession);
    expect(harness.invalidateRouter).toHaveBeenCalledOnce();
  });
});
