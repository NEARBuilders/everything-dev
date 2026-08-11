import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDependencyDAG,
  getDependenciesForNode,
  getImplicitApiDependencies,
  getSingletonKey,
  manifestPluginsToNodes,
  mergeManifestNodes,
  normalizeToNodes,
  topologicalSort,
} from "../../src/dag";
import type { RuntimeConfig, RuntimeDependencyNode } from "../../src/types";

const { fetchApiPluginManifestMock } = vi.hoisted(() => ({
  fetchApiPluginManifestMock: vi.fn().mockRejectedValue(new Error("not mocked")),
}));

vi.mock("../../src/api-contract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api-contract")>();
  return {
    ...actual,
    fetchApiPluginManifest: fetchApiPluginManifestMock,
  };
});

function makeRuntimeConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    env: "development",
    account: "test.near",
    networkId: "testnet",
    host: {
      name: "host",
      url: "http://localhost:3000",
      entry: "http://localhost:3000/mf-manifest.json",
      source: "local",
      localPath: "/host",
    },
    ui: {
      name: "ui",
      url: "http://localhost:3003",
      entry: "http://localhost:3003/mf-manifest.json",
      source: "local",
      localPath: "/ui",
    },
    api: {
      name: "api",
      url: "http://localhost:3001",
      entry: "http://localhost:3001/mf-manifest.json",
      source: "local",
      localPath: "/api",
    },
    plugins: {},
    ...overrides,
  };
}

function makePluginEntry(
  key: string,
  url: string,
  extra?: Partial<RuntimeDependencyNode>,
): [string, RuntimeDependencyNode] {
  return [
    key,
    {
      key,
      kind: "plugin",
      name: key,
      url,
      entry: `${url}/mf-manifest.json`,
      source: "remote",
      sourceOrigin: "config",
      singletonKey: `plugin:${key}:${url}`,
      ...extra,
    },
  ];
}

function makePluginNode(
  key: string,
  url: string,
  extra?: Partial<RuntimeDependencyNode>,
): RuntimeDependencyNode {
  return makePluginEntry(key, url, extra)[1];
}

function makeApiNode(extra?: Partial<RuntimeDependencyNode>): [string, RuntimeDependencyNode] {
  return [
    "api",
    {
      key: "api",
      kind: "api",
      name: "api",
      url: "http://api",
      entry: "http://api/mf-manifest.json",
      source: "local",
      sourceOrigin: "config",
      singletonKey: "api:http://api",
      ...extra,
    },
  ];
}

function makeUiNode(extra?: Partial<RuntimeDependencyNode>): [string, RuntimeDependencyNode] {
  return [
    "ui",
    {
      key: "ui",
      kind: "ui",
      name: "ui",
      url: "http://ui",
      entry: "http://ui/mf-manifest.json",
      source: "local",
      sourceOrigin: "config",
      singletonKey: "ui:http://ui",
      ...extra,
    },
  ];
}

describe("normalizeToNodes", () => {
  it("converts api, auth, ui, and plugins into unified nodes", () => {
    const config = makeRuntimeConfig({
      auth: {
        name: "auth",
        url: "http://localhost:3002",
        entry: "http://localhost:3002/mf-manifest.json",
        source: "local",
        localPath: "/auth",
      },
      plugins: {
        apps: {
          name: "apps",
          url: "http://localhost:3010",
          entry: "http://localhost:3010/mf-manifest.json",
          source: "local",
          localPath: "/plugins/apps",
        },
      },
    });

    const nodes = normalizeToNodes(config);

    expect(nodes.size).toBe(4);
    expect(nodes.get("api")?.kind).toBe("api");
    expect(nodes.get("auth")?.kind).toBe("auth");
    expect(nodes.get("ui")?.kind).toBe("ui");
    expect(nodes.get("apps")?.kind).toBe("plugin");
  });

  it("preserves dependsOn from plugin config", () => {
    const config = makeRuntimeConfig({
      plugins: {
        myPlugin: {
          name: "myPlugin",
          url: "http://localhost:3011",
          entry: "http://localhost:3011/mf-manifest.json",
          source: "local",
          localPath: "/plugins/myPlugin",
          dependsOn: ["apps", "auth"],
        },
      },
    });

    const nodes = normalizeToNodes(config);
    expect(nodes.get("myPlugin")?.dependsOn).toEqual(["apps", "auth"]);
  });

  it("passes through connectSrc from plugin config", () => {
    const config = makeRuntimeConfig({
      plugins: {
        apps: {
          name: "apps",
          url: "http://localhost:3010",
          entry: "http://localhost:3010/mf-manifest.json",
          source: "local",
          localPath: "/plugins/apps",
          connectSrc: ["wss://relay.damus.io"],
        },
      },
    });

    const nodes = normalizeToNodes(config);
    expect(nodes.get("apps")?.connectSrc).toEqual(["wss://relay.damus.io"]);
  });

  it("preserves dependsOn from api config", () => {
    const config = makeRuntimeConfig({
      api: {
        name: "api",
        url: "http://localhost:3001",
        entry: "http://localhost:3001/mf-manifest.json",
        source: "local",
        localPath: "/api",
        dependsOn: ["apps"],
      },
    });

    const nodes = normalizeToNodes(config);
    expect(nodes.get("api")?.dependsOn).toEqual(["apps"]);
  });

  it("skips plugins without a url", () => {
    const config = makeRuntimeConfig({
      plugins: {
        broken: {
          name: "broken",
          url: "",
          entry: "",
          source: "local",
        },
      },
    });

    const nodes = normalizeToNodes(config);
    expect(nodes.has("broken")).toBe(false);
  });

  it("sets singletonKey for each node", () => {
    const config = makeRuntimeConfig({
      plugins: {
        apps: {
          name: "apps",
          url: "http://localhost:3010",
          entry: "http://localhost:3010/mf-manifest.json",
          source: "local",
          localPath: "/plugins/apps",
        },
      },
    });

    const nodes = normalizeToNodes(config);
    expect(nodes.get("api")?.singletonKey).toBe("api:http://localhost:3001");
    expect(nodes.get("apps")?.singletonKey).toBe("plugin:apps:http://localhost:3010");
  });
});

describe("topologicalSort", () => {
  it("returns nodes with no dependencies first", () => {
    const nodes = new Map<string, RuntimeDependencyNode>([
      makePluginEntry("pluginA", "http://a", { dependsOn: ["pluginB"] }),
      makePluginEntry("pluginB", "http://b"),
    ]);

    const sorted = topologicalSort(nodes);
    expect(sorted.indexOf("pluginB")).toBeLessThan(sorted.indexOf("pluginA"));
  });

  it("handles chains: A depends on B depends on C", () => {
    const nodes = new Map<string, RuntimeDependencyNode>([
      makePluginEntry("A", "http://a", { dependsOn: ["B"] }),
      makePluginEntry("B", "http://b", { dependsOn: ["C"] }),
      makePluginEntry("C", "http://c"),
    ]);

    const sorted = topologicalSort(nodes);
    expect(sorted).toEqual(["C", "B", "A"]);
  });

  it("throws on circular dependencies", () => {
    const nodes = new Map<string, RuntimeDependencyNode>([
      makePluginEntry("A", "http://a", { dependsOn: ["B"] }),
      makePluginEntry("B", "http://b", { dependsOn: ["A"] }),
    ]);

    expect(() => topologicalSort(nodes)).toThrow(/Circular dependency/);
  });

  it("throws with node names in cycle", () => {
    const nodes = new Map<string, RuntimeDependencyNode>([
      makePluginEntry("X", "http://x", { dependsOn: ["Y"] }),
      makePluginEntry("Y", "http://y", { dependsOn: ["Z"] }),
      makePluginEntry("Z", "http://z", { dependsOn: ["X"] }),
    ]);

    expect(() => topologicalSort(nodes)).toThrow(/X.*Y.*Z|Z.*Y.*X/);
  });

  it("ignores dependsOn entries that don't exist in the node set", () => {
    const nodes = new Map<string, RuntimeDependencyNode>([
      makePluginEntry("A", "http://a", { dependsOn: ["nonexistent"] }),
    ]);

    const sorted = topologicalSort(nodes);
    expect(sorted).toEqual(["A"]);
  });

  it("API implicitly depends on all other non-ui nodes when no explicit dependsOn", () => {
    const nodes = new Map<string, RuntimeDependencyNode>([
      makeApiNode(),
      makePluginEntry("pluginA", "http://a"),
      makePluginEntry("pluginB", "http://b"),
      makeUiNode(),
    ]);

    const sorted = topologicalSort(nodes);
    expect(sorted.indexOf("pluginA")).toBeLessThan(sorted.indexOf("api"));
    expect(sorted.indexOf("pluginB")).toBeLessThan(sorted.indexOf("api"));
  });

  it("API with explicit dependsOn does NOT get implicit deps", () => {
    const nodes = new Map<string, RuntimeDependencyNode>([
      makeApiNode({ dependsOn: ["pluginA"] }),
      makePluginEntry("pluginA", "http://a"),
      makePluginEntry("pluginB", "http://b"),
    ]);

    const sorted = topologicalSort(nodes);
    expect(sorted.indexOf("pluginA")).toBeLessThan(sorted.indexOf("api"));
  });

  it("preserves alphabetical order for independent nodes", () => {
    const nodes = new Map<string, RuntimeDependencyNode>([
      makePluginEntry("zebra", "http://z"),
      makePluginEntry("alpha", "http://a"),
      makePluginEntry("middle", "http://m"),
    ]);

    const sorted = topologicalSort(nodes);
    expect(sorted).toEqual(["alpha", "middle", "zebra"]);
  });
});

describe("getImplicitApiDependencies", () => {
  it("returns all non-ui nodes for API with no explicit dependsOn", () => {
    const nodes = new Map<string, RuntimeDependencyNode>([
      makeApiNode(),
      makePluginEntry("pluginA", "http://a"),
      makePluginEntry("pluginB", "http://b"),
      makeUiNode(),
      makePluginEntry("auth", "http://auth", { kind: "auth" }),
    ]);

    const deps = getImplicitApiDependencies(nodes);
    expect(deps).toEqual(expect.arrayContaining(["pluginA", "pluginB", "auth"]));
    expect(deps).not.toContain("api");
    expect(deps).not.toContain("ui");
  });

  it("returns empty array when only api and ui exist", () => {
    const nodes = new Map<string, RuntimeDependencyNode>([makeApiNode(), makeUiNode()]);

    expect(getImplicitApiDependencies(nodes)).toEqual([]);
  });
});

describe("buildRuntimeConfig nodes field", () => {
  let w: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    w = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => w.mockRestore());

  it("includes nodes populated by normalizeToNodes", async () => {
    const { buildRuntimeConfig } = await import("../../src/config");
    const config: RuntimeConfig = {
      env: "development",
      account: "test.near",
      networkId: "testnet",
      host: {
        name: "host",
        url: "http://localhost:3000",
        entry: "http://localhost:3000/mf-manifest.json",
        source: "local",
        localPath: "/host",
      },
      ui: {
        name: "ui",
        url: "http://localhost:3003",
        entry: "http://localhost:3003/mf-manifest.json",
        source: "local",
        localPath: "/ui",
      },
      api: {
        name: "api",
        url: "http://localhost:3001",
        entry: "http://localhost:3001/mf-manifest.json",
        source: "local",
        localPath: "/api",
      },
      plugins: {},
    };

    expect(config.nodes).toBeUndefined();

    const result = await buildRuntimeConfig(
      {
        account: "test.near",
        extends: "dev.everything.near/dev.everything.dev",
        app: {
          host: {
            name: "host",
            development: "http://localhost:3000",
            production: "http://host.com",
          },
          ui: { name: "ui", development: "http://localhost:3003", production: "http://ui.com" },
          api: { name: "api", development: "http://localhost:3001", production: "http://api.com" },
        },
      } as any,
      "/tmp",
      "development",
    );

    const dag = buildDependencyDAG(result);
    expect(dag.nodes.has("api")).toBe(true);
    expect(dag.nodes.get("api")?.kind).toBe("api");
    expect(dag.nodes.has("ui")).toBe(true);
    expect(dag.nodes.get("ui")?.kind).toBe("ui");
  });
});

describe("buildDependencyDAG", () => {
  it("builds and sorts a complete DAG from RuntimeConfig", () => {
    const config = makeRuntimeConfig({
      auth: {
        name: "auth",
        url: "http://localhost:3002",
        entry: "http://localhost:3002/mf-manifest.json",
        source: "local",
        localPath: "/auth",
      },
      plugins: {
        apps: {
          name: "apps",
          url: "http://localhost:3010",
          entry: "http://localhost:3010/mf-manifest.json",
          source: "local",
          localPath: "/plugins/apps",
        },
        composite: {
          name: "composite",
          url: "http://localhost:3011",
          entry: "http://localhost:3011/mf-manifest.json",
          source: "local",
          localPath: "/plugins/composite",
          dependsOn: ["apps", "auth"],
        },
      },
    });

    const dag = buildDependencyDAG(config);
    expect(dag.nodes.size).toBe(5);
    expect(dag.sorted.indexOf("apps")).toBeLessThan(dag.sorted.indexOf("composite"));
    expect(dag.sorted.indexOf("auth")).toBeLessThan(dag.sorted.indexOf("composite"));
    expect(dag.sorted.indexOf("composite")).toBeLessThan(dag.sorted.indexOf("api"));
  });
});

describe("mergeManifestNodes", () => {
  it("adds manifest nodes that don't exist in config", () => {
    const configNodes = new Map<string, RuntimeDependencyNode>([
      makePluginEntry("apps", "http://apps", { sourceOrigin: "config" }),
    ]);

    const manifestNodes = [
      makePluginNode("discovered", "http://discovered", { sourceOrigin: "manifest" }),
    ];

    const merged = mergeManifestNodes(configNodes, manifestNodes);
    expect(merged.size).toBe(2);
    expect(merged.get("discovered")?.sourceOrigin).toBe("manifest");
  });

  it("does not override config-declared nodes with manifest nodes", () => {
    const configNodes = new Map<string, RuntimeDependencyNode>([
      makePluginEntry("apps", "http://my-custom-apps", { sourceOrigin: "config" }),
    ]);

    const manifestNodes = [
      makePluginNode("apps", "http://apps.nearbuilders.org", { sourceOrigin: "manifest" }),
    ];

    const merged = mergeManifestNodes(configNodes, manifestNodes);
    expect(merged.get("apps")?.url).toBe("http://my-custom-apps");
    expect(merged.get("apps")?.sourceOrigin).toBe("config");
  });
});

describe("getDependenciesForNode", () => {
  it("returns explicit dependsOn entries", () => {
    const allNodes = new Map<string, RuntimeDependencyNode>([
      makePluginEntry("A", "http://a"),
      makePluginEntry("B", "http://b"),
      makePluginEntry("C", "http://c", { dependsOn: ["A", "B"] }),
    ]);

    const deps = getDependenciesForNode(allNodes.get("C")!, allNodes);
    expect(deps.map((d) => d.key)).toEqual(["A", "B"]);
  });

  it("returns all non-ui siblings for API with no explicit dependsOn", () => {
    const allNodes = new Map<string, RuntimeDependencyNode>([
      makeApiNode(),
      makePluginEntry("pluginA", "http://a"),
      makeUiNode(),
    ]);

    const deps = getDependenciesForNode(allNodes.get("api")!, allNodes);
    expect(deps.map((d) => d.key)).toEqual(["pluginA"]);
  });

  it("returns only explicit deps for API with explicit dependsOn", () => {
    const allNodes = new Map<string, RuntimeDependencyNode>([
      makeApiNode({ dependsOn: ["pluginA"] }),
      makePluginEntry("pluginA", "http://a"),
      makePluginEntry("pluginB", "http://b"),
    ]);

    const deps = getDependenciesForNode(allNodes.get("api")!, allNodes);
    expect(deps.map((d) => d.key)).toEqual(["pluginA"]);
  });
});

describe("manifestPluginsToNodes", () => {
  it("converts manifest plugin entries to nodes with sourceOrigin manifest", () => {
    const nodes = manifestPluginsToNodes([
      { key: "discovered", name: "Discovered", url: "http://d.cdn", dependsOn: ["auth"] },
    ]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("plugin");
    expect(nodes[0].sourceOrigin).toBe("manifest");
    expect(nodes[0].source).toBe("remote");
    expect(nodes[0].entry).toBe("http://d.cdn/mf-manifest.json");
    expect(nodes[0].dependsOn).toEqual(["auth"]);
    expect(nodes[0].singletonKey).toBe("plugin:discovered:http://d.cdn");
  });

  it("passes through secrets and variables", () => {
    const nodes = manifestPluginsToNodes([
      {
        key: "billing",
        name: "Billing",
        url: "http://billing.cdn",
        secrets: ["STRIPE_KEY"],
        variables: { TIMEOUT: 5000 },
      },
    ]);

    expect(nodes[0].secrets).toEqual(["STRIPE_KEY"]);
    expect(nodes[0].variables).toEqual({ TIMEOUT: 5000 });
  });

  it("returns empty array for undefined or empty input", () => {
    expect(manifestPluginsToNodes([])).toEqual([]);
    expect(manifestPluginsToNodes(undefined as any)).toEqual([]);
  });
});

describe("buildDependencyDAG with config.nodes", () => {
  it("uses config.nodes when populated instead of normalizing from scratch", () => {
    const config = makeRuntimeConfig({
      auth: {
        name: "auth",
        url: "http://localhost:3002",
        entry: "http://localhost:3002/mf-manifest.json",
        source: "local",
      },
      plugins: {
        manifestPlugin: {
          name: "manifestPlugin",
          url: "http://manifest.cdn",
          entry: "http://manifest.cdn/mf-manifest.json",
          source: "remote",
          dependsOn: ["auth"],
        },
      },
    });
    config.nodes = {
      api: {
        key: "api",
        kind: "api",
        name: "api",
        url: "http://localhost:3001",
        entry: "http://localhost:3001/mf-manifest.json",
        source: "local",
        sourceOrigin: "config",
        singletonKey: "api:http://localhost:3001",
      },
      auth: {
        key: "auth",
        kind: "auth",
        name: "auth",
        url: "http://localhost:3002",
        entry: "http://localhost:3002/mf-manifest.json",
        source: "local",
        sourceOrigin: "config",
        singletonKey: "auth:http://localhost:3002",
      },
      ui: {
        key: "ui",
        kind: "ui",
        name: "ui",
        url: "http://localhost:3003",
        entry: "http://localhost:3003/mf-manifest.json",
        source: "local",
        sourceOrigin: "config",
        singletonKey: "ui:http://localhost:3003",
      },
      manifestPlugin: {
        key: "manifestPlugin",
        kind: "plugin",
        name: "manifestPlugin",
        url: "http://manifest.cdn",
        entry: "http://manifest.cdn/mf-manifest.json",
        source: "remote",
        sourceOrigin: "manifest",
        dependsOn: ["auth"],
        singletonKey: "plugin:manifestPlugin:http://manifest.cdn",
      },
    };

    const dag = buildDependencyDAG(config);

    expect(dag.nodes.get("manifestPlugin")?.sourceOrigin).toBe("manifest");
    expect(dag.sorted.indexOf("auth")).toBeLessThan(dag.sorted.indexOf("manifestPlugin"));
  });

  it("falls back to normalizeToNodes when config.nodes is empty", () => {
    const config = makeRuntimeConfig({
      plugins: {
        apps: {
          name: "apps",
          url: "http://localhost:3010",
          entry: "http://localhost:3010/mf-manifest.json",
          source: "local",
        },
      },
    });

    const dag = buildDependencyDAG(config);
    expect(dag.nodes.get("apps")?.sourceOrigin).toBe("config");
  });
});

describe("getSingletonKey", () => {
  it("uses the singletonKey field when present", () => {
    const node = makePluginNode("apps", "http://apps", {
      singletonKey: "custom:single:key",
    });
    expect(getSingletonKey(node)).toBe("custom:single:key");
  });

  it("falls back to kind:key:url", () => {
    const node = makePluginNode("apps", "http://apps");
    node.singletonKey = undefined;
    expect(getSingletonKey(node)).toBe("plugin:apps:http://apps");
  });
});
