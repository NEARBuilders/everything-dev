// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { thingQueryKeys } from "./-thing-cache";
import type { ThingProposal } from "./-thing-proposal-status";
import { Route } from "./$thingId";

const harness = vi.hoisted(() => ({
  role: "member",
  getThing: vi.fn(),
  deleteThing: vi.fn(),
  getProposals: vi.fn(),
  getUpvoteCount: vi.fn(),
  getUserVote: vi.fn(),
  upvote: vi.fn(),
  downvote: vi.fn(),
  navigate: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/app", () => ({
  useApiClient: () => ({
    template: { getThing: harness.getThing, deleteThing: harness.deleteThing },
    proposals: { getProposals: harness.getProposals },
    votes: {
      getUpvoteCount: harness.getUpvoteCount,
      getUserVote: harness.getUserVote,
      upvote: harness.upvote,
      downvote: harness.downvote,
    },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useParams: () => ({ thingId: "thing-1" }),
    useRouteContext: () => ({ session: { user: { role: harness.role } } }),
  }),
  useRouter: () => ({ navigate: harness.navigate, history: { canGoBack: () => false } }),
  Link: ({ children, to }: { children?: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: harness.error },
}));

const clients: QueryClient[] = [];
const thing = {
  thingId: "thing-1",
  type: "note",
  payload: { title: "A live thing" },
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  harness.role = "member";
  harness.getThing.mockResolvedValue(thing);
  harness.getProposals.mockResolvedValue({ data: [] });
  harness.getUpvoteCount.mockResolvedValue({ entityId: "thing-1", totalCount: 4 });
  harness.getUserVote.mockResolvedValue({ entityId: "thing-1", hasUpvote: false });
});

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
});

function showPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const Page = Route.options.component;
  if (!Page) throw new Error("Thing route has no component");
  render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
  return client;
}

describe("Thing details interactions", () => {
  it("rolls back an optimistic vote when the request fails and refreshes vote queries", async () => {
    const pending = Promise.withResolvers<never>();
    harness.upvote.mockReturnValue(pending.promise);
    const client = showPage();
    const vote = await screen.findByRole("button", { name: /4\s*upvote/ }, { timeout: 5000 });
    await waitFor(() => expect(vote.hasAttribute("disabled")).toBe(false), { timeout: 5000 });
    expect(screen.queryByRole("button", { name: "Delete thing" })).toBeNull();

    fireEvent.click(vote);
    await screen.findByRole("button", { name: /5\s*upvoted/ }, { timeout: 5000 });
    expect(client.getQueryData(thingQueryKeys.userVote("thing-1"))).toMatchObject({
      hasUpvote: true,
    });
    await act(async () => pending.reject(new Error("Vote rejected")));

    await screen.findByRole("button", { name: /4\s*upvote/ }, { timeout: 5000 });
    expect(harness.error).toHaveBeenCalledWith("Vote rejected");
    expect(harness.getUserVote.mock.calls.length).toBeGreaterThan(1);
    expect(harness.getUpvoteCount.mock.calls.length).toBeGreaterThan(1);
  });

  it("requires confirmation and refreshes a deleted Thing before navigating", async () => {
    harness.role = "admin";
    const client = showPage();
    client.setQueryData(thingQueryKeys.list, [thing]);
    const button = await screen.findByRole("button", { name: "Delete thing" }, { timeout: 5000 });
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }, { timeout: 5000 }));
    expect(harness.deleteThing).not.toHaveBeenCalled();

    const refresh = Promise.withResolvers<typeof thing>();
    harness.getThing.mockReturnValue(refresh.promise);
    harness.deleteThing.mockResolvedValue({ success: true });
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }, { timeout: 5000 }));
    await waitFor(() => expect(harness.deleteThing).toHaveBeenCalledWith({ thingId: "thing-1" }), {
      timeout: 5000,
    });
    await waitFor(() => expect(harness.getThing).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(harness.navigate).not.toHaveBeenCalled();
    expect(client.getQueryState(thingQueryKeys.list)?.isInvalidated).toBe(true);
    await act(async () => refresh.resolve(thing));
    await waitFor(() => expect(harness.navigate).toHaveBeenCalledWith({ to: "/things" }), {
      timeout: 5000,
    });
  });

  it("shows a pending proposal without fetching or exposing a live Thing", async () => {
    const proposal: ThingProposal = {
      id: "proposal-1",
      pluginId: "template",
      entityId: "thing-1",
      operation: "create",
      payload: thing,
      schemaVersion: "1",
      createdBy: "user-1",
      reviewStatus: "pending",
      applyStatus: "not_started",
      removeStatus: "not_started",
      rejectionReason: null,
      applyError: null,
      removeError: null,
      appliedResourceId: null,
      submissionCount: 1,
      appliedAt: null,
      removedAt: null,
      createdAt: thing.createdAt,
      updatedAt: thing.updatedAt,
    };
    harness.getProposals.mockResolvedValue({ data: [proposal] });
    showPage();
    await screen.findByText("Pending review", {}, { timeout: 5000 });
    expect(screen.getByText("This thing is not live in the registry yet.")).toBeTruthy();
    expect(harness.getThing).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /upvote/ })).toBeNull();
    expect(document.querySelector('a[href="/things"]')).toBeTruthy();
  });
});
