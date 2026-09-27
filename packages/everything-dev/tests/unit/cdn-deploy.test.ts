import { describe, expect, it } from "vitest";
import { resolveCdnDeployInputs } from "../../src/cdn-deploy";

const runtimeConfig = (hostUrl?: string) =>
  ({
    host: { url: hostUrl },
  }) as never;

describe("resolveCdnDeployInputs", () => {
  it("derives the CDN origin from the inherited host slot (zero-config child path)", () => {
    const resolved = resolveCdnDeployInputs({
      env: {},
      runtimeConfig: runtimeConfig(
        "https://cdn.everything.dev/bundles/base.near/everything.dev/host/",
      ),
      session: {
        apiKey: "edk_session",
        siteUrl: "https://everything.dev",
        accountId: "child.near",
      },
      account: "child.near",
      gateway: "child.app",
    });
    expect(resolved.cdnOrigin).toBe("https://cdn.everything.dev");
    expect(resolved.storageOrigin).toBe("https://everything.dev");
    expect(resolved.apiKey).toBe("edk_session");
    expect(resolved.error).toBeUndefined();
  });

  it("derives the bundle origin from the host slot even pre-flip (gateway origin)", () => {
    const resolved = resolveCdnDeployInputs({
      env: {},
      runtimeConfig: runtimeConfig("https://citynode.app/bundles/a.near/citynode.app/host/"),
      session: null,
      account: "a.near",
      gateway: "citynode.app",
    });
    expect(resolved.cdnOrigin).toBe("https://citynode.app");
    expect(resolved.storageOrigin).toBe("https://citynode.app");
  });

  it("env overrides win over the session and derived values", () => {
    const resolved = resolveCdnDeployInputs({
      env: {
        BOS_BUNDLE_CDN_ORIGIN: "https://cdn.example.dev/",
        BOS_STORAGE_ORIGIN: "https://api.example.dev",
        BOS_STORAGE_API_KEY: "edk_env",
      },
      runtimeConfig: runtimeConfig(
        "https://cdn.everything.dev/bundles/base.near/everything.dev/host/",
      ),
      session: {
        apiKey: "edk_session",
        siteUrl: "https://everything.dev",
        accountId: "child.near",
      },
      account: "child.near",
      gateway: "child.app",
    });
    expect(resolved.cdnOrigin).toBe("https://cdn.example.dev");
    expect(resolved.storageOrigin).toBe("https://api.example.dev");
    expect(resolved.apiKey).toBe("edk_env");
  });

  it("uploads go to the runtime gateway when no env or session declares a storage origin", () => {
    const resolved = resolveCdnDeployInputs({
      env: { BOS_BUNDLE_CDN_ORIGIN: "https://cdn.everything.dev" },
      runtimeConfig: null,
      session: null,
      account: "a.near",
      gateway: "citynode.app",
    });
    expect(resolved.cdnOrigin).toBe("https://cdn.everything.dev");
    expect(resolved.storageOrigin).toBe("https://citynode.app");
  });

  it("CDN mode without credentials is an error", () => {
    const resolved = resolveCdnDeployInputs({
      env: { BOS_BUNDLE_CDN_ORIGIN: "https://cdn.everything.dev" },
      runtimeConfig: null,
      session: null,
      account: "a.near",
      gateway: "citynode.app",
    });
    expect(resolved.error).toContain("bos login");
  });

  it("a session under a different account is an error", () => {
    const resolved = resolveCdnDeployInputs({
      env: { BOS_BUNDLE_CDN_ORIGIN: "https://cdn.everything.dev" },
      runtimeConfig: null,
      session: {
        apiKey: "edk_session",
        siteUrl: "https://everything.dev",
        accountId: "other.near",
      },
      account: "a.near",
      gateway: "citynode.app",
    });
    expect(resolved.error).toContain("other.near");
  });
});
