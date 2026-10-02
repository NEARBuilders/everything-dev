import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { containerName, identity, remoteName } from "every-plugin/identity";
import { afterEach, describe, expect, it } from "vitest";
import { pluginLayoutKey } from "../../src/build/ui/generated-config";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("remoteName (absorbed from runtime/services/normalize.ts)", () => {
  it("matches the runtime/build MF remote normalization", () => {
    expect(remoteName("@scope/my-plugin")).toBe("scope_my-plugin");
    expect(remoteName("@SCOPE/My-Plugin")).toBe("scope_my-plugin");
    expect(remoteName("@scope/foo/bar")).toBe("scope_foo_bar");
    expect(remoteName("simple-plugin")).toBe("simple-plugin");
    expect(remoteName("foo/bar")).toBe("foo_bar");
    expect(remoteName("UPPERCASE")).toBe("uppercase");
    expect(remoteName("@")).toBe("");
    expect(remoteName("@/")).toBe("_");
    expect(remoteName("")).toBe("");
  });
});

describe("containerName (absorbed from ui/manifest/contract.ts)", () => {
  it("matches the UI container naming rule", () => {
    expect(containerName("@everything-dev/auth-plugin")).toBe("_everything_dev_auth_plugin");
    expect(containerName("@everything-dev/apps-plugin")).toBe("_everything_dev_apps_plugin");
    expect(containerName("ui")).toBe("ui");
  });
});

describe("identity", () => {
  it("derives every name from the config layout key", () => {
    expect(identity("apps")).toEqual({
      key: "apps",
      npm: "@everything-dev/apps-plugin",
      remote: "everything-dev_apps-plugin",
      container: "_everything_dev_apps_plugin",
    });
    expect(identity("auth")).toEqual({
      key: "auth",
      npm: "@everything-dev/auth-plugin",
      remote: "everything-dev_auth-plugin",
      container: "_everything_dev_auth_plugin",
    });
  });

  it("derives the registry plugin names after the apps→registry rename", () => {
    expect(identity("registry")).toEqual({
      key: "registry",
      npm: "@everything-dev/registry-plugin",
      remote: "everything-dev_registry-plugin",
      container: "_everything_dev_registry_plugin",
    });
  });
});

describe("pluginLayoutKey", () => {
  it("derives the config layout key from a plugins/<key> workspace", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "every-plugin-layout-key-"));
    tempDirs.push(root);
    const workspace = path.join(root, "plugins", "registry");
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(root, "bos.config.json"), "{}");

    expect(pluginLayoutKey(workspace)).toBe("registry");
  });

  it("is null outside the plugins/ group and without a reachable bos.config.json", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "every-plugin-layout-key-"));
    tempDirs.push(root);
    const workspace = path.join(root, "api");
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(root, "bos.config.json"), "{}");
    expect(pluginLayoutKey(workspace)).toBeNull();

    const orphan = fs.mkdtempSync(path.join(os.tmpdir(), "every-plugin-layout-key-orphan-"));
    tempDirs.push(orphan);
    expect(pluginLayoutKey(orphan)).toBeNull();
  });
});
