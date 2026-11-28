import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hasCoreUiWorkspace } from "../../src/build/ui/generated-config";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeWorkspace(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "every-plugin-legacy-name-"));
  tempDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

describe("legacy plugin.dev.ts name is retired (#920)", () => {
  it("fails loud when only the legacy plugin.dev.ts exists", () => {
    const root = makeWorkspace({
      "package.json": JSON.stringify({ name: "ui", version: "0.0.0" }),
      "src/routes/route.tsx": "export {};\n",
      "plugin.dev.ts": "export {};\n",
    });
    expect(() => hasCoreUiWorkspace(root)).toThrow(/plugin\.dev\.ts is retired/);
  });

  it("detects normally when bos.dev.ts is present alongside the legacy name", () => {
    const root = makeWorkspace({
      "package.json": JSON.stringify({ name: "ui", version: "0.0.0" }),
      "src/routes/route.tsx": "export {};\n",
      "plugin.dev.ts": "export {};\n",
      "bos.dev.ts": "export {};\n",
    });
    expect(hasCoreUiWorkspace(root)).toBe(false);
  });
});
