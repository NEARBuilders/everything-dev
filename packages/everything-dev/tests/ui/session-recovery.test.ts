import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AuthClient, sessionQueryKey, sessionQueryOptions } from "../../src/ui/auth";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("session recovery", () => {
  it("does not cache a transient failure as a signed-out session and recovers on retry (client)", async () => {
    vi.stubGlobal("window", {});
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

  it("preserves the current organization when a background session read fails (client)", async () => {
    vi.stubGlobal("window", {});
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

  it("degrades to signed-out on the server instead of failing the SSR render (#689)", async () => {
    // Node test environment: `window` is undefined — the SSR branch.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const auth = {
      getSession: async () => ({ data: null, error: { message: "Blocked by edge" } }),
    } as unknown as AuthClient;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await expect(client.fetchQuery(sessionQueryOptions(auth))).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("rendering signed-out"));
    client.clear();
    warn.mockRestore();
  });
});
