import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchBosConfigFromFastKvMock } = vi.hoisted(() => ({
  fetchBosConfigFromFastKvMock: vi.fn(),
}));

vi.mock("../../src/fastkv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/fastkv")>();
  return {
    ...actual,
    fetchBosConfigFromFastKv: fetchBosConfigFromFastKvMock,
  };
});

import { resolveRemoteConfigChain } from "../../src/plugin";
import type { BosConfigInput } from "../../src/types";

const PARENT_WITH_HOST: BosConfigInput = {
  account: "parent.near",
  domain: "parent.dev",
  app: {
    host: { development: "local:host", production: "https://host.parent.dev" },
    ui: { development: "local:ui", production: "https://ui.parent.dev" },
    api: { development: "local:api", production: "https://api.parent.dev" },
  },
};

describe("resolveRemoteConfigChain", () => {
  afterEach(() => {
    fetchBosConfigFromFastKvMock.mockReset();
  });

  it("returns the config as-is when it has no extends", async () => {
    fetchBosConfigFromFastKvMock.mockResolvedValue(PARENT_WITH_HOST);

    const result = await resolveRemoteConfigChain("parent.near", "parent.dev", new Set());

    expect(result.account).toBe("parent.near");
    expect(result.app.host).toEqual(PARENT_WITH_HOST.app!.host);
    expect(fetchBosConfigFromFastKvMock).toHaveBeenCalledTimes(1);
    expect(fetchBosConfigFromFastKvMock).toHaveBeenCalledWith(
      "bos://parent.near/parent.dev",
      undefined,
    );
  });

  it("inherits app.host from the parent via extends", async () => {
    const childConfig: BosConfigInput = {
      extends: "bos://parent.near/parent.dev",
      account: "child.near",
      domain: "child.dev",
      app: {
        ui: { production: "https://ui.child.dev" },
        api: { production: "https://api.child.dev" },
      },
    };

    fetchBosConfigFromFastKvMock.mockImplementation((url: string) => {
      if (url === "bos://child.near/child.dev") return childConfig;
      if (url === "bos://parent.near/parent.dev") return PARENT_WITH_HOST;
      throw new Error(`No config found for ${url}`);
    });

    const result = await resolveRemoteConfigChain("child.near", "child.dev", new Set());

    expect(result.account).toBe("child.near");
    expect(result.domain).toBe("child.dev");
    expect(result.app.host).toEqual(PARENT_WITH_HOST.app!.host);
    expect(fetchBosConfigFromFastKvMock).toHaveBeenCalledTimes(2);
  });

  it("child explicitly overrides app.host", async () => {
    const childConfig: BosConfigInput = {
      extends: "bos://parent.near/parent.dev",
      account: "child.near",
      app: {
        host: { development: "local:host", production: "https://host.child.dev" },
        ui: { production: "https://ui.child.dev" },
        api: { production: "https://api.child.dev" },
      },
    };

    fetchBosConfigFromFastKvMock.mockImplementation((url: string) => {
      if (url === "bos://child.near/child.dev") return childConfig;
      if (url === "bos://parent.near/parent.dev")
        return {
          ...PARENT_WITH_HOST,
          app: {
            ...PARENT_WITH_HOST.app!,
            host: { development: "local:host", production: "https://host.parent.dev" },
          },
        };
      throw new Error(`No config found for ${url}`);
    });

    const result = await resolveRemoteConfigChain("child.near", "child.dev", new Set());

    expect(result.app.host).toEqual({
      development: "local:host",
      production: "https://host.child.dev",
    });
  });

  it("resolves multi-level extends chain", async () => {
    const parentConfig: BosConfigInput = PARENT_WITH_HOST;
    const childConfig: BosConfigInput = {
      extends: "bos://parent.near/parent.dev",
      account: "child.near",
      domain: "child.dev",
      app: {
        ui: { production: "https://ui.child.dev" },
        api: { production: "https://api.child.dev" },
      },
    };
    const grandchildConfig: BosConfigInput = {
      extends: "bos://child.near/child.dev",
      account: "grandchild.near",
      domain: "grandchild.dev",
      app: {
        ui: { production: "https://ui.grandchild.dev" },
        api: { production: "https://api.grandchild.dev" },
      },
    };

    fetchBosConfigFromFastKvMock.mockImplementation((url: string) => {
      if (url === "bos://grandchild.near/grandchild.dev") return grandchildConfig;
      if (url === "bos://child.near/child.dev") return childConfig;
      if (url === "bos://parent.near/parent.dev") return parentConfig;
      throw new Error(`No config found for ${url}`);
    });

    const result = await resolveRemoteConfigChain("grandchild.near", "grandchild.dev", new Set());

    expect(result.account).toBe("grandchild.near");
    expect(result.app.host).toEqual(parentConfig.app!.host);
    expect(fetchBosConfigFromFastKvMock).toHaveBeenCalledTimes(3);
  });

  it("throws on circular extends (self-reference)", async () => {
    const circularConfig: BosConfigInput = {
      extends: "bos://circ.near/circ.dev",
      account: "circ.near",
    };

    fetchBosConfigFromFastKvMock.mockResolvedValue(circularConfig);

    await expect(resolveRemoteConfigChain("circ.near", "circ.dev", new Set())).rejects.toThrow(
      /Circular extends/,
    );
  });

  it("throws on circular extends (A -> B -> A)", async () => {
    const configA: BosConfigInput = {
      extends: "bos://b.near/b.dev",
      account: "a.near",
    };
    const configB: BosConfigInput = {
      extends: "bos://a.near/a.dev",
      account: "b.near",
    };

    fetchBosConfigFromFastKvMock.mockImplementation((url: string) => {
      if (url === "bos://a.near/a.dev") return configA;
      if (url === "bos://b.near/b.dev") return configB;
      throw new Error(`No config found for ${url}`);
    });

    await expect(resolveRemoteConfigChain("a.near", "a.dev", new Set())).rejects.toThrow(
      /Circular extends/,
    );
  });

  it("resolves env-specific extends object using production", async () => {
    const childConfig: BosConfigInput = {
      extends: { production: "bos://parent.near/parent.dev" },
      account: "child.near",
      app: {
        ui: { production: "https://ui.child.dev" },
        api: { production: "https://api.child.dev" },
      },
    };

    fetchBosConfigFromFastKvMock.mockImplementation((url: string) => {
      if (url === "bos://child.near/child.dev") return childConfig;
      if (url === "bos://parent.near/parent.dev") return PARENT_WITH_HOST;
      throw new Error(`No config found for ${url}`);
    });

    const result = await resolveRemoteConfigChain("child.near", "child.dev", new Set());

    expect(result.app.host).toEqual(PARENT_WITH_HOST.app!.host);
  });

  it("throws when merged config is missing required app fields", async () => {
    const config: BosConfigInput = {
      account: "bad.near",
    };

    fetchBosConfigFromFastKvMock.mockResolvedValue(config);

    await expect(resolveRemoteConfigChain("bad.near", "bad.dev", new Set())).rejects.toThrow();
  });

  it("child without plugins key inherits parent plugins", async () => {
    const childConfig: BosConfigInput = {
      extends: "bos://parent.near/parent.dev",
      account: "child.near",
    };
    const parentConfig: BosConfigInput = {
      account: "parent.near",
      app: {
        host: { development: "local:host", production: "https://host.parent.dev" },
        ui: { production: "https://ui.parent.dev" },
        api: { production: "https://api.parent.dev" },
      },
      plugins: {
        analytics: { production: "https://analytics.parent.dev" },
      },
    };

    fetchBosConfigFromFastKvMock.mockImplementation((url: string) => {
      if (url === "bos://child.near/child.dev") return childConfig;
      if (url === "bos://parent.near/parent.dev") return parentConfig;
      throw new Error(`No config found for ${url}`);
    });

    const result = await resolveRemoteConfigChain("child.near", "child.dev", new Set());

    expect(result.plugins).toEqual(parentConfig.plugins);
  });

  it("child with null-sentinel plugin removes parent plugin", async () => {
    const childConfig: BosConfigInput = {
      extends: "bos://parent.near/parent.dev",
      account: "child.near",
      plugins: {
        analytics: null,
      },
    };
    const parentConfig: BosConfigInput = {
      account: "parent.near",
      app: {
        host: { development: "local:host", production: "https://host.parent.dev" },
        ui: { production: "https://ui.parent.dev" },
        api: { production: "https://api.parent.dev" },
      },
      plugins: {
        analytics: { production: "https://analytics.parent.dev" },
        apps: { production: "https://apps.parent.dev" },
      },
    };

    fetchBosConfigFromFastKvMock.mockImplementation((url: string) => {
      if (url === "bos://child.near/child.dev") return childConfig;
      if (url === "bos://parent.near/parent.dev") return parentConfig;
      throw new Error(`No config found for ${url}`);
    });

    const result = await resolveRemoteConfigChain("child.near", "child.dev", new Set());

    expect(result.plugins).toEqual({});
  });

  it("unions secrets arrays across parent and child app entries", async () => {
    const childConfig: BosConfigInput = {
      extends: "bos://parent.near/parent.dev",
      account: "child.near",
      app: {
        api: {
          production: "https://api.child.dev",
          secrets: ["CHILD_SECRET"],
        },
      },
    };
    const parentConfig: BosConfigInput = {
      account: "parent.near",
      app: {
        host: { development: "local:host", production: "https://host.parent.dev" },
        ui: { development: "local:ui", production: "https://ui.parent.dev" },
        api: {
          development: "local:api",
          production: "https://api.parent.dev",
          secrets: ["PARENT_SECRET", "SHARED_SECRET"],
        },
      },
    };

    fetchBosConfigFromFastKvMock.mockImplementation((url: string) => {
      if (url === "bos://child.near/child.dev") return childConfig;
      if (url === "bos://parent.near/parent.dev") return parentConfig;
      throw new Error(`No config found for ${url}`);
    });

    const result = await resolveRemoteConfigChain("child.near", "child.dev", new Set());

    const apiSecrets = (result.app.api as Record<string, unknown>).secrets as string[];
    expect(apiSecrets).toContain("CHILD_SECRET");
    expect(apiSecrets).toContain("PARENT_SECRET");
    expect(apiSecrets).toContain("SHARED_SECRET");
    expect(apiSecrets).toHaveLength(3);
  });

  it("child with empty plugins inherits nothing from parent plugins", async () => {
    const childConfig: BosConfigInput = {
      extends: "bos://parent.near/parent.dev",
      account: "child.near",
      plugins: {},
    };
    const parentConfig: BosConfigInput = {
      account: "parent.near",
      app: {
        host: { development: "local:host", production: "https://host.parent.dev" },
        ui: { production: "https://ui.parent.dev" },
        api: { production: "https://api.parent.dev" },
      },
      plugins: {
        analytics: { production: "https://analytics.parent.dev" },
      },
    };

    fetchBosConfigFromFastKvMock.mockImplementation((url: string) => {
      if (url === "bos://child.near/child.dev") return childConfig;
      if (url === "bos://parent.near/parent.dev") return parentConfig;
      throw new Error(`No config found for ${url}`);
    });

    const result = await resolveRemoteConfigChain("child.near", "child.dev", new Set());

    expect(result.plugins).toEqual({});
  });

  it("resolves nested app.auth.extends and resolves production", async () => {
    const authConfig: BosConfigInput = {
      account: "auth.near",
      domain: "auth.dev",
      app: {
        host: { development: "local:host", production: "https://host.auth.dev" },
        ui: { production: "https://ui.auth.dev" },
        api: { production: "https://api.auth.dev" },
        auth: {
          production: "https://auth.prod.dev",
          integrity: "sha384-abc",
          variables: { defaultKey: "default-value", sharedKey: "from-auth" },
        },
      },
    };

    const rootConfig: BosConfigInput = {
      account: "root.near",
      domain: "root.dev",
      app: {
        host: { development: "local:host", production: "https://host.root.dev" },
        ui: { production: "https://ui.root.dev" },
        api: { production: "https://api.root.dev" },
        auth: {
          extends: "bos://auth.near/auth.dev",
          variables: { customKey: "custom-value", sharedKey: "from-root" },
        },
      },
    };

    const childConfig: BosConfigInput = {
      extends: "bos://root.near/root.dev",
      account: "child.near",
      domain: "child.dev",
      app: {
        ui: { production: "https://ui.child.dev" },
        api: { production: "https://api.child.dev" },
      },
    };

    fetchBosConfigFromFastKvMock.mockImplementation((url: string) => {
      if (url === "bos://child.near/child.dev") return childConfig;
      if (url === "bos://root.near/root.dev") return rootConfig;
      if (url === "bos://auth.near/auth.dev") return authConfig;
      throw new Error(`No config found for ${url}`);
    });

    const result = await resolveRemoteConfigChain("child.near", "child.dev", new Set());

    expect(result.app.auth).toBeDefined();
    expect(result.app.auth.production).toBe("https://auth.prod.dev");
    expect(result.app.auth.integrity).toBe("sha384-abc");
    expect(result.app.auth.variables).toEqual({
      customKey: "custom-value",
      defaultKey: "default-value",
      sharedKey: "from-root",
    });
  });

  it("resolves nested plugin extends via chain", async () => {
    const pluginConfig: BosConfigInput = {
      account: "plugin.near",
      domain: "plugin.dev",
      app: {
        host: { development: "local:host", production: "https://host.plugin.dev" },
        ui: { production: "https://ui.plugin.dev" },
        api: { production: "https://api.plugin.dev" },
      },
      plugins: {
        myplugin: {
          production: "https://myplugin.prod.dev",
          integrity: "sha384-def",
          variables: { pluginKey: "plugin-value" },
        },
      },
    };

    const parentConfig: BosConfigInput = {
      account: "parent.near",
      domain: "parent.dev",
      app: {
        host: { development: "local:host", production: "https://host.parent.dev" },
        ui: { production: "https://ui.parent.dev" },
        api: { production: "https://api.parent.dev" },
      },
      plugins: {
        myplugin: {
          extends: "bos://plugin.near/plugin.dev",
          variables: { overrideKey: "override-value" },
        },
      },
    };

    const childConfig: BosConfigInput = {
      extends: "bos://parent.near/parent.dev",
      account: "child.near",
      domain: "child.dev",
      app: {
        ui: { production: "https://ui.child.dev" },
        api: { production: "https://api.child.dev" },
      },
    };

    fetchBosConfigFromFastKvMock.mockImplementation((url: string) => {
      if (url === "bos://child.near/child.dev") return childConfig;
      if (url === "bos://parent.near/parent.dev") return parentConfig;
      if (url === "bos://plugin.near/plugin.dev") return pluginConfig;
      throw new Error(`No config found for ${url}`);
    });

    const result = await resolveRemoteConfigChain("child.near", "child.dev", new Set());

    expect(result.plugins?.myplugin).toBeDefined();
    const myplugin = result.plugins!.myplugin as Record<string, unknown>;
    expect(myplugin.production).toBe("https://myplugin.prod.dev");
    expect(myplugin.integrity).toBe("sha384-def");
    expect((myplugin.variables as Record<string, unknown>).pluginKey).toBe("plugin-value");
    expect((myplugin.variables as Record<string, unknown>).overrideKey).toBe("override-value");
  });
});
