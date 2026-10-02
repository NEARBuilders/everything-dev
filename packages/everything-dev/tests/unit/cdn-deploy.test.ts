import { describe, expect, it } from "vitest";
import { isLocalOrigin, probeStorageOrigin, resolveCdnDeployInputs } from "../../src/cdn-deploy";

const configWithCdn = (origin?: string) =>
  ({
    cdn: origin === undefined ? undefined : { origin },
  }) as never;

const session = (siteUrl: string, accountId = "child.near") => ({
  apiKey: "edk_session",
  siteUrl,
  accountId,
});

describe("resolveCdnDeployInputs", () => {
  it("derives the CDN origin from the authored cdn.origin (zero-config child path)", () => {
    const resolved = resolveCdnDeployInputs({
      env: {},
      bosConfig: configWithCdn("https://cdn.everything.dev"),
      session: session("https://everything.dev"),
      account: "child.near",
      gateway: "child.app",
      uploadsPlanned: true,
    });
    expect(resolved.cdnOrigin).toBe("https://cdn.everything.dev");
    expect(resolved.storageOrigin).toBe("https://everything.dev");
    expect(resolved.apiKey).toBe("edk_session");
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

  it("a session pinned to a local site is a hard error (the wrong-port incident)", () => {
    const resolved = resolveCdnDeployInputs({
      env: {},
      bosConfig: configWithCdn("https://cdn.everything.dev"),
      session: session("http://localhost:3000"),
      account: "child.near",
      gateway: "child.app",
      uploadsPlanned: true,
    });
    expect(resolved.error).toContain("http://localhost:3000");
    expect(resolved.error).toContain("bos login");
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

  it("uploads go to the runtime gateway when no env or session declares a storage origin", () => {
    const resolved = resolveCdnDeployInputs({
      env: { BOS_BUNDLE_CDN_ORIGIN: "https://cdn.everything.dev" },
      bosConfig: null,
      session: null,
      account: "a.near",
      gateway: "citynode.app",
      uploadsPlanned: true,
    });
    expect(resolved.cdnOrigin).toBe("https://cdn.everything.dev");
    expect(resolved.storageOrigin).toBe("https://citynode.app");
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

  it("passes when the origin serves a JSON MCP descriptor", async () => {
    const fetchImpl = (async () => ok({ mcp: { endpoint: "/api/mcp" } })) as typeof fetch;
    await expect(probeStorageOrigin("https://citynode.app", fetchImpl)).resolves.toBeUndefined();
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
