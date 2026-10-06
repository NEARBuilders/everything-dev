import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { type AuthClient, sessionQueryKey, sessionQueryOptions } from "../../src/ui/auth";

describe("session recovery", () => {
  it("does not cache a transient failure as a signed-out session and recovers on retry", async () => {
    const session = { user: { id: "member" }, session: { activeOrganizationId: "org" } };
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "Auth temporarily unavailable" } })
      .mockResolvedValueOnce({ data: session, error: null });
    const auth = { getSession } as unknown as AuthClient;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await expect(client.fetchQuery(sessionQueryOptions(auth))).rejects.toThrow(
      "Auth temporarily unavailable",
    );
    expect(client.getQueryData(sessionQueryKey)).toBeUndefined();
    await client.fetchQuery(sessionQueryOptions(auth));
    expect(client.getQueryData(sessionQueryKey)).toEqual(session);
    client.clear();
  });

  it("preserves the current organization when a background session read fails", async () => {
    const session = { user: { id: "member" }, session: { activeOrganizationId: "org" } };
    const auth = {
      getSession: async () => ({ data: null, error: { message: "Network failure" } }),
    } as unknown as AuthClient;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(sessionQueryKey, session);
    await expect(client.fetchQuery({ ...sessionQueryOptions(auth), staleTime: 0 })).rejects.toThrow(
      "Network failure",
    );
    expect(client.getQueryData(sessionQueryKey)).toEqual(session);
    client.clear();
  });
});
