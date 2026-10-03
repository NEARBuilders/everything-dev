import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureGeneratedCoreUiRsbuildConfig,
  hasCoreUiWorkspace,
} from "../../src/build/ui/generated-config";

const scratchRoot = join(tmpdir(), "every-plugin-core-ui-synthesis");

afterEach(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});

function makeWorkspace(shape: "core-ui" | "plugin" | "folder-form"): string {
  const cwd = join(scratchRoot, shape);
  fs.mkdirSync(join(cwd, "src", "routes"), { recursive: true });
  fs.writeFileSync(join(cwd, "src", "entry.ts"), "export {};\n");
  fs.writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "ui", version: "0.0.0" }));
  if (shape === "plugin") {
    fs.writeFileSync(join(cwd, "src", "contract.ts"), "export {};\n");
    fs.writeFileSync(join(cwd, "plugin.dev.ts"), "export {};\n");
  }
  if (shape === "folder-form") {
    // the workspace is plugin-shaped; the ui source is a ui/ directory
    fs.writeFileSync(join(cwd, "src", "contract.ts"), "export {};\n");
    fs.writeFileSync(join(cwd, "plugin.dev.ts"), "export {};\n");
    fs.mkdirSync(join(cwd, "ui", "src", "routes"), { recursive: true });
  }
  return cwd;
}

describe("core ui rsbuild synthesis", () => {
  it("detects the workspace-form core ui (routes + entry, not plugin-shaped)", () => {
    expect(hasCoreUiWorkspace(makeWorkspace("core-ui"))).toBe(true);
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
});
