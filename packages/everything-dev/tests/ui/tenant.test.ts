import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantUiOverride } from "../../src/ui/tenant";
import {
  buildDraftFromResolvedConfig,
  buildTenantUrl,
  computeSsrEntryIntegrity,
  computeSubresourceIntegrity,
  computeUiEntryIntegrity,
  diffDraft,
  draftUiOverride,
  emptyTenantConfigDraft,
  gatewayForAccount,
  isLocalHostname,
  normalizeBundleBaseUrl,
  resolveClientEntryUrl,
  resolveServerEntryUrl,
  tenantConfigDraftSchema,
  tenantLabel,
  verifySsrIntegrity,
  verifyUiIntegrity,
} from "../../src/ui/tenant";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tenantLabel", () => {
  it("strips the gateway suffix from a full hostname", () => {
    expect(tenantLabel("chicago.citynode.app", "citynode.app")).toBe("chicago");
  });
  it("strips the .localhost suffix", () => {
    expect(tenantLabel("chicago.localhost")).toBe("chicago");
  });
  it("returns the bare label when no suffix matches", () => {
    expect(tenantLabel("chicago")).toBe("chicago");
  });
  it("is case-insensitive", () => {
    expect(tenantLabel("Chicago.CityNode.app", "citynode.app")).toBe("chicago");
  });
  it("trims trailing slashes", () => {
    expect(tenantLabel("chicago.citynode.app/", "citynode.app")).toBe("chicago");
  });
  it("returns the bare label for unrecognized suffixes", () => {
    expect(tenantLabel("chicago.example.com", "citynode.app")).toBe("chicago");
  });
});

describe("isLocalHostname", () => {
  it("matches localhost variants", () => {
    expect(isLocalHostname("localhost")).toBe(true);
    expect(isLocalHostname("127.0.0.1")).toBe(true);
    expect(isLocalHostname("chicago.localhost")).toBe(true);
  });
  it("does not match production hostnames", () => {
    expect(isLocalHostname("chicago.citynode.app")).toBe(false);
  });
});

describe("buildTenantUrl", () => {
  it("returns https in production", () => {
    expect(
      buildTenantUrl("chicago", "citynode.app", { currentHostname: "chicago.citynode.app" }),
    ).toBe("https://chicago.citynode.app");
  });
  it("returns http over localhost, preserving the current port", () => {
    expect(
      buildTenantUrl("chicago", "citynode.app", {
        currentHostname: "localhost",
        currentPort: "3003",
      }),
    ).toBe("http://chicago.localhost:3003");
  });
  it("accepts a full hostname as input", () => {
    expect(
      buildTenantUrl("chicago.citynode.app", "citynode.app", {
        currentHostname: "localhost",
        currentPort: "3000",
      }),
    ).toBe("http://chicago.localhost:3000");
  });
  it("appends a path", () => {
    expect(
      buildTenantUrl("chicago", "citynode.app", {
        currentHostname: "localhost",
        currentPort: "3000",
        path: "/stake",
      }),
    ).toBe("http://chicago.localhost:3000/stake");
  });
  it("returns null when the label is empty", () => {
    expect(buildTenantUrl("", "citynode.app")).toBeNull();
  });
  it("returns null when the gateway id is empty in production", () => {
    expect(
      buildTenantUrl("chicago", "", { currentHostname: "chicago.example.com", path: "/" }),
    ).toBeNull();
  });
});

describe("gatewayForAccount", () => {
  const mainnetConfig = {
    networkId: "mainnet" as const,
    runtime: {
      accountId: "v1.citynode.near",
      gatewayId: "citynode.app",
      runtimeBasePath: "/",
      title: null,
      description: null,
      hostUrl: null,
    },
  };
  const testnetConfig = {
    networkId: "testnet" as const,
    runtime: {
      accountId: "v1.citynode.testnet",
      gatewayId: "testnet.citynode.app",
      runtimeBasePath: "/",
      title: null,
      description: null,
      hostUrl: null,
    },
  };

  it("returns the runtime gateway when the account is on the runtime network", () => {
    expect(gatewayForAccount("chicago.citynode.near", mainnetConfig)).toBe("citynode.app");
    expect(gatewayForAccount("0s1234.testnet", testnetConfig)).toBe("testnet.citynode.app");
  });
  it("returns null when the account is on the other network", () => {
    expect(gatewayForAccount("0s1234.testnet", mainnetConfig)).toBeNull();
    expect(gatewayForAccount("chicago.citynode.near", testnetConfig)).toBeNull();
  });
  it("returns null when the runtime carries no gateway", () => {
    expect(
      gatewayForAccount("chicago.citynode.near", { networkId: "mainnet", runtime: undefined }),
    ).toBeNull();
  });
  it("defaults to the browser runtime config", () => {
    vi.stubGlobal("window", {
      __RUNTIME_CONFIG__: {
        env: "production",
        account: "v1.citynode.near",
        networkId: "mainnet",
        assetsUrl: "/",
        apiBase: "/api",
        rpcBase: "/rpc",
        runtime: {
          accountId: "v1.citynode.near",
          gatewayId: "citynode.app",
          runtimeBasePath: "/",
          title: null,
          description: null,
          hostUrl: null,
        },
      },
    });
    expect(gatewayForAccount("chicago.citynode.near")).toBe("citynode.app");
    delete (window as Record<string, unknown>).__RUNTIME_CONFIG__;
  });
});

describe("tenantConfigDraftSchema", () => {
  it("accepts a metadata-only draft", () => {
    const result = tenantConfigDraftSchema.safeParse({
      ...emptyTenantConfigDraft,
      title: "Chicago",
      description: "The Chicago node",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a UI bundle URL without an integrity hash", () => {
    const result = tenantConfigDraftSchema.safeParse({
      ...emptyTenantConfigDraft,
      title: "Chicago",
      description: "Chicago",
      uiProduction: "https://cdn.example.com/ui.js",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed integrity hash", () => {
    const result = tenantConfigDraftSchema.safeParse({
      ...emptyTenantConfigDraft,
      title: "Chicago",
      description: "Chicago",
      uiProduction: "https://cdn.example.com/ui.js",
      uiIntegrity: "md5-abc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an SSR bundle URL without an integrity hash", () => {
    const result = tenantConfigDraftSchema.safeParse({
      ...emptyTenantConfigDraft,
      title: "Chicago",
      description: "Chicago",
      ssrUrl: "https://cdn.example.com/ssr.js",
    });
    expect(result.success).toBe(false);
  });
});

describe("buildDraftFromResolvedConfig", () => {
  it("prefills from a published config", () => {
    const draft = buildDraftFromResolvedConfig(
      {
        title: "Chicago",
        description: "The Chicago node",
        repository: "https://github.com/example/chicago",
        app: {
          ui: {
            production: "https://cdn.example.com/ui.js",
            integrity: "sha384-abc",
            ssr: "https://cdn.example.com/ssr.js",
            ssrIntegrity: "sha384-def",
          },
        },
      },
      { title: "fallback" },
    );
    expect(draft).toEqual({
      title: "Chicago",
      description: "The Chicago node",
      repository: "https://github.com/example/chicago",
      uiProduction: "https://cdn.example.com/ui.js",
      uiIntegrity: "sha384-abc",
      ssrUrl: "https://cdn.example.com/ssr.js",
      ssrIntegrity: "sha384-def",
    });
  });

  it("falls back to the tenant name when nothing is published", () => {
    const draft = buildDraftFromResolvedConfig(null, { title: "Chicago" });
    expect(draft.title).toBe("Chicago");
    expect(draft.description).toBe("Chicago");
    expect(draft.uiProduction).toBe("");
  });
});

describe("diffDraft", () => {
  it("reports only the fields that change", () => {
    const draft = {
      ...emptyTenantConfigDraft,
      title: "Chicago",
      description: "The Chicago node",
      uiProduction: "https://cdn.example.com/ui.js",
      uiIntegrity: "sha384-abc",
    };
    const diff = diffDraft(draft, {
      title: "Chicago",
      description: "Chicago",
      app: { ui: { production: "https://old.example.com/ui.js" } },
    });
    expect(diff.map((entry) => entry.field)).toEqual(["description", "ui bundle", "ui integrity"]);
    expect(diff.find((entry) => entry.field === "ui bundle")?.from).toBe(
      "https://old.example.com/ui.js",
    );
    expect(diff.find((entry) => entry.field === "ui bundle")?.to).toBe(
      "https://cdn.example.com/ui.js",
    );
  });

  it("reports nothing when the draft matches the published config", () => {
    const draft = buildDraftFromResolvedConfig(
      { title: "Chicago", description: "Chicago" },
      { title: "Chicago" },
    );
    expect(diffDraft(draft, { title: "Chicago", description: "Chicago" })).toEqual([]);
  });
});

describe("draftUiOverride", () => {
  it("returns undefined when no UI bundle is set", () => {
    expect(draftUiOverride(emptyTenantConfigDraft)).toBeUndefined();
  });

  it("builds the app.ui block, including ssr only when both parts are present", () => {
    const base = {
      ...emptyTenantConfigDraft,
      title: "Chicago",
      description: "Chicago",
      uiProduction: "https://cdn.example.com/ui",
      uiIntegrity: "sha384-abc",
    };
    expect(draftUiOverride(base)).toEqual({
      ui: { production: "https://cdn.example.com/ui", integrity: "sha384-abc" },
    });
    expect(draftUiOverride({ ...base, ssrUrl: "https://cdn.example.com/ssr" })).toEqual({
      ui: { production: "https://cdn.example.com/ui", integrity: "sha384-abc" },
    });
    expect(
      draftUiOverride({
        ...base,
        ssrUrl: "https://cdn.example.com/ssr",
        ssrIntegrity: "sha384-def",
      }),
    ).toEqual({
      ui: {
        production: "https://cdn.example.com/ui",
        integrity: "sha384-abc",
        ssr: "https://cdn.example.com/ssr",
        ssrIntegrity: "sha384-def",
      },
    } satisfies { ui: TenantUiOverride });
  });

  it("publishes bundle base URLs even when an entry URL was pasted", () => {
    expect(
      draftUiOverride({
        ...emptyTenantConfigDraft,
        title: "Chicago",
        description: "Chicago",
        uiProduction: "https://cdn.example.com/ui/remoteEntry.js",
        uiIntegrity: "sha384-abc",
        ssrUrl: "https://cdn.example.com/ssr/remoteEntry.server.js",
        ssrIntegrity: "sha384-def",
      }),
    ).toEqual({
      ui: {
        production: "https://cdn.example.com/ui",
        integrity: "sha384-abc",
        ssr: "https://cdn.example.com/ssr",
        ssrIntegrity: "sha384-def",
      },
    } satisfies { ui: TenantUiOverride });
  });
});

describe("entry url resolution", () => {
  it("resolves client entry urls the way the host does", () => {
    expect(resolveClientEntryUrl("https://cdn.example.com/ui")).toBe(
      "https://cdn.example.com/ui/remoteEntry.js",
    );
    expect(resolveClientEntryUrl("https://cdn.example.com/ui/")).toBe(
      "https://cdn.example.com/ui/remoteEntry.js",
    );
    expect(resolveClientEntryUrl("https://cdn.example.com/ui/remoteEntry.js")).toBe(
      "https://cdn.example.com/ui/remoteEntry.js",
    );
    expect(resolveClientEntryUrl("https://cdn.example.com/ui/mf-manifest.json")).toBe(
      "https://cdn.example.com/ui/remoteEntry.js",
    );
  });

  it("resolves server entry urls the way the host does", () => {
    expect(resolveServerEntryUrl("https://cdn.example.com/ssr")).toBe(
      "https://cdn.example.com/ssr/remoteEntry.server.js",
    );
    expect(resolveServerEntryUrl("https://cdn.example.com/ssr/")).toBe(
      "https://cdn.example.com/ssr/remoteEntry.server.js",
    );
  });

  it("normalizes pasted entry urls back to bundle base urls", () => {
    expect(normalizeBundleBaseUrl("https://cdn.example.com/ui/remoteEntry.js")).toBe(
      "https://cdn.example.com/ui",
    );
    expect(normalizeBundleBaseUrl("https://cdn.example.com/ssr/remoteEntry.server.js")).toBe(
      "https://cdn.example.com/ssr",
    );
    expect(normalizeBundleBaseUrl("https://cdn.example.com/ui/mf-manifest.json")).toBe(
      "https://cdn.example.com/ui",
    );
    expect(normalizeBundleBaseUrl("  https://cdn.example.com/ui  ")).toBe(
      "https://cdn.example.com/ui",
    );
    expect(normalizeBundleBaseUrl("")).toBe("");
  });
});

describe("integrity preflight", () => {
  const bundleUrl = "https://cdn.example.com/ui";
  const ssrUrl = "https://cdn.example.com/ssr";

  const stubBundle = (content: string) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("remoteEntry.server.js")) return new Response(`${content}-server`);
      return new Response(content);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("computes a sha384 integrity hash from a fetched bundle", async () => {
    stubBundle("console.log('hi')");
    await expect(computeSubresourceIntegrity(bundleUrl)).resolves.toMatch(
      /^sha384-[A-Za-z0-9+/=]+$/,
    );
  });

  it("hashes the client entry, not the pasted base url", async () => {
    const fetchMock = stubBundle("console.log('hi')");
    await computeUiEntryIntegrity(bundleUrl);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cdn.example.com/ui/remoteEntry.js",
      expect.anything(),
    );
  });

  it("hashes the server entry, not the pasted base url", async () => {
    const fetchMock = stubBundle("console.log('hi')");
    await computeSsrEntryIntegrity(ssrUrl);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cdn.example.com/ssr/remoteEntry.server.js",
      expect.anything(),
    );
  });

  it("matches when the expected hash equals the computed one", async () => {
    stubBundle("console.log('hi')");
    const expected = await computeUiEntryIntegrity(bundleUrl);
    expect(await verifyUiIntegrity(bundleUrl, expected)).toEqual({ status: "match" });
  });

  it("mismatches when the bundle hashes differently", async () => {
    stubBundle("console.log('hi')");
    const expected = await computeUiEntryIntegrity(bundleUrl);
    stubBundle("console.log('tampered')");
    const check = await verifyUiIntegrity(bundleUrl, expected);
    expect(check.status).toBe("mismatch");
  });

  it("rejects the html landing page a bare base url serves", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://cdn.example.com/ui/remoteEntry.js")
        return new Response("console.log('hi')");
      return new Response("<!doctype html>landing page");
    });
    vi.stubGlobal("fetch", fetchMock);
    const expected = await computeUiEntryIntegrity(bundleUrl);
    const wrongHash = await computeSubresourceIntegrity(bundleUrl);
    expect(wrongHash).not.toBe(expected);
    const check = await verifyUiIntegrity(bundleUrl, wrongHash);
    expect(check.status).toBe("mismatch");
  });

  it("verifies the ssr pair against the server entry", async () => {
    stubBundle("console.log('hi')");
    const expected = await computeSsrEntryIntegrity(ssrUrl);
    expect(await verifySsrIntegrity(ssrUrl, expected)).toEqual({ status: "match" });
    const check = await verifySsrIntegrity(ssrUrl, "sha384-other");
    expect(check.status).toBe("mismatch");
  });

  it("reports unverified when the bundle cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network blocked")));
    const check = await verifyUiIntegrity(bundleUrl, "sha384-abc");
    expect(check.status).toBe("unverified");
    if (check.status === "unverified") expect(check.reason).toContain("network blocked");
    const ssrCheck = await verifySsrIntegrity(ssrUrl, "sha384-abc");
    expect(ssrCheck.status).toBe("unverified");
  });
});
