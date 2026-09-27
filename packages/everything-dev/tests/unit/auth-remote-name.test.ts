import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function replyWith(json: unknown): Response {
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeBosConfig(authSection: Record<string, unknown>) {
  return {
    account: "test.near",
    app: {
      host: { development: "local:host", production: "https://host.example" },
      ui: { production: "https://ui.example" },
      api: { development: "local:api", production: "https://api.example" },
      auth: authSection,
    },
  } as any;
}

async function buildWithBosConfig(
  bosConfig: any,
  env: "development" | "production",
  sources: Record<string, "local" | "remote">,
) {
  const { buildRuntimeConfig } = await import("../../../src/config");
  return buildRuntimeConfig(bosConfig, "/tmp", env, {
    hostSource: sources.host,
    uiSource: sources.ui,
    apiSource: sources.api,
    authSource: sources.auth,
  });
}

describe("buildRuntimeConfig resolves app.auth remote name from plugin.manifest.json", () => {
  it("uses auth plugin's plugin.manifest.json name when no explicit name is provided in remote mode", async () => {
    const authUrl = "https://auth1.example";
    globalThis.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith(`${authUrl}/plugin.manifest.json`)) {
        return replyWith({
          schemaVersion: 1,
          kind: "every-plugin/manifest",
          plugin: { name: "@everything-dev/auth-plugin", version: "1.2.3" },
          runtime: { remoteEntry: "./remoteEntry.js" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const result = await buildWithBosConfig(
      makeBosConfig({ development: "local:plugins/auth", production: authUrl }),
      "production",
      { host: "remote", ui: "remote", api: "remote", auth: "remote" },
    );

    expect(result.auth).toBeDefined();
    expect(result.auth!.name).toBe("@everything-dev/auth-plugin");
    expect(result.auth!.url).toBe(authUrl);
    expect(result.auth!.source).toBe("remote");
  });

  it("keeps an explicit auth.name string and does not override it with the plugin.manifest.json name", async () => {
    const authUrl = "https://auth2.example";
    globalThis.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith(`${authUrl}/plugin.manifest.json`)) {
        return replyWith({
          schemaVersion: 1,
          kind: "every-plugin/manifest",
          plugin: { name: "@everything-dev/auth-plugin", version: "1.2.3" },
          runtime: { remoteEntry: "./remoteEntry.js" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const result = await buildWithBosConfig(
      makeBosConfig({
        name: "custom-auth-name",
        development: "local:plugins/auth",
        production: authUrl,
      }),
      "production",
      { host: "remote", ui: "remote", api: "remote", auth: "remote" },
    );

    expect(result.auth).toBeDefined();
    expect(result.auth!.name).toBe("custom-auth-name");
  });

  it("falls back to the slot key when the plugin.manifest.json fetch fails", async () => {
    const authUrl = "https://auth3.example";
    globalThis.fetch = vi.fn(
      async () => new Response("not found", { status: 404 }),
    ) as unknown as typeof globalThis.fetch;

    const result = await buildWithBosConfig(
      makeBosConfig({ development: "local:plugins/auth", production: authUrl }),
      "production",
      { host: "remote", ui: "remote", api: "remote", auth: "remote" },
    );

    expect(result.auth).toBeDefined();
    expect(result.auth!.name).toBe("auth");
  });

  it("reads the local plugin package name in development mode (unchanged behavior)", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "auth-name-local-"));
    const authDir = join(projectDir, "plugins", "auth");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(
      join(authDir, "package.json"),
      `${JSON.stringify({
        name: "@everything-dev/auth-plugin",
        version: "1.2.3",
      })}\n`,
    );

    try {
      const { buildRuntimeConfig } = await import("../../../src/config");
      const result = await buildRuntimeConfig(
        makeBosConfig({ development: "local:plugins/auth" }),
        projectDir,
        "development",
        {
          hostSource: "local",
          uiSource: "local",
          apiSource: "local",
          authSource: "local",
          proxy: undefined as any,
        },
      );

      expect(result.auth).toBeDefined();
      expect(result.auth!.name).toBe("@everything-dev/auth-plugin");
      expect(result.auth!.source).toBe("local");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
