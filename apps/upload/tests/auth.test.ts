import { describe, expect, it, vi } from "vitest";
import {
  authorizeUploadRequest,
  readUploadAuthConfig,
  validateUploadAuthConfig,
} from "../src/auth";

const target = { account: "dev.everything.near", gateway: "everything.dev" };

describe("upload auth", () => {
  it("rejects missing API keys", async () => {
    const result = await authorizeUploadRequest({
      headers: new Headers(),
      ...target,
      config: {
        authOrigin: null,
        bootstrapApiKey: null,
        bootstrapScope: null,
        requiredPermissions: { bundles: ["write"] },
      },
    });

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.status).toBe("UNAUTHORIZED");
    }
  });

  it("accepts the bootstrap key only for the configured scope", async () => {
    const result = await authorizeUploadRequest({
      headers: new Headers({ "x-api-key": "bootstrap" }),
      ...target,
      config: {
        authOrigin: null,
        bootstrapApiKey: "bootstrap",
        bootstrapScope: target,
        requiredPermissions: { bundles: ["write"] },
      },
    });

    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.mode).toBe("bootstrap");
      expect(result.scope).toEqual(target);
    }
  });

  it("rejects bootstrap keys for the wrong scope", async () => {
    const result = await authorizeUploadRequest({
      headers: new Headers({ "x-api-key": "bootstrap" }),
      ...target,
      config: {
        authOrigin: null,
        bootstrapApiKey: "bootstrap",
        bootstrapScope: { account: "dev.everything.near", gateway: "other.dev" },
        requiredPermissions: { bundles: ["write"] },
      },
    });

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.status).toBe("FORBIDDEN");
    }
  });

  it("verifies scoped api keys via the auth origin", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            json: {
              valid: true,
              error: null,
              key: {
                id: "key_1",
                configId: "org-keys",
                referenceId: "org_1",
                name: "deploy",
                metadata: { account: target.account, gateway: target.gateway },
                permissions: { bundles: ["write"] },
              },
            },
            meta: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const result = await authorizeUploadRequest({
      headers: new Headers({ "x-api-key": "api_123" }),
      ...target,
      config: {
        authOrigin: "https://everything.dev",
        bootstrapApiKey: null,
        bootstrapScope: null,
        requiredPermissions: { bundles: ["write"] },
      },
      fetchImpl,
    });

    expect(result.authorized).toBe(true);
    if (result.authorized && result.mode === "api-key") {
      expect(result.mode).toBe("api-key");
      expect(result.key.permissions).toEqual({ bundles: ["write"] });
    }
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://everything.dev/api/rpc/auth/verifyApiKey",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("rejects api keys with the wrong deployment scope", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            json: {
              valid: true,
              error: null,
              key: {
                id: "key_1",
                configId: "org-keys",
                referenceId: "org_1",
                name: "deploy",
                metadata: { account: target.account, gateway: "other.dev" },
                permissions: { bundles: ["write"] },
              },
            },
            meta: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const result = await authorizeUploadRequest({
      headers: new Headers({ "x-api-key": "api_123" }),
      ...target,
      config: {
        authOrigin: "https://everything.dev",
        bootstrapApiKey: null,
        bootstrapScope: null,
        requiredPermissions: { bundles: ["write"] },
      },
      fetchImpl,
    });

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.status).toBe("FORBIDDEN");
    }
  });

  it("authorizes read-scoped api keys for inspection routes", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        json: { permissions: Record<string, string[]> };
      };
      return new Response(
        JSON.stringify({
          json: {
            valid: true,
            error: null,
            key: {
              id: "key_read",
              configId: "org-keys",
              referenceId: "org_1",
              name: "inspect",
              metadata: { account: target.account, gateway: target.gateway },
              permissions: body.json.permissions,
            },
          },
          meta: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await authorizeUploadRequest({
      headers: new Headers({ "x-api-key": "api_read" }),
      ...target,
      permission: "read",
      config: {
        authOrigin: "https://everything.dev",
        bootstrapApiKey: null,
        bootstrapScope: null,
        requiredPermissions: { bundles: ["read"] },
      },
      fetchImpl,
    });

    expect(result.authorized).toBe(true);
    const sent = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body ?? "{}")) as {
      json: { permissions: Record<string, string[]> };
    };
    expect(sent.json.permissions).toEqual({ bundles: ["read"] });
  });

  it("rejects write-only api keys for inspection routes", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            json: {
              valid: true,
              error: null,
              key: {
                id: "key_write",
                configId: "org-keys",
                referenceId: "org_1",
                name: "deploy",
                metadata: { account: target.account, gateway: target.gateway },
                permissions: { bundles: ["write"] },
              },
            },
            meta: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const result = await authorizeUploadRequest({
      headers: new Headers({ "x-api-key": "api_write" }),
      ...target,
      permission: "read",
      config: {
        authOrigin: "https://everything.dev",
        bootstrapApiKey: null,
        bootstrapScope: null,
        requiredPermissions: { bundles: ["read"] },
      },
      fetchImpl,
    });

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.status).toBe("FORBIDDEN");
    }
  });

  it("grants bootstrap keys read access within their scope", async () => {
    const result = await authorizeUploadRequest({
      headers: new Headers({ "x-api-key": "bootstrap" }),
      ...target,
      permission: "read",
      config: {
        authOrigin: null,
        bootstrapApiKey: "bootstrap",
        bootstrapScope: target,
        requiredPermissions: { bundles: ["read"] },
      },
    });

    expect(result.authorized).toBe(true);
  });

  it("rejects startup configs without an auth origin or bootstrap key in production", () => {
    const result = validateUploadAuthConfig(readUploadAuthConfig({}), { production: true });

    expect(result).toContain("required in production");
  });
});
