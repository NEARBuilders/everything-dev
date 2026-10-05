import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureGeneratedCoreUiRsbuildConfig,
  ensureGeneratedUiRsbuildConfig,
  hasCoreUiWorkspace,
} from "../../src/build/ui/generated-config";

const scratchRoot = join(tmpdir(), "every-plugin-core-ui-synthesis");

afterEach(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});

function makeWorkspace(
  shape: "core-ui" | "core-ui-no-entry" | "plugin" | "folder-form" | "folder-form-no-config",
): string {
  if (shape === "folder-form" || shape === "folder-form-no-config") {
    // a folder-form ui source lives at plugins/<key>/ui inside a config root;
    // the composition key derives from the plugins/<key> directory
    const configRoot = join(scratchRoot, shape);
    const pluginDir = join(configRoot, "plugins", "myplugin");
    fs.mkdirSync(join(pluginDir, "ui", "src", "routes"), { recursive: true });
    fs.mkdirSync(join(pluginDir, "src"), { recursive: true });
    fs.writeFileSync(join(pluginDir, "src", "contract.ts"), "export {};\n");
    fs.writeFileSync(join(pluginDir, "plugin.dev.ts"), "export {};\n");
    fs.writeFileSync(
      join(pluginDir, "package.json"),
      JSON.stringify({ name: "@everything-dev/myplugin-plugin", version: "0.0.0" }),
    );
    if (shape === "folder-form") {
      // an authored config above the workspace — the composition key derives
      // from the plugins/<key> directory relative to it
      fs.writeFileSync(join(configRoot, "bos.app.ts"), "export default {};\n");
    }
    return pluginDir;
  }

  const cwd = join(scratchRoot, shape);
  fs.mkdirSync(join(cwd, "src", "routes"), { recursive: true });
  fs.writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "ui", version: "0.0.0" }));
  if (shape === "plugin") {
    fs.writeFileSync(join(cwd, "src", "contract.ts"), "export {};\n");
    fs.writeFileSync(join(cwd, "plugin.dev.ts"), "export {};\n");
  }
  if (shape === "core-ui") {
    fs.writeFileSync(join(cwd, "src", "entry.ts"), "export {};\n");
  }
  // core-ui-no-entry: detection must not depend on the (generated) entry stub
  return cwd;
}

describe("core ui rsbuild synthesis", () => {
  it("detects the workspace-form core ui (routes, not plugin-shaped) — entry stub not required", () => {
    expect(hasCoreUiWorkspace(makeWorkspace("core-ui"))).toBe(true);
    expect(hasCoreUiWorkspace(makeWorkspace("core-ui-no-entry"))).toBe(true);
    expect(hasCoreUiWorkspace(makeWorkspace("plugin"))).toBe(false);
    expect(hasCoreUiWorkspace(makeWorkspace("folder-form"))).toBe(false);
  });

  it("synthesizes the generated config from the shared factory", () => {
    const cwd = makeWorkspace("core-ui");
    const configPath = ensureGeneratedCoreUiRsbuildConfig(cwd);
    expect(configPath).toBe(join(".every-plugin", "ui.rsbuild.config.generated.mjs"));
    const content = fs.readFileSync(join(cwd, configPath!), "utf-8");
    expect(content).toContain("createCoreUiRsbuildConfig(await readAuthoredConfigInput())");
    expect(content).toContain('from "every-plugin/build/ui"');
    expect(content).toContain('from "everything-dev/config"');
  });

  it("honors a local rsbuild.config.ts as an override, untouched", () => {
    const cwd = makeWorkspace("core-ui");
    fs.writeFileSync(join(cwd, "rsbuild.config.ts"), "export default {};\n");
    expect(ensureGeneratedCoreUiRsbuildConfig(cwd)).toBeNull();
    expect(fs.existsSync(join(cwd, ".every-plugin", "ui.rsbuild.config.generated.mjs"))).toBe(
      false,
    );
  });

  it("derives the folder-form ui's composition key from the plugins/<key> layout", () => {
    const cwd = makeWorkspace("folder-form");
    const configPath = ensureGeneratedUiRsbuildConfig(cwd);
    expect(configPath).toContain(join(".every-plugin", "ui.rsbuild.config.generated.mjs"));
    const content = fs.readFileSync(configPath!, "utf-8");
    expect(content).toContain('manifestName: "myplugin"');
    expect(content).not.toContain("myplugin-plugin");
  });

  it("fails loudly when the composition key cannot be derived — never the container name", () => {
    const cwd = makeWorkspace("folder-form-no-config");
    expect(() => ensureGeneratedUiRsbuildConfig(cwd)).toThrow(/composition key/);
  });
});
