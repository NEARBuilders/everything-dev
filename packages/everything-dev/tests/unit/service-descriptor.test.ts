import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildServiceDescriptorMap } from "../../src/service-descriptor";
import type { RuntimeConfig } from "../../src/types";

/**
 * Folder-form ui sources (`ui/` dir with routes but no own package.json) are
 * built by the plugin's own dev process via `every-plugin dev` (BOS_UI_PORT).
 * The descriptor map must reflect that: no separate `plugin-ui:*` service,
 * and BOS_UI_PORT riding on the descriptor that owns the process — including
 * the auth app slot, whose `plugin:auth` descriptor is never spawned.
 */

const tmpRoots: string[] = [];

/** localPath IS the ui dir — the detection checks `<localPath>/src/routes` and `<localPath>/package.json`. */
async function makeFolderFormUi(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "folder-form-ui-"));
  tmpRoots.push(root);
  await mkdir(path.join(root, "src", "routes"), { recursive: true });
  await writeFile(path.join(root, "src", "routes", "index.tsx"), "export default 1");
  return root;
}

async function makeWorkspaceFormUi(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "workspace-form-ui-"));
  tmpRoots.push(root);
  await mkdir(path.join(root, "src", "routes"), { recursive: true });
  await writeFile(path.join(root, "src", "routes", "index.tsx"), "export default 1");
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "some-ui", scripts: { dev: "rsbuild dev" } }),
  );
  return root;
}

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(tmpRoots.map((root) => rm(root, { recursive: true, force: true })));
});

function runtimeConfigWith(options: {
  authUiLocalPath: string;
  plugins?: Record<
    string,
    { localPath: string; ui?: { source: "local"; localPath: string; port?: number } }
  >;
}): RuntimeConfig {
  return {
    env: "development",
    account: "test.near",
    domain: "test.app",
    networkId: "mainnet",
    host: { name: "host", url: "http://localhost:3000", entry: "", source: "local" },
    ui: { name: "ui", url: "http://localhost:3003", entry: "", source: "local" },
    api: { name: "api", url: "http://localhost:3001", entry: "", source: "local" },
    auth: {
      name: "auth",
      url: "http://localhost:3002",
      entry: "",
      source: "local",
      localPath: "plugins/auth",
      ui: {
        name: "auth-ui",
        url: "http://localhost:3011",
        entry: "",
        source: "local",
        localPath: options.authUiLocalPath,
        port: 3011,
      },
    },
    plugins: {
      auth: {
        name: "auth",
        url: "http://localhost:3018",
        entry: "",
        source: "local",
        localPath: "plugins/auth",
        ui: {
          name: "auth-ui",
          url: "http://localhost:3011",
          entry: "",
          source: "local",
          localPath: options.authUiLocalPath,
          port: 3011,
        },
      },
      ...options.plugins,
    },
  } as unknown as RuntimeConfig;
}

describe("buildServiceDescriptorMap folder-form ui", () => {
  it("rides BOS_UI_PORT on the auth slot for a folder-form auth mirror and spawns no separate ui service", async () => {
    const uiPath = await makeFolderFormUi();
    const map = buildServiceDescriptorMap(runtimeConfigWith({ authUiLocalPath: uiPath }));

    expect(map.has("plugin:auth")).toBe(false);
    expect(map.has("plugin-ui:auth")).toBe(false);

    const authDescriptor = map.get("auth");
    expect(authDescriptor?.env).toEqual({ BOS_UI_PORT: "3011" });
  });

  it("keeps the legacy plugin-ui service for workspace-form ui sources", async () => {
    const uiPath = await makeWorkspaceFormUi();
    const map = buildServiceDescriptorMap(runtimeConfigWith({ authUiLocalPath: uiPath }));

    expect(map.has("plugin:auth")).toBe(false);
    expect(map.has("plugin-ui:auth")).toBe(true);
    expect(map.get("auth")?.env).toBeUndefined();
  });

  it("rides BOS_UI_PORT on the plugin descriptor for a non-mirror folder-form plugin", async () => {
    const uiPath = await makeFolderFormUi();
    const map = buildServiceDescriptorMap(
      runtimeConfigWith({
        authUiLocalPath: uiPath,
        plugins: {
          votes: {
            localPath: "plugins/votes",
            ui: { source: "local", localPath: uiPath, port: 3012 },
          },
        },
      }),
    );

    expect(map.has("plugin-ui:votes")).toBe(false);
    const pluginDescriptor = map.get("plugin:votes");
    expect(pluginDescriptor?.env).toEqual({ BOS_UI_PORT: "3012" });
  });
});
