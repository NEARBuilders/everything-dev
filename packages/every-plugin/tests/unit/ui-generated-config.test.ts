import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureGeneratedUiRsbuildConfig } from "../../src/build/ui/generated-config";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("folder-form ui rsbuild synthesis", () => {
  it("uses the config layout key as the manifest name", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "every-plugin-ui-config-"));
    tempDirs.push(root);
    const workspace = path.join(root, "plugins", "auth");
    fs.mkdirSync(path.join(workspace, "ui", "src", "routes"), { recursive: true });
    fs.writeFileSync(path.join(root, "bos.config.json"), "{}");
    fs.writeFileSync(
      path.join(workspace, "package.json"),
      JSON.stringify({ name: "@everything-dev/auth-plugin" }),
    );

    const configPath = ensureGeneratedUiRsbuildConfig(workspace);
    const source = fs.readFileSync(configPath!, "utf8");

    expect(source).toContain('manifestName: "auth"');
  });
});
