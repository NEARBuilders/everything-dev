import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDevPluginId } from "../../src/dev/serve";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makePluginWorkspace(name: string, devConfigPluginId?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "every-plugin-dev-id-"));
  tempDirs.push(root);
  const workspace = path.join(root, "plugins", name.split("/").pop()!.replace("-plugin", ""));
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(root, "bos.config.json"), "{}");
  fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ name }));
  if (devConfigPluginId !== undefined) {
    fs.writeFileSync(
      path.join(workspace, "plugin.dev.ts"),
      `export default { pluginId: ${JSON.stringify(devConfigPluginId)} };\n`,
    );
  }
  return workspace;
}

describe("resolveDevPluginId", () => {
  it("derives the dev server plugin id from the npm package name, not plugin.dev.ts", () => {
    const workspace = makePluginWorkspace(
      "@everything-dev/registry-plugin",
      "stale-from-plugin-dev-ts",
    );
    expect(resolveDevPluginId(workspace)).toBe("@everything-dev/registry-plugin");
  });

  it("keeps the scoped slug the host derives from the same name", () => {
    const workspace = makePluginWorkspace("@every-plugin/template");
    const id = resolveDevPluginId(workspace);
    expect(id).toBe("@every-plugin/template");
    expect(id.split("/").pop()!.replace("-plugin", "")).toBe("template");
  });

  it("falls back to the package name for workspaces without a bos config layout", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "every-plugin-dev-id-orphan-"));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "test-plugin" }));
    expect(resolveDevPluginId(root)).toBe("test-plugin");
  });
});
