import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRuntimeConfig } from "../../src/config";
import { configInputToDescriptor, toConfigInput } from "../../src/descriptor/resolve";
import { mergeBosConfigWithExtends } from "../../src/merge";
import { BosConfigSchema } from "../../src/types";
import { clearSlotVersionCache } from "../../src/version-manifest-resolve";

const configWithPins = {
  account: "v1.citynode.near",
  domain: "citynode.app",
  app: {
    host: {
      development: "local:host",
      production: "https://cdn/host/",
      pin: { manifest: "versions/aaa.json", integrity: "sha384-host-manifest-sri" },
    },
    ui: {
      development: "local:ui",
      production: "https://cdn/ui/",
      pin: { manifest: "versions/bbb.json", integrity: "sha384-manifest-sri" },
      ssr: "https://cdn/ui/ssr/",
      ssrIntegrity: "sha384-ssr-sri",
    },
    api: {
      development: "local:api",
      production: "https://cdn/api/",
      pin: { manifest: "versions/ccc.json", integrity: "sha384-api-manifest-sri" },
    },
  },
  plugins: {
    auth: {
      name: "@everything-dev/auth-plugin",
      development: "local:plugins/auth",
      production: "https://cdn/auth/",
      pin: { manifest: "versions/ddd.json", integrity: "sha384-auth-manifest-sri" },
      ui: {
        name: "auth-ui",
        development: "local:plugins/auth/ui",
        production: "https://cdn/auth-ui/",
        pin: { manifest: "versions/eee.json", integrity: "sha384-auth-ui-manifest-sri" },
      },
    },
  },
};

describe("config slot `pin`", () => {
  it("survives BosConfigSchema.parse on every slot kind", () => {
    const parsed = BosConfigSchema.parse(configWithPins);
    expect(parsed.app.ui.pin?.manifest).toBe("versions/bbb.json");
    expect(parsed.app.host.pin?.manifest).toBe("versions/aaa.json");
    expect(parsed.app.api.pin?.manifest).toBe("versions/ccc.json");
    expect(parsed.plugins?.auth?.pin?.manifest).toBe("versions/ddd.json");
    expect(parsed.plugins?.auth?.ui?.pin?.manifest).toBe("versions/eee.json");
  });

  it("keeps a slot without a pin valid (direct entry SRI)", () => {
    const parsed = BosConfigSchema.parse({
      account: "a",
      app: {
        host: { development: "local:host", production: "https://cdn/host/" },
        ui: { development: "local:ui", production: "https://cdn/ui/" },
        api: { development: "local:api", production: "https://cdn/api/" },
      },
    });
    expect(parsed.app.ui.pin).toBeUndefined();
  });

  it("survives the descriptor roundtrip (ui slots carry it like integrity)", () => {
    const descriptor = configInputToDescriptor(configWithPins);
    const authored = toConfigInput(descriptor as never) as typeof configWithPins;
    expect(authored.plugins?.auth?.ui?.pin).toEqual({
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
          pin: { manifest: "versions/parent-ui.json", integrity: "sha384-parent-pin" },
        },
      },
    };
    const childOverride = {
      account: "v1.citynode.near",
      domain: "citynode.app",
      app: {
        ui: {
          development: "local:ui",
          pin: { manifest: "versions/child-ui.json", integrity: "sha384-child-pin" },
        },
      },
    };
    const childInherit = {
      account: "v1.citynode.near",
      domain: "citynode.app",
      app: { ui: { development: "local:ui" } },
    };
    // child pin replaces the parent's ATOMICALLY — no half-mixed manifest/integrity
    expect(mergeBosConfigWithExtends(parent, childOverride).app?.ui?.pin).toEqual({
      manifest: "versions/child-ui.json",
      integrity: "sha384-child-pin",
    });
    expect(mergeBosConfigWithExtends(parent, childInherit).app?.ui?.pin).toEqual({
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
          pin: { manifest: "versions/parent-auth.json", integrity: "sha384-parent-auth" },
        },
        apps: { name: "apps", pin: { manifest: "versions/parent-apps.json", integrity: "x" } },
      },
    };
    const child = {
      account: "v1.citynode.near",
      plugins: {
        auth: { extends: "auth", production: "https://cdn.everything.dev/auth/" },
      },
    };
    const merged = mergeBosConfigWithExtends(parent, child);
    expect(merged.plugins?.auth?.pin).toBeUndefined();
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

  const slots = {
    host: { base: "https://cdn.mirror.test/host", entry: "remoteEntry.host.js" },
    ui: { base: "https://cdn.mirror.test/ui", entry: "remoteEntry.ui.js" },
    api: { base: "https://cdn.mirror.test/api", entry: "remoteEntry.api.js" },
    auth: { base: "https://cdn.mirror.test/auth", entry: "remoteEntry.auth.js" },
    authUi: { base: "https://cdn.mirror.test/auth-ui", entry: "remoteEntry.auth-ui.js" },
  };

  const bodies = new Map<string, string>(
    Object.values(slots).map((slot) => [
      `${slot.base}/versions/${slot.entry}.json`,
      JSON.stringify(makeManifest(slot.entry)),
    ]),
  );

  const authMirrorConfig = BosConfigSchema.parse({
    account: "mirror.near",
    domain: "mirror.dev",
    app: {
      host: {
        development: "local:host",
        production: `${slots.host.base}/`,
        pin: {
          manifest: `versions/${slots.host.entry}.json`,
          integrity: sri(bodies.get(`${slots.host.base}/versions/${slots.host.entry}.json`)!),
        },
      },
      ui: {
        development: "local:ui",
        production: `${slots.ui.base}/`,
        pin: {
          manifest: `versions/${slots.ui.entry}.json`,
          integrity: sri(bodies.get(`${slots.ui.base}/versions/${slots.ui.entry}.json`)!),
        },
      },
      api: {
        development: "local:api",
        production: `${slots.api.base}/`,
        pin: {
          manifest: `versions/${slots.api.entry}.json`,
          integrity: sri(bodies.get(`${slots.api.base}/versions/${slots.api.entry}.json`)!),
        },
      },
      auth: {
        name: "@everything-dev/auth-plugin",
        development: "local:plugins/auth",
        production: `${slots.auth.base}/`,
        pin: {
          manifest: `versions/${slots.auth.entry}.json`,
          integrity: sri(bodies.get(`${slots.auth.base}/versions/${slots.auth.entry}.json`)!),
        },
        ui: {
          name: "auth-ui",
          development: "local:plugins/auth/ui",
          production: `${slots.authUi.base}/`,
          pin: {
            manifest: `versions/${slots.authUi.entry}.json`,
            integrity: sri(bodies.get(`${slots.authUi.base}/versions/${slots.authUi.entry}.json`)!),
          },
        },
      },
    },
  });

  beforeEach(() => {
    clearSlotVersionCache();
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
    expect(runtime.plugins?.auth?.entryUrl).toBe(`${slots.auth.base}/${slots.auth.entry}`);
    expect(runtime.plugins?.auth?.integrity).toBe(runtime.auth?.integrity);
    expect(runtime.plugins?.auth?.integrity).toBe("sha384-entry");

    expect(runtime.plugins?.auth?.ui?.entryUrl).toBe(runtime.auth?.ui?.entryUrl);
    expect(runtime.plugins?.auth?.ui?.entryUrl).toBe(`${slots.authUi.base}/${slots.authUi.entry}`);
    expect(runtime.plugins?.auth?.ui?.ssrEntryUrl).toBe(runtime.auth?.ui?.ssrEntryUrl);
    expect(runtime.plugins?.auth?.ui?.ssrEntryUrl).toBe(
      `${slots.authUi.base}/remoteEntry.server.${slots.authUi.entry}`,
    );
    expect(runtime.plugins?.auth?.ui?.ssrIntegrity).toBe(runtime.auth?.ui?.ssrIntegrity);
  });
});
