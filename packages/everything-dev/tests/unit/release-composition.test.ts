import { describe, expect, it } from "vitest";
import {
  auditReleaseComposition,
  authoredRemoteKeys,
  stampInheritedRemotes,
  workspaceKeyOfRemote,
} from "../../src/services/resolution/release-composition";
import { pinFor, versionManifestFetcher, versionManifestText } from "../helpers/version-manifests";

const record = (base: string, version = "1") => ({
  base,
  digest: {
    manifest: `https://cdn.test/${base}/mf-manifest.json`,
    integrity: `sha384-${base}-${version}`,
  },
});

const consumerShape = (merged: Record<string, unknown>) => merged;

describe("release-composition stamping", () => {
  const remotes = {
    "app.auth": record("https://auth.test/remote"),
    "app.auth.ui": record("https://auth.test/ui"),
    "plugins.ai": record("https://ai.test/remote"),
    "plugins.newcomer": record("https://new.test/remote"),
  };

  const authored = {
    extends: "bos://parent/p.gw",
    app: {
      ui: { extends: "bos://elsewhere/ui" },
      auth: { variables: { ka: "kept" } },
    },
  };

  const merged = {
    extends: "bos://parent/p.gw",
    app: {
      host: { production: "https://live.test/host" },
      ui: {
        production: "https://elsewhere-live.test/ui",
        digest: { manifest: "old", integrity: "old" },
      },
      auth: {
        production: "https://live-parent.test/auth",
        ui: { production: "https://live-parent.test/auth-ui" },
        variables: { ka: "kept" },
      },
    },
    plugins: {
      ai: { name: "ai", production: "https://live-parent.test/ai" },
    },
  };

  it("consumer mode merges the release pins into every inherited entry", () => {
    const config = structuredClone(consumerShape(merged));
    const outcome = stampInheritedRemotes({
      config,
      authoredConfig: structuredClone(authored),
      remotes,
      mode: "consumer",
    });

    expect(outcome.stamped).toEqual(["app.auth", "app.auth.ui", "plugins.ai"]);
    expect(outcome.omitted).toEqual(["plugins.newcomer"]);
    const config1 = config as typeof merged;
    expect(config1.app.auth.production).toBe("https://auth.test/remote");
    expect(config1.app.auth.digest.integrity).toBe("sha384-https://auth.test/remote-1");
    expect(config1.app.auth.ui.production).toBe("https://auth.test/ui");
    expect(config1.app.auth.variables).toEqual({ ka: "kept" });
    expect(config1.plugins.ai.production).toBe("https://ai.test/remote");
    expect("newcomer" in config1.plugins).toBe(false);
  });

  it("keeps child-authored remotes untouched (configuring is not authoring; authoring wins)", () => {
    const authoredConfig = {
      ...authored,
      app: {
        ...authored.app,
        auth: { production: "https://child.test/auth", extends: "bos://child/code" },
      },
    };
    const config = structuredClone(consumerShape(merged));
    const outcome = stampInheritedRemotes({
      config,
      authoredConfig,
      remotes,
      mode: "consumer",
    });
    expect(outcome.stamped).not.toContain("app.auth");
    const config1 = config as typeof merged;
    expect(config1.app.auth.production).toBe("https://live-parent.test/auth");
  });

  it("omits post-release provisioned remotes instead of live-following them", () => {
    const config = structuredClone(consumerShape(merged));
    const outcome = stampInheritedRemotes({
      config,
      authoredConfig: structuredClone(authored),
      remotes,
      mode: "consumer",
    });
    expect(outcome.omitted).toEqual(["plugins.newcomer"]);
    const config1 = config as typeof merged;
    expect("newcomer" in config1.plugins).toBe(false);
  });

  it("payload mode stamps app.* only and creates entries outright (#679 semantics)", () => {
    const config = structuredClone(consumerShape(merged));
    const outcome = stampInheritedRemotes({
      config,
      authoredConfig: structuredClone(authored),
      remotes,
      mode: "payload",
    });
    expect(outcome.stamped).toEqual(["app.auth", "app.auth.ui"]);
    const config1 = config as typeof merged;
    expect(config1.app.auth.ui.production).toBe("https://auth.test/ui");
    expect("newcomer" in config1.plugins).toBe(false);
  });

  it("a manifest without remotes stamps nothing — pre-remotes releases degrade to live-follow", () => {
    const config = structuredClone(consumerShape(merged));
    const outcome = stampInheritedRemotes({
      config,
      authoredConfig: structuredClone(authored),
      remotes: undefined,
      mode: "consumer",
    });
    expect(outcome.stamped).toEqual([]);
    expect(outcome.omitted).toEqual([]);
    expect((config as typeof merged).app.auth.production).toBe("https://live-parent.test/auth");
  });

  it("authoredRemoteKeys treats configuring entries as non-authored and bare plugin refs as full owners", () => {
    const paths = authoredRemoteKeys({
      app: { auth: { variables: {} }, host: { production: "x" } },
      plugins: { votes: "bos://plats/votes" },
    });
    expect(paths.has("app.auth")).toBe(false);
    expect(paths.has("app.host")).toBe(true);
    expect(paths.has("plugins.votes")).toBe(true);
    expect(paths.has("plugins.votes.ui")).toBe(true);
  });
});

describe("auditReleaseComposition — the dev chain audit", () => {
  const digest = pinFor("mf-manifest.json", {
    "every-plugin": "3.0.0-rc.15",
    effect: "4.0.0-rc.118",
  });
  const remoteInputs = [
    {
      remote: "plugins.auth",
      base: "https://auth-rc28.test",
      digest,
    },
  ];
  const fetch = versionManifestFetcher({
    "https://auth-rc28.test/mf-manifest.json": versionManifestText({
      "every-plugin": "3.0.0-rc.15",
      effect: "4.0.0-rc.118",
    }),
  });

  it("coherent strict singletons say nothing", async () => {
    const lines = await auditReleaseComposition({
      remotes: remoteInputs,
      authoredPaths: new Set(),
      localVersionOf: (name) => (name === "every-plugin" ? "3.0.0-rc.15" : "4.0.0-rc.118"),
      fetchImpl: fetch,
    });
    expect(lines).toEqual([]);
  });

  it("an inherited remote lagging the exact strict singleton names bos upgrade", async () => {
    const lines = await auditReleaseComposition({
      remotes: remoteInputs,
      authoredPaths: new Set(),
      localVersionOf: (name) => (name === "every-plugin" ? "3.0.0-rc.14" : "4.0.0-rc.118"),
      fetchImpl: fetch,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.remote).toBe("plugins.auth");
    expect(lines[0]!.kind).toBe("inherited");
    expect(lines[0]!.message).toContain("run bos upgrade");
  });

  it("an owned remote ahead of the runtime names bos plugin publish", async () => {
    const lines = await auditReleaseComposition({
      remotes: [
        {
          remote: "plugins.nostr",
          base: "https://nostr-rc28.test",
          digest: pinFor("mf-manifest.json", { "every-plugin": "3.0.0-rc.15" }),
        },
      ],
      authoredPaths: new Set(["plugins.nostr"]),
      localVersionOf: (name) => (name === "every-plugin" ? "3.0.0-rc.14" : undefined),
      fetchImpl: versionManifestFetcher({
        "https://nostr-rc28.test/mf-manifest.json": versionManifestText({
          "every-plugin": "3.0.0-rc.15",
        }),
      }),
    });
    expect(lines[0]!.kind).toBe("owned");
    expect(lines[0]!.message).toContain("run bos plugin publish nostr");
  });

  it("an owned app remote names the scoped deploy train, not plugin publish", async () => {
    const lines = await auditReleaseComposition({
      remotes: [
        {
          remote: "app.ui",
          base: "https://ui-rc28.test",
          digest: pinFor("mf-manifest.json", { react: "19.3.1" }),
        },
      ],
      authoredPaths: new Set(["app.ui"]),
      localVersionOf: (name) => (name === "react" ? "19.2.0" : undefined),
      fetchImpl: versionManifestFetcher({
        "https://ui-rc28.test/mf-manifest.json": versionManifestText({ react: "19.3.1" }),
      }),
    });
    expect(lines[0]!.kind).toBe("owned");
    expect(lines[0]!.message).toContain("run bos deploy --packages ui");
  });

  it("an unservable digest reports on its remote", async () => {
    const lines = await auditReleaseComposition({
      remotes: [
        {
          remote: "plugins.ghost",
          base: "https://ghost.test",
          digest: pinFor("mf-manifest.json", {}),
        },
      ],
      authoredPaths: new Set(),
      localVersionOf: () => undefined,
      fetchImpl: versionManifestFetcher({}),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.message).toContain("does not serve at its production URL");
  });

  it("a pinned child composing a coherent subset plane is clean — the opencrosspost rc.30 regression", async () => {
    // The exact shape that produced ten false divergences: pinned app remotes
    // whose shared versions match the runtime exactly, plus inherited plugin
    // remotes the child's own plugins domain (wholesale replace) does not
    // compose. With the probe fed the catalog's versions, the only lines are
    // uncomposed notes — no "react@unknown", no "run bos upgrade".
    const remoteInputs = [
      {
        remote: "app.ui",
        base: "https://ui.test",
        digest: pinFor("mf-manifest.json", { react: "19.3.1" }),
      },
      {
        remote: "app.api",
        base: "https://api.test",
        digest: pinFor("mf-manifest.json", { "@orpc/client": "2.0.0-beta.45" }),
      },
      {
        remote: "app.auth",
        base: "https://auth.test",
        digest: pinFor("mf-manifest.json", { "@orpc/client": "2.0.0-beta.45" }),
      },
      {
        remote: "app.auth.ui",
        base: "https://auth-ui.test",
        digest: pinFor("mf-manifest.json", { react: "19.3.1" }),
      },
    ];
    const fetchImpl = versionManifestFetcher({
      "https://ui.test/mf-manifest.json": versionManifestText({ react: "19.3.1" }),
      "https://api.test/mf-manifest.json": versionManifestText({
        "@orpc/client": "2.0.0-beta.45",
      }),
      "https://auth.test/mf-manifest.json": versionManifestText({
        "@orpc/client": "2.0.0-beta.45",
      }),
      "https://auth-ui.test/mf-manifest.json": versionManifestText({ react: "19.3.1" }),
    });
    const lines = await auditReleaseComposition({
      remotes: remoteInputs,
      authoredPaths: new Set([
        "app.ui",
        "app.api",
        "plugins.auth",
        "plugins.connectors",
        "plugins.twitter",
      ]),
      localVersionOf: (name) => {
        const catalog: Record<string, string> = {
          react: "19.3.1",
          "@orpc/client": "2.0.0-beta.45",
        };
        return catalog[name];
      },
      provisionedRemotes: [
        "plugins.ai",
        "plugins.ai.ui",
        "plugins.proposals",
        "plugins.registry",
        "plugins.template",
        "plugins.votes",
      ],
      configRemotePaths: [
        "app.ui",
        "app.api",
        "plugins.auth",
        "plugins.connectors",
        "plugins.twitter",
      ],
      manifestRemotePaths: [
        "app.ui",
        "app.api",
        "app.auth",
        "app.auth.ui",
        "plugins.ai",
        "plugins.ai.ui",
        "plugins.proposals",
        "plugins.registry",
        "plugins.template",
        "plugins.votes",
      ],
      pinnedReleaseVersion: "2.0.0-rc.30",
      fetchImpl,
    });
    expect(lines.every((line) => line.kind === "uncomposed")).toBe(true);
    expect(lines.some((line) => line.message.includes("unknown"))).toBe(false);
    expect(lines.some((line) => line.message.includes("bos upgrade"))).toBe(false);
  });

  it("a remote built against the ui/auth subpath singleton matches through the base package (opencrosspost rc.38 regression)", async () => {
    // The exact shape that produced false divergences on every rc.38 child:
    // ui/auth-ui bundles embed `everything-dev/ui/auth@<release>` in their
    // shared maps, and the subpath name never resolves as a local package —
    // no own package.json or catalog row — so the probe printed @unknown and
    // the repair instructions (redeploy / upgrade) could never clear it. The
    // probe now falls back to the base package's installed version.
    const lines = await auditReleaseComposition({
      remotes: [
        {
          remote: "app.ui",
          base: "https://ui-rc38.test",
          digest: pinFor("mf-manifest.json", {
            react: "19.3.1",
            "everything-dev/ui/auth": "2.0.0-rc.38",
          }),
        },
        {
          remote: "app.auth.ui",
          base: "https://auth-ui-rc38.test",
          digest: pinFor("mf-manifest.json", {
            react: "19.3.1",
            "everything-dev/ui/auth": "2.0.0-rc.38",
          }),
        },
      ],
      authoredPaths: new Set(["app.ui"]),
      localVersionOf: (name) => {
        const catalog: Record<string, string> = {
          react: "19.3.1",
          "everything-dev": "2.0.0-rc.38",
        };
        return catalog[name];
      },
      fetchImpl: versionManifestFetcher({
        "https://ui-rc38.test/mf-manifest.json": versionManifestText({
          react: "19.3.1",
          "everything-dev/ui/auth": "2.0.0-rc.38",
        }),
        "https://auth-ui-rc38.test/mf-manifest.json": versionManifestText({
          react: "19.3.1",
          "everything-dev/ui/auth": "2.0.0-rc.38",
        }),
      }),
    });
    expect(lines).toEqual([]);
  });

  it("a subpath singleton the base package genuinely lags still names the divergence", async () => {
    const lines = await auditReleaseComposition({
      remotes: [
        {
          remote: "app.auth.ui",
          base: "https://auth-ui-rc38.test",
          digest: pinFor("mf-manifest.json", {
            "everything-dev/ui/auth": "2.0.0-rc.38",
            "@orpc/client": "2.0.0-beta.45",
          }),
        },
      ],
      authoredPaths: new Set(),
      localVersionOf: (name) => {
        const catalog: Record<string, string> = {
          "everything-dev": "2.0.0-rc.37",
          "@orpc/client": "2.0.0-beta.45",
        };
        return catalog[name];
      },
      fetchImpl: versionManifestFetcher({
        "https://auth-ui-rc38.test/mf-manifest.json": versionManifestText({
          "everything-dev/ui/auth": "2.0.0-rc.38",
          "@orpc/client": "2.0.0-beta.45",
        }),
      }),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.message).toContain("everything-dev/ui/auth@2.0.0-rc.38");
    expect(lines[0]!.message).toContain("this runtime composes everything-dev/ui/auth@2.0.0-rc.37");
  });

  it("the auth mirror over a recorded app.auth composes pinned bytes — no provisioned line (opencrosspost rc.38 regression)", async () => {
    // config.ts adds a plugins.auth entry mirroring app.auth (the plugin
    // runtime's compose surface); its pins live on app.auth, which the
    // release manifest records — the mirror composes the same pinned bytes,
    // not "live, unpinned bytes".
    const lines = await auditReleaseComposition({
      remotes: [],
      authoredPaths: new Set(),
      localVersionOf: () => undefined,
      provisionedRemotes: [],
      manifestRemotePaths: ["app.auth", "app.auth.ui", "app.ui"],
      configRemotePaths: ["app.auth", "app.auth.ui", "plugins.auth", "app.ui"],
      pinnedReleaseVersion: "2.0.0-rc.38",
      fetchImpl: fetch,
    });
    expect(lines).toEqual([]);
  });

  it("the auth mirror over an unrecorded app.auth is genuinely provisioned", async () => {
    const lines = await auditReleaseComposition({
      remotes: [],
      authoredPaths: new Set(),
      localVersionOf: () => undefined,
      provisionedRemotes: [],
      manifestRemotePaths: [],
      configRemotePaths: ["plugins.auth"],
      pinnedReleaseVersion: "2.0.0-rc.30",
      fetchImpl: fetch,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.remote).toBe("plugins.auth");
    expect(lines[0]!.kind).toBe("provisioned");
    expect(lines[0]!.message).toContain("run bos upgrade to re-pin and claim it");
  });

  it("a manifest remote the merged config does not compose is an uncomposed note, not an upgrade", async () => {
    const lines = await auditReleaseComposition({
      remotes: [],
      authoredPaths: new Set(),
      localVersionOf: () => undefined,
      provisionedRemotes: ["plugins.warden"],
      manifestRemotePaths: ["plugins.warden"],
      configRemotePaths: [],
      pinnedReleaseVersion: "2.0.0-rc.28",
      fetchImpl: fetch,
    });
    expect(lines[0]!.kind).toBe("uncomposed");
    expect(lines[0]!.message).toContain("not composed by this config");
    expect(lines[0]!.message).not.toContain("bos upgrade");
  });

  it("a config remote the pinned manifest lacks is genuinely provisioned — upgrade claims it", async () => {
    const lines = await auditReleaseComposition({
      remotes: [],
      authoredPaths: new Set(),
      localVersionOf: () => undefined,
      provisionedRemotes: [],
      manifestRemotePaths: ["plugins.other"],
      configRemotePaths: ["plugins.warden", "plugins.other"],
      pinnedReleaseVersion: "2.0.0-rc.28",
      fetchImpl: fetch,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.remote).toBe("plugins.warden");
    expect(lines[0]!.kind).toBe("provisioned");
    expect(lines[0]!.message).toContain("run bos upgrade to re-pin and claim it");
  });

  it("an authored remote absent from the manifest is the leaf's own decision — no line", async () => {
    const lines = await auditReleaseComposition({
      remotes: [],
      authoredPaths: new Set(["plugins.warden"]),
      localVersionOf: () => undefined,
      provisionedRemotes: [],
      manifestRemotePaths: [],
      configRemotePaths: ["plugins.warden"],
      pinnedReleaseVersion: "2.0.0-rc.28",
      fetchImpl: fetch,
    });
    expect(lines).toEqual([]);
  });
});

describe("workspaceKeyOfRemote — remote paths to publish keys", () => {
  it.each([
    ["app.ui", "ui"],
    ["app.api", "api"],
    ["app.host", "host"],
    ["app.auth", "auth"],
    ["app.auth.ui", "auth"],
    ["plugins.nostr", "nostr"],
    ["plugins.nostr.ui", "nostr"],
  ])("maps %s to %s", (remote, key) => {
    expect(workspaceKeyOfRemote(remote)).toBe(key);
  });
});
