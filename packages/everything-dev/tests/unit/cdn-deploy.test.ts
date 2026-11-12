import { describe, expect, it } from "vitest";
import {
  isLocalOrigin,
  probeStorageOrigin,
  resolveCdnDeployInputs,
} from "../../src/services/deploy/cdn";

const configWithCdn = (origin?: string, upload?: string) =>
  ({
    cdn: origin === undefined && upload === undefined ? undefined : { origin, upload },
  }) as never;

const session = (siteUrl: string, accountId = "child.near") => ({
  apiKey: "edk_session",
  siteUrl,
  accountId,
});

describe("resolveCdnDeployInputs", () => {
  it("defaults the upload origin to the platform upload service for platform-CDN deploys (#666)", () => {
    const resolved = resolveCdnDeployInputs({
      env: {},
      bosConfig: configWithCdn("https://cdn.everything.dev"),
      session: session("https://everything.dev"),
      account: "child.near",
      gateway: "child.app",
      uploadsPlanned: true,
    });
    expect(resolved.cdnOrigin).toBe("https://cdn.everything.dev");
    expect(resolved.storageOrigin).toBe("https://upload.everything.dev");
    expect(resolved.apiKey).toBe("edk_session");
    expect(resolved.error).toBeUndefined();
  });

  it("keeps the session-site chain for non-platform CDNs", () => {
    const resolved = resolveCdnDeployInputs({
      env: {},
      bosConfig: configWithCdn("https://cdn.example.test"),
      session: session("https://upload.example.test"),
      account: "child.near",
      gateway: "child.app",
      uploadsPlanned: true,
    });
    expect(resolved.storageOrigin).toBe("https://upload.example.test");
    expect(resolved.error).toBeUndefined();
  });

  it("the authored cdn.upload wins over the platform default and the session site", () => {
    const resolved = resolveCdnDeployInputs({
      env: {},
      bosConfig: configWithCdn("https://cdn.everything.dev", "https://upload.example.test"),
      session: session("https://everything.dev"),
      account: "child.near",
      gateway: "child.app",
      uploadsPlanned: true,
    });
    expect(resolved.storageOrigin).toBe("https://upload.example.test");
    expect(resolved.error).toBeUndefined();
  });

  it("an authored cdn.upload alone (no cdn.origin) is still the upload origin, cdn.origin error is separate", () => {
    const resolved = resolveCdnDeployInputs({
      env: {},
      bosConfig: configWithCdn(undefined, "https://upload.example.test"),
      session: session("https://upload.example.test"),
      account: "child.near",
      gateway: "child.app",
      uploadsPlanned: true,
    });
    expect(resolved.error).toContain("cdn.origin");
  });

  it("an authored local cdn.upload is a hard error (committed configs are publicly reachable)", () => {
    const resolved = resolveCdnDeployInputs({
      env: {},
      bosConfig: configWithCdn("https://cdn.example.test", "http://localhost:3000"),
      session: null,
      account: "child.near",
      gateway: "child.app",
      uploadsPlanned: true,
    });
    expect(resolved.error).toContain("cdn.upload");
    expect(resolved.error).toContain("http://localhost:3000");
  });

  it("the env BOS_STORAGE_ORIGIN overrides the authored cdn.upload", () => {
    const resolved = resolveCdnDeployInputs({
      env: { BOS_STORAGE_ORIGIN: "https://api.example.dev", BOS_STORAGE_API_KEY: "edk_env" },
      bosConfig: configWithCdn("https://cdn.everything.dev", "https://upload.example.test"),
      session: session("https://everything.dev"),
      account: "child.near",
      gateway: "child.app",
      uploadsPlanned: true,
    });
    expect(resolved.storageOrigin).toBe("https://api.example.dev");
    expect(resolved.error).toBeUndefined();
  });

  it("env overrides win over the authored origin, the session, and the gateway", () => {
    const resolved = resolveCdnDeployInputs({
      env: {
        BOS_BUNDLE_CDN_ORIGIN: "https://cdn.example.dev/",
        BOS_STORAGE_ORIGIN: "https://api.example.dev",
        BOS_STORAGE_API_KEY: "edk_env",
      },
      bosConfig: configWithCdn("https://cdn.everything.dev"),
      session: session("https://everything.dev"),
      account: "child.near",
      gateway: "child.app",
      uploadsPlanned: true,
    });
    expect(resolved.cdnOrigin).toBe("https://cdn.example.dev");
    expect(resolved.storageOrigin).toBe("https://api.example.dev");
    expect(resolved.apiKey).toBe("edk_env");
    expect(resolved.error).toBeUndefined();
  });

  it("is a hard error when neither the env nor the config declares a bundle origin", () => {
    const resolved = resolveCdnDeployInputs({
      env: {},
      bosConfig: configWithCdn(undefined),
      session: session("https://everything.dev"),
      account: "child.near",
      gateway: "child.app",
      uploadsPlanned: true,
    });
    expect(resolved.cdnOrigin).toBeUndefined();
    expect(resolved.error).toContain("cdn.origin");
    expect(resolved.error).toContain("BOS_BUNDLE_CDN_ORIGIN");
  });

  it("a config-only publish resolves nothing and requires nothing", () => {
    const resolved = resolveCdnDeployInputs({
      env: {},
      bosConfig: configWithCdn(undefined),
      session: session("http://localhost:3000"),
      account: "child.near",
      gateway: "child.app",
      uploadsPlanned: false,
    });
    expect(resolved.cdnOrigin).toBeUndefined();
    expect(resolved.error).toBeUndefined();
    expect(resolved.storageOrigin).toBe("http://localhost:3000");
  });

  it("is a hard error when the authored cdn.origin is a local URL", () => {
    const resolved = resolveCdnDeployInputs({
      env: {},
      bosConfig: configWithCdn("http://localhost:3000"),
      session: null,
      account: "a.near",
      gateway: "citynode.app",
      uploadsPlanned: true,
    });
    expect(resolved.error).toContain("cdn.origin");
    expect(resolved.error).toContain("http://localhost:3000");
  });

  it("a session pinned to a local site is a hard error for non-platform CDNs (the wrong-port incident)", () => {
    const resolved = resolveCdnDeployInputs({
      env: {},
      bosConfig: configWithCdn("https://cdn.example.test"),
      session: session("http://localhost:3000"),
      account: "child.near",
      gateway: "child.app",
      uploadsPlanned: true,
    });
    expect(resolved.error).toContain("http://localhost:3000");
    expect(resolved.error).toContain("bos login");
  });

  it("a local-pinned session does not block a platform-CDN deploy (the platform upload service is the origin)", () => {
    const resolved = resolveCdnDeployInputs({
      env: {},
      bosConfig: configWithCdn("https://cdn.everything.dev"),
      session: session("http://localhost:3000"),
      account: "child.near",
      gateway: "child.app",
      uploadsPlanned: true,
    });
    expect(resolved.error).toBeUndefined();
    expect(resolved.storageOrigin).toBe("https://upload.everything.dev");
  });

  it("an env-pinned local storage origin is a deliberate local deploy (warning only)", () => {
    const resolved = resolveCdnDeployInputs({
      env: {
        BOS_BUNDLE_CDN_ORIGIN: "https://cdn.example.test",
        BOS_STORAGE_ORIGIN: "http://localhost:3000",
        BOS_STORAGE_API_KEY: "edk_env",
      },
      bosConfig: null,
      session: null,
      account: "a.near",
      gateway: "citynode.app",
      uploadsPlanned: true,
    });
    expect(resolved.error).toBeUndefined();
    expect(resolved.storageOrigin).toBe("http://localhost:3000");
    expect(resolved.warning).toContain("local");
  });

  it("an env-pinned local CDN origin warns instead of erroring", () => {
    const resolved = resolveCdnDeployInputs({
      env: {
        BOS_BUNDLE_CDN_ORIGIN: "http://localhost:4943",
        BOS_STORAGE_ORIGIN: "http://localhost:3014",
        BOS_STORAGE_API_KEY: "edk_env",
      },
      bosConfig: null,
      session: null,
      account: "a.near",
      gateway: "citynode.app",
      uploadsPlanned: true,
    });
    expect(resolved.error).toBeUndefined();
    expect(resolved.cdnOrigin).toBe("http://localhost:4943");
    expect(resolved.warning).toContain("local");
  });

  it("a platform CDN with no env/session resolves to the platform upload service instead of erroring", () => {
    const resolved = resolveCdnDeployInputs({
      env: {
        BOS_BUNDLE_CDN_ORIGIN: "https://cdn.everything.dev",
        BOS_STORAGE_API_KEY: "edk_env",
      },
      bosConfig: null,
      session: null,
      account: "a.near",
      gateway: "citynode.app",
      uploadsPlanned: true,
    });
    expect(resolved.cdnOrigin).toBe("https://cdn.everything.dev");
    expect(resolved.error).toBeUndefined();
    expect(resolved.storageOrigin).toBe("https://upload.everything.dev");
  });

  it("is a hard error when a non-platform CDN has no env or session storage origin (the gateway no longer serves uploads)", () => {
    const resolved = resolveCdnDeployInputs({
      env: { BOS_BUNDLE_CDN_ORIGIN: "https://cdn.example.test" },
      bosConfig: null,
      session: null,
      account: "a.near",
      gateway: "citynode.app",
      uploadsPlanned: true,
    });
    expect(resolved.cdnOrigin).toBe("https://cdn.example.test");
    expect(resolved.error).toContain("BOS_STORAGE_ORIGIN");
    expect(resolved.error).toContain("upload.everything.dev");
  });

  it("CDN mode without credentials is an error", () => {
    const resolved = resolveCdnDeployInputs({
      env: { BOS_BUNDLE_CDN_ORIGIN: "https://cdn.everything.dev" },
      bosConfig: null,
      session: null,
      account: "a.near",
      gateway: "citynode.app",
      uploadsPlanned: true,
    });
    expect(resolved.error).toContain("bos login");
  });

  it("a session under a different account is an error", () => {
    const resolved = resolveCdnDeployInputs({
      env: { BOS_BUNDLE_CDN_ORIGIN: "https://cdn.everything.dev" },
      bosConfig: null,
      session: session("https://everything.dev", "other.near"),
      account: "a.near",
      gateway: "citynode.app",
      uploadsPlanned: true,
    });
    expect(resolved.error).toContain("other.near");
  });
});

describe("isLocalOrigin", () => {
  it("rejects loopback, RFC1918, link-local, and .local hosts", () => {
    for (const url of [
      "http://localhost:3000",
      "https://api.localhost",
      "http://127.0.0.1:8080",
      "http://127.190.20.5",
      "http://10.1.2.3",
      "https://192.168.0.9",
      "https://172.16.5.4",
      "https://172.31.255.255",
      "http://[::1]:3000",
      "http://[fe80::1]/bundles/",
      "http://169.254.1.1",
      "https://printer.local",
      "not a url",
      "ftp://cdn.example.dev",
    ]) {
      expect(isLocalOrigin(url), url).toBe(true);
    }
  });

  it("accepts public origins, including fc-named public hostnames", () => {
    for (const url of [
      "https://cdn.everything.dev",
      "https://citynode.app/bundles/a.near/citynode.app/host/",
      "https://flickr.com",
      "http://172.32.0.1",
    ]) {
      expect(isLocalOrigin(url), url).toBe(false);
    }
  });
});

describe("probeStorageOrigin", () => {
  const ok = (body: unknown) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });

  const originFetch =
    (routes: Record<string, Response | Error>) => async (input: RequestInfo | URL) => {
      const url = String(input);
      const method = "POST";
      const key = url.endsWith("/api/storage/bundles") ? `${method} ${url}` : url;
      const route = routes[key];
      if (route instanceof Error) throw route;
      return route ?? new Response("nope", { status: 404 });
    };

  it("passes when the origin serves a JSON MCP descriptor and a guarded upload route", async () => {
    const fetchImpl = originFetch({
      "https://citynode.app/health": ok({ mcp: { endpoint: "/api/mcp" } }),
      "https://citynode.app/.well-known/mcp.json": ok({ mcp: { endpoint: "/api/mcp" } }),
      "POST https://citynode.app/api/storage/bundles": new Response("Unauthorized", {
        status: 401,
      }),
    });
    await expect(
      probeStorageOrigin("https://citynode.app", fetchImpl as typeof fetch),
    ).resolves.toBeUndefined();
  });

  it("skips the upload-route probe for local origins (test harnesses, local stacks)", async () => {
    const fetchImpl = originFetch({
      "http://127.0.0.1:62464/.well-known/mcp.json": ok({ mcp: { endpoint: "/api/mcp" } }),
    });
    await expect(
      probeStorageOrigin("http://127.0.0.1:62464", fetchImpl as typeof fetch),
    ).resolves.toBeUndefined();
  });

  it("distinguishes an app host from the upload service via the upload route (#666)", async () => {
    const fetchImpl = originFetch({
      "https://everything.dev/health": ok("OK"),
      "POST https://everything.dev/api/storage/bundles": new Response("Not Found", { status: 404 }),
    });
    await expect(
      probeStorageOrigin("https://everything.dev", fetchImpl as typeof fetch),
    ).resolves.toContain("app host");
  });

  it("accepts the real upload service (auth-guarded upload route)", async () => {
    const fetchImpl = originFetch({
      "https://upload.everything.dev/health": ok("OK"),
      "POST https://upload.everything.dev/api/storage/bundles": new Response("Unauthorized", {
        status: 401,
      }),
    });
    await expect(
      probeStorageOrigin("https://upload.everything.dev", fetchImpl as typeof fetch),
    ).resolves.toBeUndefined();
  });

  it("fails on non-ok statuses, non-JSON bodies, and unreachable origins", async () => {
    const notFound = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    await expect(probeStorageOrigin("https://squat.example", notFound)).resolves.toContain("404");

    const nonJson = (async () => ok("<html>hello</html>")) as typeof fetch;
    await expect(probeStorageOrigin("https://squat.example", nonJson)).resolves.toContain(
      "MCP descriptor",
    );

    const unreachable = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    await expect(probeStorageOrigin("http://localhost:3000", unreachable)).resolves.toContain(
      "ECONNREFUSED",
    );
  });
});
