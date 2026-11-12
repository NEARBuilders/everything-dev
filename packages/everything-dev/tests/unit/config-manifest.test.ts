import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRuntimeConfig } from "../../src/config";
import { configInputToDescriptor, toConfigInput } from "../../src/descriptor/resolve";
import { clearRemoteVersionCache } from "../../src/services/deploy/version-manifest";
import { mergeBosConfigWithExtends } from "../../src/services/resolution/merge";
import { BosConfigSchema } from "../../src/types";

const configWithPins = {
  account: "v1.citynode.near",
  domain: "citynode.app",
  app: {
    host: {
      development: "local:host",
      production: "https://cdn/host/",
      digest: { manifest: "versions/aaa.json", integrity: "sha384-host-manifest-sri" },
    },
    ui: {
      development: "local:ui",
      production: "https://cdn/ui/",
      digest: { manifest: "versions/bbb.json", integrity: "sha384-manifest-sri" },
      ssr: "https://cdn/ui/ssr/",
      ssrIntegrity: "sha384-ssr-sri",
    },
    api: {
      development: "local:api",
      production: "https://cdn/api/",
      digest: { manifest: "versions/ccc.json", integrity: "sha384-api-manifest-sri" },
    },
  },
  plugins: {
    auth: {
      name: "@everything-dev/auth-plugin",
      development: "local:plugins/auth",
      production: "https://cdn/auth/",
      digest: { manifest: "versions/ddd.json", integrity: "sha384-auth-manifest-sri" },
      ui: {
        name: "auth-ui",
        development: "local:plugins/auth/ui",
        production: "https://cdn/auth-ui/",
        digest: { manifest: "versions/eee.json", integrity: "sha384-auth-ui-manifest-sri" },
      },
    },
  },
};

describe("config remote `pin`", () => {
  it("survives BosConfigSchema.parse on every remote kind", () => {
    const parsed = BosConfigSchema.parse(configWithPins);
    expect(parsed.app.ui.digest?.manifest).toBe("versions/bbb.json");
    expect(parsed.app.host.digest?.manifest).toBe("versions/aaa.json");
    expect(parsed.app.api.digest?.manifest).toBe("versions/ccc.json");
    expect(parsed.plugins?.auth?.digest?.manifest).toBe("versions/ddd.json");
    expect(parsed.plugins?.auth?.ui?.digest?.manifest).toBe("versions/eee.json");
  });

  it("keeps a remote without a pin valid (direct entry SRI)", () => {
    const parsed = BosConfigSchema.parse({
      account: "a",
      app: {
        host: { development: "local:host", production: "https://cdn/host/" },
        ui: { development: "local:ui", production: "https://cdn/ui/" },
        api: { development: "local:api", production: "https://cdn/api/" },
      },
    });
    expect(parsed.app.ui.digest).toBeUndefined();
  });

  it("survives the descriptor roundtrip (ui remotes carry it like integrity)", () => {
    const descriptor = configInputToDescriptor(configWithPins);
    const authored = toConfigInput(descriptor as never) as typeof configWithPins;
    expect(authored.plugins?.auth?.ui?.digest).toEqual({
      manifest: "versions/eee.json",
      integrity: "sha384-auth-ui-manifest-sri",
    });
  });

  it("extends merge: the pin is atomic — child pin replaces the parent's whole, child without pin inherits", () => {
    const parent = {
      account: "dev.everything.near",
      domain: "everything.dev",
      app: {
        ui: {
          development: "local:ui",
          production: "https://cdn.everything.dev/ui/",
          digest: { manifest: "versions/parent-ui.json", integrity: "sha384-parent-pin" },
        },
      },
    };
    const childOverride = {
      account: "v1.citynode.near",
      domain: "citynode.app",
      app: {
        ui: {
          development: "local:ui",
          digest: { manifest: "versions/child-ui.json", integrity: "sha384-child-pin" },
        },
      },
    };
    const childInherit = {
      account: "v1.citynode.near",
      domain: "citynode.app",
      app: { ui: { development: "local:ui" } },
    };
    // child pin replaces the parent's ATOMICALLY — no half-mixed manifest/integrity
    expect(mergeBosConfigWithExtends(parent, childOverride).app?.ui?.digest).toEqual({
      manifest: "versions/child-ui.json",
      integrity: "sha384-child-pin",
    });
    expect(mergeBosConfigWithExtends(parent, childInherit).app?.ui?.digest).toEqual({
      manifest: "versions/parent-ui.json",
      integrity: "sha384-parent-pin",
    });
  });

  it("extends merge: child plugin entries replace parent entries wholesale (no field-level fill)", () => {
    const parent = {
      account: "dev.everything.near",
      plugins: {
        auth: {
          name: "@everything-dev/auth-plugin",
          digest: { manifest: "versions/parent-auth.json", integrity: "sha384-parent-auth" },
        },
        apps: { name: "apps", digest: { manifest: "versions/parent-apps.json", integrity: "x" } },
      },
    };
    const child = {
      account: "v1.citynode.near",
      plugins: {
        auth: { extends: "auth", production: "https://cdn.everything.dev/auth/" },
      },
    };
    const merged = mergeBosConfigWithExtends(parent, child);
    expect(merged.plugins?.auth?.digest).toBeUndefined();
    expect(merged.plugins?.apps).toBeUndefined();
  });
});

describe("auth mirror version-manifest derivation", () => {
  const sri = (content: string) =>
    `sha384-${createHash("sha384").update(content).digest("base64")}`;

  const makeManifest = (entry: string) => ({
    version: "8f3ac1d2feedbeef",
    builtAt: "2026-09-30T12:00:00.000Z",
    entry,
    entryIntegrity: "sha384-entry",
    ssr: { entry: `remoteEntry.server.${entry}`, integrity: "sha384-ssr" },
  });

  const remotes = {
    host: { base: "https://cdn.mirror.test/host", entry: "remoteEntry.host.js" },
    ui: { base: "https://cdn.mirror.test/ui", entry: "remoteEntry.ui.js" },
    api: { base: "https://cdn.mirror.test/api", entry: "remoteEntry.api.js" },
    auth: { base: "https://cdn.mirror.test/auth", entry: "remoteEntry.auth.js" },
    authUi: { base: "https://cdn.mirror.test/auth-ui", entry: "remoteEntry.auth-ui.js" },
  };

  const bodies = new Map<string, string>(
    Object.values(remotes).map((remote) => [
      `${remote.base}/versions/${remote.entry}.json`,
      JSON.stringify(makeManifest(remote.entry)),
    ]),
  );

  const authMirrorConfig = BosConfigSchema.parse({
    account: "mirror.near",
    domain: "mirror.dev",
    app: {
      host: {
        development: "local:host",
        production: `${remotes.host.base}/`,
        digest: {
          manifest: `versions/${remotes.host.entry}.json`,
          integrity: sri(bodies.get(`${remotes.host.base}/versions/${remotes.host.entry}.json`)!),
        },
      },
      ui: {
        development: "local:ui",
        production: `${remotes.ui.base}/`,
        digest: {
          manifest: `versions/${remotes.ui.entry}.json`,
          integrity: sri(bodies.get(`${remotes.ui.base}/versions/${remotes.ui.entry}.json`)!),
        },
      },
      api: {
        development: "local:api",
        production: `${remotes.api.base}/`,
        digest: {
          manifest: `versions/${remotes.api.entry}.json`,
          integrity: sri(bodies.get(`${remotes.api.base}/versions/${remotes.api.entry}.json`)!),
        },
      },
      auth: {
        name: "@everything-dev/auth-plugin",
        development: "local:plugins/auth",
        production: `${remotes.auth.base}/`,
        digest: {
          manifest: `versions/${remotes.auth.entry}.json`,
          integrity: sri(bodies.get(`${remotes.auth.base}/versions/${remotes.auth.entry}.json`)!),
        },
        ui: {
          name: "auth-ui",
          development: "local:plugins/auth/ui",
          production: `${remotes.authUi.base}/`,
          digest: {
            manifest: `versions/${remotes.authUi.entry}.json`,
            integrity: sri(
              bodies.get(`${remotes.authUi.base}/versions/${remotes.authUi.entry}.json`)!,
            ),
          },
        },
      },
    },
  });

  beforeEach(() => {
    clearRemoteVersionCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const body = bodies.get(String(input));
        if (body === undefined) return new Response("nope", { status: 404 });
        return new Response(body, { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stamps the synthesized plugins.auth mirror and its ui from the same version manifests as app.auth", async () => {
    const runtime = await buildRuntimeConfig(authMirrorConfig, process.cwd(), "production");

    expect(runtime.plugins?.auth).toBeDefined();
    expect(runtime.auth).toBeDefined();
    expect(runtime.plugins?.auth?.entryUrl).toBe(runtime.auth?.entryUrl);
    expect(runtime.plugins?.auth?.entryUrl).toBe(`${remotes.auth.base}/${remotes.auth.entry}`);
    expect(runtime.plugins?.auth?.integrity).toBe(runtime.auth?.integrity);
    expect(runtime.plugins?.auth?.integrity).toBe("sha384-entry");

    expect(runtime.plugins?.auth?.ui?.entryUrl).toBe(runtime.auth?.ui?.entryUrl);
    expect(runtime.plugins?.auth?.ui?.entryUrl).toBe(
      `${remotes.authUi.base}/${remotes.authUi.entry}`,
    );
    expect(runtime.plugins?.auth?.ui?.ssrEntryUrl).toBe(runtime.auth?.ui?.ssrEntryUrl);
    expect(runtime.plugins?.auth?.ui?.ssrEntryUrl).toBe(
      `${remotes.authUi.base}/remoteEntry.server.${remotes.authUi.entry}`,
    );
    expect(runtime.plugins?.auth?.ui?.ssrIntegrity).toBe(runtime.auth?.ui?.ssrIntegrity);
  });
});

describe("dev-env version-manifest derivation", () => {
  const sri = (content: string) =>
    `sha384-${createHash("sha384").update(content).digest("base64")}`;

  const makeManifest = (entry: string) => ({
    version: "8f3ac1d2feedbeef",
    builtAt: "2026-09-30T12:00:00.000Z",
    entry,
    entryIntegrity: "sha384-entry",
  });

  const remotes = {
    host: { base: "https://cdn.dev.test/host", entry: "remoteEntry.host.js" },
    ui: { base: "https://cdn.dev.test/ui", entry: "remoteEntry.ui.js" },
    api: { base: "https://cdn.dev.test/api", entry: "remoteEntry.api.js" },
    auth: { base: "https://cdn.dev.test/auth", entry: "remoteEntry.auth.js" },
  };

  const bodies = new Map<string, string>(
    Object.values(remotes).map((remote) => [
      `${remote.base}/versions/${remote.entry}.json`,
      JSON.stringify(makeManifest(remote.entry)),
    ]),
  );

  const remote = (
    name: keyof typeof remotes,
    opts: { withDevForm?: boolean; withPin?: boolean } = {},
  ) => {
    const base = `${remotes[name].base}/`;
    const pinManifest = `versions/${remotes[name].entry}.json`;
    const bodyKey = `${remotes[name].base}/versions/${remotes[name].entry}.json`;
    const ref = {
      ...(opts.withDevForm === false ? {} : { development: `local:${name}` }),
      production: base,
      ...(opts.withPin === false
        ? {}
        : { digest: { manifest: pinManifest, integrity: sri(bodies.get(bodyKey)!) } }),
    };
    return ref;
  };

  const config = BosConfigSchema.parse({
    account: "child.near",
    domain: "child.dev",
    app: {
      host: remote("host"),
      ui: remote("ui"),
      api: remote("api"),
      auth: { name: "@everything-dev/auth-plugin", ...remote("auth", { withDevForm: false }) },
    },
  });

  const unpinnedConfig = BosConfigSchema.parse({
    account: "child.near",
    domain: "child.dev",
    app: {
      host: remote("host", { withPin: false }),
      ui: remote("ui", { withPin: false }),
      api: remote("api", { withPin: false }),
      auth: {
        name: "@everything-dev/auth-plugin",
        ...remote("auth", { withDevForm: false, withPin: false }),
      },
    },
  });

  beforeEach(() => {
    clearRemoteVersionCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const body = bodies.get(String(input));
        if (body === undefined) return new Response("nope", { status: 404 });
        return new Response(body, { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("derives pinned remote remotes in development exactly like production", async () => {
    const runtime = await buildRuntimeConfig(config, process.cwd(), "development");

    expect(runtime.host.source).toBe("remote");
    expect(runtime.host.entryUrl).toBe(`${remotes.host.base}/${remotes.host.entry}`);
    expect(runtime.ui.entryUrl).toBe(`${remotes.ui.base}/${remotes.ui.entry}`);
    expect(runtime.api.entryUrl).toBe(`${remotes.api.base}/${remotes.api.entry}`);
    expect(runtime.auth?.entryUrl).toBe(`${remotes.auth.base}/${remotes.auth.entry}`);
    expect(runtime.auth?.integrity).toBe("sha384-entry");
  });

  it("skips unpinned remote remotes silently in development", async () => {
    const runtime = await buildRuntimeConfig(unpinnedConfig, process.cwd(), "development");

    expect(runtime.host.entryUrl).toBeUndefined();
    expect(runtime.auth?.entryUrl).toBeUndefined();
  });

  it("degrades a failed pin fetch to warn-and-skip in development", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("offline", { status: 503 })),
    );

    const runtime = await buildRuntimeConfig(config, process.cwd(), "development");

    expect(runtime.host.entryUrl).toBeUndefined();
    expect(runtime.auth?.entryUrl).toBeUndefined();
  });

  it("still throws loudly on an unpinned remote remote in production", async () => {
    await expect(buildRuntimeConfig(unpinnedConfig, process.cwd(), "production")).rejects.toThrow(
      /carries no version-manifest digest/,
    );
  });
});
