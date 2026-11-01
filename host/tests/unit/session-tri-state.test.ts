import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createSessionMiddleware } from "../../src/services/auth";
import type { PluginResult } from "../../src/services/plugins";

/**
 * Minimal Hono context stand-in: the middleware only uses get/set, plus
 * req.method (for the body-clone decision) and reqHeaders set by itself.
 */
function fakeContext(method = "GET") {
  const store = new Map<string, unknown>();
  const c = {
    req: { method, path: "/dashboard", raw: { headers: new Headers() } },
    set: (key: string, value: unknown) => store.set(key, value),
    get: (key: string) => store.get(key),
  } as unknown as Context;
  return { c: c as Context, store };
}

const runNext = async () => {};

function pluginWithAuthClient(factory: ((ctx?: unknown) => unknown) | null): PluginResult {
  return { authClient: factory } as unknown as PluginResult;
}

describe("createSessionMiddleware tri-state", () => {
  it("marks the session unresolved (undefined) when no auth plugin is loaded", async () => {
    const { c } = fakeContext();
    await createSessionMiddleware(pluginWithAuthClient(null))(c, runNext);

    expect(c.get("session")).toBeUndefined();
    expect(c.get("user")).toBeUndefined();
    expect(c.get("authContext")).toBeNull();
  });

  it("marks the session unresolved (undefined) when the auth client fails — not signed-out", async () => {
    const { c } = fakeContext();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const factory = () => {
      throw new Error("auth plugin wedged");
    };
    await createSessionMiddleware(pluginWithAuthClient(factory))(c, runNext);

    expect(c.get("session")).toBeUndefined();
    expect(c.get("user")).toBeUndefined();
    expect(c.get("authContext")).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Session resolution failed"));
    warn.mockRestore();
  });

  it("resolves an authoritative sign-out (null) when getContext succeeds with no session", async () => {
    const { c } = fakeContext();
    const factory = () => ({ getContext: async () => ({ session: null, user: null }) }) as unknown;
    await createSessionMiddleware(pluginWithAuthClient(factory))(c, runNext);

    expect(c.get("session")).toBeNull();
    expect(c.get("user")).toBeNull();
  });

  it("resolves the populated session when getContext succeeds", async () => {
    const { c } = fakeContext();
    const session = { id: "s1" };
    const user = { id: "u1" };
    const factory = () => ({ getContext: async () => ({ session, user }) }) as unknown;
    await createSessionMiddleware(pluginWithAuthClient(factory))(c, runNext);

    expect(c.get("session")).toBe(session);
    expect(c.get("user")).toBe(user);
  });
});
