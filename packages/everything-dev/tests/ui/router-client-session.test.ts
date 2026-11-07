import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { sessionQueryKey } from "../../src/ui/auth";
import { createRouter } from "../../src/ui/router-client";

describe("client router session resolution", () => {
  it("gives mount gates a resolveSession that reads through the session query", async () => {
    const queryClient = new QueryClient();
    const session = { user: { id: "u1", role: "admin" } };
    const getSession = vi.fn(async () => ({ data: session, error: null }));

    const { router } = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({ initialEntries: ["/admin"] }),
      context: { queryClient, authClient: { getSession } },
    });
    const { resolveSession } = router.options.context as {
      resolveSession: () => Promise<unknown>;
    };

    await expect(resolveSession()).resolves.toEqual(session);
    await expect(resolveSession()).resolves.toEqual(session);
    expect(getSession).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(sessionQueryKey)).toEqual(session);
  });
});
