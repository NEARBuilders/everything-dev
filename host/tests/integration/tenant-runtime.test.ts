import type { ResolutionIo } from "everything-dev/resolution";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeConfig } from "../../src/services/config";

const buildRuntimeConfigMock = vi.fn();
const verifySriForUrlMock = vi.fn();
const fetchBosConfigMock = vi.fn();

vi.mock("everything-dev/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("everything-dev/config")>();
  return {
    ...actual,
    buildRuntimeConfig: buildRuntimeConfigMock,
  };
});

vi.mock("everything-dev/integrity", () => ({
  verifySriForUrl: verifySriForUrlMock,
}));

const { clearTenantRuntimeCaches, resolveRequestRuntime } = await import(
  "../../src/services/tenant-runtime"
);

import type { BindingResolver } from "../../src/services/binding-resolver";

let remoteConfigs: Record<string, unknown> = {};

function setRemoteConfigs(...entries: Array<Record<string, unknown>>) {
  remoteConfigs = {};
  for (const entry of entries) {
    remoteConfigs[`bos://${String(entry.account)}/${String(entry.domain)}`] = entry;
  }
}

function createInMemoryIo(): ResolutionIo {
  return {
    fetchBosConfig: async (bosUrl: string) => {
      fetchBosConfigMock(bosUrl);
      const config = remoteConfigs[bosUrl];
      if (!config) {
        throw new Error(`No config found for ${bosUrl}`);
      }
      return config;
    },
  };
}

const ROOT_CONFIG = {
  account: "linktree.near",
  domain: "linktree.com",
  app: {
    host: { development: "local:host", production: "https://host.example.com" },
    ui: { name: "ui", production: "https://cdn.example.com/base-ui" },
    api: { name: "api", production: "https://api.example.com" },
  },
};

const ALICE_CONFIG = {
  extends: "bos://linktree.near/linktree.com",
  account: "alice.linktree.near",
  domain: "linktree.com",
  app: {
    host: { development: "local:host", production: "https://host.example.com" },
    ui: { name: "ui", production: "https://cdn.example.com/alice-ui" },
    api: { name: "api", production: "https://api.example.com" },
  },
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createMockBindingResolver(
  ...hostnames: Array<{
    hostname: string;
    tenantId?: string;
    allowUiOverrides?: boolean;
    allowBackendOverrides?: boolean;
    allowSsr?: boolean;
    status?: "active" | "pending" | "suspended" | "pending_deletion";
  }>
): BindingResolver {
  const map = new Map(
    hostnames.map((entry) => [
      entry.hostname,
      {
        hostname: entry.hostname,
        tenantId: entry.tenantId ?? `tenant-${entry.hostname}`,
        accountId: entry.hostname.replace(/\.com$/, ".near"),
        allowUiOverrides: entry.allowUiOverrides ?? true,
        allowBackendOverrides: entry.allowBackendOverrides ?? false,
        allowSsr: entry.allowSsr ?? false,
        status: entry.status ?? "active",
      },
    ]),
  );
  return {
    resolve: async (hostname: string) => map.get(hostname) ?? null,
    clear: () => {},
  };
}

function createBaseRuntimeConfig(): RuntimeConfig {
  return {
    env: "production",
    account: "linktree.near",
    domain: "linktree.com",
    networkId: "mainnet",
    title: "Linktree",
    description: "Base runtime",
    repository: "https://github.com/example/linktree",
    host: {
      name: "host",
      url: "https://linktree.com",
      entry: "https://linktree.com/mf-manifest.json",
      source: "remote",
    },
    ui: {
      name: "ui",
      url: "https://cdn.example.com/base-ui",
      entry: "https://cdn.example.com/base-ui/mf-manifest.json",
      source: "remote",
      integrity: "sha384-base",
      ssrUrl: "https://cdn.example.com/base-ui-ssr",
      ssrIntegrity: "sha384-base-ssr",
    },
    api: {
      name: "api",
      url: "https://api.example.com",
      entry: "https://api.example.com/mf-manifest.json",
      source: "remote",
    },
    auth: {
      name: "auth",
      url: "https://auth.example.com",
      entry: "https://auth.example.com/mf-manifest.json",
      source: "remote",
    },
    plugins: {
      apps: {
        name: "apps",
        url: "https://plugins.example.com/apps",
        entry: "https://plugins.example.com/apps/mf-manifest.json",
        source: "remote",
        ui: {
          name: "apps-ui",
          url: "https://plugins.example.com/apps-ui",
          entry: "https://plugins.example.com/apps-ui/mf-manifest.json",
          source: "remote",
          integrity: "sha384-apps-base",
        },
      },
    },
  } as RuntimeConfig;
}

describe("resolveRequestRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTenantRuntimeCaches();
    verifySriForUrlMock.mockResolvedValue(undefined);
    remoteConfigs = {};
  });

  it("returns the base runtime on the bare domain", async () => {
    const baseConfig = createBaseRuntimeConfig();

    const result = await resolveRequestRuntime(baseConfig, new Request("https://linktree.com/"), {
      bindingResolver: createMockBindingResolver(),
      io: createInMemoryIo(),
    });

    expect(result.config).toBe(baseConfig);
    expect(result.tenantAccountId).toBeNull();
    expect(fetchBosConfigMock).not.toHaveBeenCalled();
  });

  it("resolves the tenant account for a hostname via the binding resolver", async () => {
    setRemoteConfigs(ROOT_CONFIG, ALICE_CONFIG);

    buildRuntimeConfigMock.mockResolvedValue({
      ...createBaseRuntimeConfig(),
      account: "alice.linktree.near",
      ui: {
        ...createBaseRuntimeConfig().ui,
        url: "https://cdn.example.com/alice-ui",
        entry: "https://cdn.example.com/alice-ui/mf-manifest.json",
        integrity: "sha384-alice",
      },
    });

    const result = await resolveRequestRuntime(
      createBaseRuntimeConfig(),
      new Request("https://alice.linktree.com/"),
      {
        bindingResolver: createMockBindingResolver({
          hostname: "alice.linktree.com",
          allowUiOverrides: true,
        }),
        io: createInMemoryIo(),
      },
    );

    expect(result.tenantAccountId).toBe("alice.linktree.near");
    expect(fetchBosConfigMock).toHaveBeenCalledWith("bos://alice.linktree.near/linktree.com");
  });

  it("resolves nested tenant hostnames via the binding resolver", async () => {
    setRemoteConfigs(ROOT_CONFIG, {
      extends: "bos://linktree.near/linktree.com",
      account: "chicago.alice.linktree.near",
      domain: "linktree.com",
      app: {
        host: { development: "local:host", production: "https://host.example.com" },
        ui: { name: "ui", production: "https://cdn.example.com/chicago-ui" },
        api: { name: "api", production: "https://api.example.com" },
      },
    });

    buildRuntimeConfigMock.mockResolvedValue({
      ...createBaseRuntimeConfig(),
      account: "chicago.alice.linktree.near",
      ui: {
        ...createBaseRuntimeConfig().ui,
        url: "https://cdn.example.com/chicago-ui",
        entry: "https://cdn.example.com/chicago-ui/mf-manifest.json",
        integrity: "sha384-chicago",
      },
    });

    const result = await resolveRequestRuntime(
      createBaseRuntimeConfig(),
      new Request("https://chicago.alice.linktree.com/"),
      {
        bindingResolver: createMockBindingResolver({
          hostname: "chicago.alice.linktree.com",
          allowUiOverrides: true,
        }),
        io: createInMemoryIo(),
      },
    );

    expect(result.tenantAccountId).toBe("chicago.alice.linktree.near");
    expect(fetchBosConfigMock).toHaveBeenCalledWith(
      "bos://chicago.alice.linktree.near/linktree.com",
    );
  });

  it("requires the tenant config to extend the base runtime", async () => {
    setRemoteConfigs(
      {
        account: "somewhere-else.near",
        domain: "linktree.com",
        app: {
          host: { development: "local:host", production: "https://host.example.com" },
          ui: { name: "ui", production: "https://cdn.example.com/elsewhere-ui" },
          api: { name: "api", production: "https://api.example.com" },
        },
      },
      {
        extends: "bos://somewhere-else.near/linktree.com",
        account: "alice.linktree.near",
        domain: "linktree.com",
        app: {
          host: { development: "local:host", production: "https://host.example.com" },
          ui: { name: "ui", production: "https://cdn.example.com/alice-ui" },
          api: { name: "api", production: "https://api.example.com" },
        },
      },
    );

    buildRuntimeConfigMock.mockResolvedValue(createBaseRuntimeConfig());

    await expect(
      resolveRequestRuntime(createBaseRuntimeConfig(), new Request("https://alice.linktree.com/"), {
        bindingResolver: createMockBindingResolver({ hostname: "alice.linktree.com" }),
        io: createInMemoryIo(),
      }),
    ).rejects.toThrow("must extend bos://linktree.near/linktree.com");
  });

  it("rejects a suspended tenant with 503 based on the binding status", async () => {
    await expect(
      resolveRequestRuntime(createBaseRuntimeConfig(), new Request("https://alice.linktree.com/"), {
        bindingResolver: createMockBindingResolver({
          hostname: "alice.linktree.com",
          status: "suspended",
        }),
        io: createInMemoryIo(),
      }),
    ).rejects.toMatchObject({ status: 503, message: "Tenant is suspended" });
    expect(fetchBosConfigMock).not.toHaveBeenCalled();
  });

  it("rejects a pending_deletion tenant with 410 based on the binding status", async () => {
    await expect(
      resolveRequestRuntime(createBaseRuntimeConfig(), new Request("https://alice.linktree.com/"), {
        bindingResolver: createMockBindingResolver({
          hostname: "alice.linktree.com",
          status: "pending_deletion",
        }),
        io: createInMemoryIo(),
      }),
    ).rejects.toMatchObject({ status: 410, message: "Tenant has been deleted" });
    expect(fetchBosConfigMock).not.toHaveBeenCalled();
  });

  it("applies a tenant UI override and allows SSR when the binding enables both", async () => {
    const baseConfig = createBaseRuntimeConfig();

    setRemoteConfigs(ROOT_CONFIG, {
      ...ALICE_CONFIG,
      title: "Alice",
      description: "Alice links",
      repository: "https://github.com/example/alice",
    });

    buildRuntimeConfigMock.mockResolvedValue({
      ...baseConfig,
      account: "alice.linktree.near",
      title: "Alice",
      description: "Alice links",
      repository: "https://github.com/example/alice",
      ui: {
        ...baseConfig.ui,
        url: "https://cdn.example.com/alice-ui",
        entry: "https://cdn.example.com/alice-ui/mf-manifest.json",
        integrity: "sha384-alice",
        ssrUrl: "https://cdn.example.com/alice-ui-ssr",
        ssrIntegrity: "sha384-alice-ssr",
      },
    });

    const result = await resolveRequestRuntime(
      baseConfig,
      new Request("https://alice.linktree.com/"),
      {
        bindingResolver: createMockBindingResolver({
          hostname: "alice.linktree.com",
          allowUiOverrides: true,
          allowSsr: true,
        }),
        io: createInMemoryIo(),
      },
    );

    expect(result.tenantAccountId).toBe("alice.linktree.near");
    expect(result.config.account).toBe("alice.linktree.near");
    expect(result.config.ui.url).toBe("https://cdn.example.com/alice-ui");
    expect(result.ssrAllowed).toBe(true);
    expect(result.config.ui.ssrUrl).toBe("https://cdn.example.com/alice-ui-ssr");
    expect(verifySriForUrlMock).toHaveBeenCalledWith(
      "https://cdn.example.com/alice-ui",
      "sha384-alice",
      undefined,
    );
  });

  it("disables SSR when the binding does not allow it", async () => {
    const baseConfig = createBaseRuntimeConfig();

    setRemoteConfigs(ROOT_CONFIG, {
      extends: "bos://linktree.near/linktree.com",
      account: "bob.linktree.near",
      domain: "linktree.com",
      app: {
        host: { development: "local:host", production: "https://host.example.com" },
        ui: { name: "ui", production: "https://cdn.example.com/bob-ui" },
        api: { name: "api", production: "https://api.example.com" },
      },
    });

    buildRuntimeConfigMock.mockResolvedValue({
      ...baseConfig,
      account: "bob.linktree.near",
      ui: {
        ...baseConfig.ui,
        url: "https://cdn.example.com/bob-ui",
        entry: "https://cdn.example.com/bob-ui/mf-manifest.json",
        integrity: "sha384-bob",
        ssrUrl: "https://cdn.example.com/bob-ui-ssr",
        ssrIntegrity: "sha384-bob-ssr",
      },
    });

    const result = await resolveRequestRuntime(
      baseConfig,
      new Request("https://bob.linktree.com/"),
      {
        bindingResolver: createMockBindingResolver({
          hostname: "bob.linktree.com",
          allowUiOverrides: true,
          allowSsr: false,
        }),
        io: createInMemoryIo(),
      },
    );

    expect(result.ssrAllowed).toBe(false);
    expect(result.config.ui.ssrUrl).toBeUndefined();
    expect(result.config.ui.ssrIntegrity).toBeUndefined();
  });

  it("disables SSR for SSR-enabled bindings when ssrIntegrity is missing", async () => {
    const baseConfig = createBaseRuntimeConfig();

    setRemoteConfigs(ROOT_CONFIG, {
      extends: "bos://linktree.near/linktree.com",
      account: "alice.linktree.near",
      domain: "linktree.com",
      app: {
        host: { development: "local:host", production: "https://host.example.com" },
        ui: {
          name: "ui",
          production: "https://cdn.example.com/alice-ui",
          ssr: "https://cdn.example.com/alice-ui-ssr",
        },
        api: { name: "api", production: "https://api.example.com" },
      },
    });

    buildRuntimeConfigMock.mockResolvedValue({
      ...baseConfig,
      account: "alice.linktree.near",
      ui: {
        name: "ui",
        url: "https://cdn.example.com/alice-ui",
        entry: "https://cdn.example.com/alice-ui/mf-manifest.json",
        source: "remote",
        integrity: "sha384-alice",
        ssrUrl: "https://cdn.example.com/alice-ui-ssr",
      },
    });

    const result = await resolveRequestRuntime(
      baseConfig,
      new Request("https://alice.linktree.com/"),
      {
        bindingResolver: createMockBindingResolver({
          hostname: "alice.linktree.com",
          allowUiOverrides: true,
          allowSsr: true,
        }),
        io: createInMemoryIo(),
      },
    );

    expect(result.ssrAllowed).toBe(false);
    expect(result.config.ui.ssrUrl).toBeUndefined();
    expect(result.config.ui.ssrIntegrity).toBeUndefined();
  });

  it("disables SSR for SSR-enabled bindings when ssrUrl is missing", async () => {
    const baseConfig = createBaseRuntimeConfig();

    setRemoteConfigs(ROOT_CONFIG, ALICE_CONFIG);

    buildRuntimeConfigMock.mockResolvedValue({
      ...baseConfig,
      account: "alice.linktree.near",
      ui: {
        name: "ui",
        url: "https://cdn.example.com/alice-ui",
        entry: "https://cdn.example.com/alice-ui/mf-manifest.json",
        source: "remote",
        integrity: "sha384-alice",
      },
    });

    const result = await resolveRequestRuntime(
      baseConfig,
      new Request("https://alice.linktree.com/"),
      {
        bindingResolver: createMockBindingResolver({
          hostname: "alice.linktree.com",
          allowUiOverrides: true,
          allowSsr: true,
        }),
        io: createInMemoryIo(),
      },
    );

    expect(result.ssrAllowed).toBe(false);
    expect(result.config.ui.ssrUrl).toBeUndefined();
    expect(result.config.ui.ssrIntegrity).toBeUndefined();
  });

  it("allows SSR when the binding enables SSR and both ssrUrl and ssrIntegrity are present", async () => {
    const baseConfig = createBaseRuntimeConfig();

    setRemoteConfigs(ROOT_CONFIG, {
      extends: "bos://linktree.near/linktree.com",
      account: "alice.linktree.near",
      domain: "linktree.com",
      app: {
        host: { development: "local:host", production: "https://host.example.com" },
        ui: {
          name: "ui",
          production: "https://cdn.example.com/alice-ui",
          ssr: "https://cdn.example.com/alice-ui-ssr",
          ssrIntegrity: "sha384-alice-ssr",
        },
        api: { name: "api", production: "https://api.example.com" },
      },
    });

    buildRuntimeConfigMock.mockResolvedValue({
      ...baseConfig,
      account: "alice.linktree.near",
      ui: {
        name: "ui",
        url: "https://cdn.example.com/alice-ui",
        entry: "https://cdn.example.com/alice-ui/mf-manifest.json",
        source: "remote",
        integrity: "sha384-alice",
        ssrUrl: "https://cdn.example.com/alice-ui-ssr",
        ssrIntegrity: "sha384-alice-ssr",
      },
    });

    const result = await resolveRequestRuntime(
      baseConfig,
      new Request("https://alice.linktree.com/"),
      {
        bindingResolver: createMockBindingResolver({
          hostname: "alice.linktree.com",
          allowUiOverrides: true,
          allowSsr: true,
        }),
        io: createInMemoryIo(),
      },
    );

    expect(result.ssrAllowed).toBe(true);
    expect(result.config.ui.ssrUrl).toBe("https://cdn.example.com/alice-ui-ssr");
    expect(result.config.ui.ssrIntegrity).toBe("sha384-alice-ssr");
  });

  it("applies existing plugin UI overrides when backend overrides are allowed", async () => {
    const baseConfig = createBaseRuntimeConfig();

    setRemoteConfigs(ROOT_CONFIG, {
      extends: "bos://linktree.near/linktree.com",
      account: "alice.linktree.near",
      domain: "linktree.com",
      app: {
        host: { development: "local:host", production: "https://host.example.com" },
        ui: { name: "ui", production: "https://cdn.example.com/alice-ui" },
        api: { name: "api", production: "https://api.example.com" },
      },
      plugins: {
        apps: {
          production: "https://plugins.example.com/alice-apps",
          ui: {
            name: "alice-apps-ui",
            production: "https://plugins.example.com/alice-apps-ui",
            integrity: "sha384-apps-alice",
          },
        },
        ignored: {
          production: "https://plugins.example.com/ignored",
          ui: {
            name: "ignored-ui",
            production: "https://plugins.example.com/ignored-ui",
            integrity: "sha384-ignored",
          },
        },
      },
    });

    buildRuntimeConfigMock.mockResolvedValue({
      ...baseConfig,
      account: "alice.linktree.near",
      ui: {
        ...baseConfig.ui,
        url: "https://cdn.example.com/alice-ui",
        entry: "https://cdn.example.com/alice-ui/mf-manifest.json",
        integrity: "sha384-alice",
        ssrUrl: "https://cdn.example.com/alice-ui-ssr",
        ssrIntegrity: "sha384-alice-ssr",
      },
      plugins: {
        apps: {
          ...baseConfig.plugins!.apps,
          ui: {
            ...baseConfig.plugins!.apps.ui!,
            url: "https://plugins.example.com/alice-apps-ui",
            entry: "https://plugins.example.com/alice-apps-ui/mf-manifest.json",
            integrity: "sha384-apps-alice",
          },
        },
        ignored: {
          name: "ignored",
          url: "https://plugins.example.com/ignored",
          entry: "https://plugins.example.com/ignored/mf-manifest.json",
          source: "remote",
          ui: {
            name: "ignored-ui",
            url: "https://plugins.example.com/ignored-ui",
            entry: "https://plugins.example.com/ignored-ui/mf-manifest.json",
            source: "remote",
            integrity: "sha384-ignored",
          },
        },
      },
    });

    const result = await resolveRequestRuntime(
      baseConfig,
      new Request("https://alice.linktree.com/"),
      {
        bindingResolver: createMockBindingResolver({
          hostname: "alice.linktree.com",
          allowUiOverrides: true,
          allowSsr: true,
          allowBackendOverrides: true,
        }),
        io: createInMemoryIo(),
      },
    );

    expect(result.config.plugins?.apps.ui?.url).toBe("https://plugins.example.com/alice-apps-ui");
    expect(result.config.plugins?.ignored).toBeUndefined();
    expect(verifySriForUrlMock).toHaveBeenCalledWith(
      "https://plugins.example.com/alice-apps-ui",
      "sha384-apps-alice",
      undefined,
    );
  });

  it.each([
    "success",
    "failure",
  ])("revalidates expired integrity and handles refresh %s", async (outcome) => {
    vi.useFakeTimers();

    try {
      const baseConfig = createBaseRuntimeConfig();

      setRemoteConfigs(ROOT_CONFIG, ALICE_CONFIG);

      buildRuntimeConfigMock.mockResolvedValue({
        ...baseConfig,
        account: "alice.linktree.near",
        ui: {
          ...baseConfig.ui,
          url: "https://cdn.example.com/alice-ui",
          entry: "https://cdn.example.com/alice-ui/mf-manifest.json",
          integrity: "sha384-alice",
          ssrUrl: "https://cdn.example.com/alice-ui-ssr",
          ssrIntegrity: "sha384-alice-ssr",
        },
      });

      const io = createInMemoryIo();
      await resolveRequestRuntime(baseConfig, new Request("https://alice.linktree.com/"), {
        bindingResolver: createMockBindingResolver({
          hostname: "alice.linktree.com",
          allowUiOverrides: true,
          allowSsr: true,
        }),
        io,
      });

      const refresh = createDeferred<void>();
      verifySriForUrlMock.mockImplementationOnce(() => refresh.promise);
      vi.advanceTimersByTime(5 * 60_000 + 1);

      await expect(
        resolveRequestRuntime(baseConfig, new Request("https://alice.linktree.com/asset.js"), {
          verification: "stale-while-revalidate",
          bindingResolver: createMockBindingResolver({
            hostname: "alice.linktree.com",
            allowUiOverrides: true,
            allowSsr: true,
          }),
          io,
        }),
      ).resolves.toMatchObject({ tenantAccountId: "alice.linktree.near" });
      expect(verifySriForUrlMock).toHaveBeenCalledTimes(2);

      await expect(
        resolveRequestRuntime(baseConfig, new Request("https://alice.linktree.com/asset-2.js"), {
          verification: "stale-while-revalidate",
          bindingResolver: createMockBindingResolver({
            hostname: "alice.linktree.com",
            allowUiOverrides: true,
            allowSsr: true,
          }),
          io,
        }),
      ).resolves.toMatchObject({ tenantAccountId: "alice.linktree.near" });
      expect(verifySriForUrlMock).toHaveBeenCalledTimes(2);

      if (outcome === "success") {
        refresh.resolve();
        await Promise.resolve();
      } else {
        refresh.reject(new Error("integrity mismatch"));
        await vi.advanceTimersByTimeAsync(0);
        verifySriForUrlMock.mockRejectedValueOnce(new Error("integrity mismatch"));
        await expect(
          resolveRequestRuntime(baseConfig, new Request("https://alice.linktree.com/asset-3.js"), {
            verification: "stale-while-revalidate",
            bindingResolver: createMockBindingResolver({
              hostname: "alice.linktree.com",
              allowUiOverrides: true,
              allowSsr: true,
            }),
            io,
          }),
        ).rejects.toThrow("Integrity check failed");
        expect(verifySriForUrlMock).toHaveBeenCalledTimes(3);
        await expect(
          resolveRequestRuntime(baseConfig, new Request("https://alice.linktree.com/asset-4.js"), {
            verification: "stale-while-revalidate",
            bindingResolver: createMockBindingResolver({
              hostname: "alice.linktree.com",
              allowUiOverrides: true,
              allowSsr: true,
            }),
            io,
          }),
        ).resolves.toMatchObject({ tenantAccountId: "alice.linktree.near" });
        expect(verifySriForUrlMock).toHaveBeenCalledTimes(4);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for expired tenant UI integrity in blocking mode", async () => {
    vi.useFakeTimers();

    try {
      const baseConfig = createBaseRuntimeConfig();

      setRemoteConfigs(ROOT_CONFIG, ALICE_CONFIG);

      buildRuntimeConfigMock.mockResolvedValue({
        ...baseConfig,
        account: "alice.linktree.near",
        ui: {
          ...baseConfig.ui,
          url: "https://cdn.example.com/alice-ui",
          entry: "https://cdn.example.com/alice-ui/mf-manifest.json",
          integrity: "sha384-alice",
          ssrUrl: "https://cdn.example.com/alice-ui-ssr",
          ssrIntegrity: "sha384-alice-ssr",
        },
      });

      const io = createInMemoryIo();
      await resolveRequestRuntime(baseConfig, new Request("https://alice.linktree.com/"), {
        bindingResolver: createMockBindingResolver({
          hostname: "alice.linktree.com",
          allowUiOverrides: true,
          allowSsr: true,
        }),
        io,
      });

      const refresh = createDeferred<void>();
      verifySriForUrlMock.mockImplementationOnce(() => refresh.promise);
      vi.advanceTimersByTime(5 * 60_000 + 1);

      let settled = false;
      const pending = resolveRequestRuntime(
        baseConfig,
        new Request("https://alice.linktree.com/"),
        {
          verification: "blocking",
          bindingResolver: createMockBindingResolver({
            hostname: "alice.linktree.com",
            allowUiOverrides: true,
            allowSsr: true,
          }),
          io,
        },
      ).then(() => {
        settled = true;
      });

      await Promise.resolve();
      expect(settled).toBe(false);

      refresh.resolve();
      await pending;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gates SSR per tenant based on the binding allowSsr flag", async () => {
    const baseConfig = createBaseRuntimeConfig();

    setRemoteConfigs(ROOT_CONFIG, ALICE_CONFIG);

    buildRuntimeConfigMock.mockResolvedValue({
      ...baseConfig,
      account: "alice.linktree.near",
      ui: {
        ...baseConfig.ui,
        url: "https://cdn.example.com/alice-ui",
        entry: "https://cdn.example.com/alice-ui/mf-manifest.json",
        integrity: "sha384-alice",
        ssrUrl: "https://cdn.example.com/alice-ui-ssr",
        ssrIntegrity: "sha384-alice-ssr",
      },
    });

    const blocked = await resolveRequestRuntime(
      baseConfig,
      new Request("https://alice.linktree.com/"),
      {
        bindingResolver: createMockBindingResolver({
          hostname: "alice.linktree.com",
          allowUiOverrides: true,
          allowSsr: false,
        }),
        io: createInMemoryIo(),
      },
    );
    expect(blocked.ssrAllowed).toBe(false);
    expect(blocked.config.ui.ssrUrl).toBeUndefined();

    const allowed = await resolveRequestRuntime(
      baseConfig,
      new Request("https://alice.linktree.com/"),
      {
        bindingResolver: createMockBindingResolver({
          hostname: "alice.linktree.com",
          allowUiOverrides: true,
          allowSsr: true,
        }),
        io: createInMemoryIo(),
      },
    );
    expect(allowed.ssrAllowed).toBe(true);
    expect(allowed.config.ui.ssrUrl).toBe("https://cdn.example.com/alice-ui-ssr");
  });

  it("does not apply tenant UI overrides when the binding disallows them", async () => {
    const baseConfig = createBaseRuntimeConfig();

    setRemoteConfigs(ROOT_CONFIG, ALICE_CONFIG);

    buildRuntimeConfigMock.mockResolvedValue({
      ...baseConfig,
      account: "alice.linktree.near",
      ui: {
        ...baseConfig.ui,
        url: "https://cdn.example.com/alice-ui",
        entry: "https://cdn.example.com/alice-ui/mf-manifest.json",
        integrity: "sha384-alice",
      },
    });

    const result = await resolveRequestRuntime(
      baseConfig,
      new Request("https://alice.linktree.com/"),
      {
        bindingResolver: createMockBindingResolver({
          hostname: "alice.linktree.com",
          allowUiOverrides: false,
        }),
        io: createInMemoryIo(),
      },
    );

    expect(result.config.ui.url).toBe(baseConfig.ui.url);
    expect(verifySriForUrlMock).not.toHaveBeenCalled();
  });
});
