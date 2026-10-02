// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VersionRefreshBanner } from "./version-refresh-banner";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

const versionCheck = vi.hoisted(() => ({
  startVersionWatch: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuthClient: () => ({ getSession: auth.getSession }),
}));
vi.mock("everything-dev/ui/version-check", () => ({
  startVersionWatch: versionCheck.startVersionWatch,
}));

beforeEach(() => {
  auth.getSession.mockReset();
  versionCheck.startVersionWatch.mockReset();
});

afterEach(() => {
  cleanup();
});

const runtimeConfig = { deploymentFingerprint: "v1" } as never;

describe("VersionRefreshBanner", () => {
  it("renders nothing before a new version is reported", async () => {
    auth.getSession.mockResolvedValue({ data: { user: {} } });
    versionCheck.startVersionWatch.mockImplementation(() => ({ stop: () => {} }));
    render(<VersionRefreshBanner runtimeConfig={runtimeConfig} />);
    await waitFor(() => expect(versionCheck.startVersionWatch).toHaveBeenCalled());
    expect(screen.queryByTestId("version-refresh-banner")).toBeNull();
  });

  it("shows the banner for a signed-in session when a new version lands", async () => {
    auth.getSession.mockResolvedValue({ data: { user: {} } });
    versionCheck.startVersionWatch.mockImplementation((input: { onNewVersion: () => void }) => {
      input.onNewVersion();
      return { stop: () => {} };
    });
    render(<VersionRefreshBanner runtimeConfig={runtimeConfig} />);
    await waitFor(() => expect(screen.getByTestId("version-refresh-banner")).toBeDefined());
  });

  it("does not arm the poller for anonymous sessions", async () => {
    auth.getSession.mockResolvedValue({ data: null });
    render(<VersionRefreshBanner runtimeConfig={runtimeConfig} />);
    await waitFor(() => expect(auth.getSession).toHaveBeenCalled());
    expect(versionCheck.startVersionWatch).not.toHaveBeenCalled();
  });

  it("does not arm the poller without a fingerprint (pre-atomic-deploys runtimes)", async () => {
    auth.getSession.mockResolvedValue({ data: { user: {} } });
    render(<VersionRefreshBanner runtimeConfig={{}} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(versionCheck.startVersionWatch).not.toHaveBeenCalled();
  });
});
