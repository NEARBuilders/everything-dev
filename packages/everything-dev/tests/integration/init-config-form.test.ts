import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  convertChildConfigToAppForm,
  copyFilteredFiles,
  writeDevOverlayTemplate,
} from "../../src/cli/init";
import { loadAppDescriptorConfig, resetConfigPathCache } from "../../src/config";
import { serializeAppDescriptorSource } from "../../src/descriptor/serialize";

const REPO_ROOT = join(import.meta.dirname, "../../../../");

const SAMPLE_INPUT = {
  extends: "bos://base.near/base",
  account: "child.near",
  domain: "child.dev",
  title: "Child",
  app: {
    ui: { development: "local:ui" },
    api: { development: "local:api" },
  },
  plugins: { template: { development: "local:plugins/_template" } },
  starter: "simple",
} as const;

describe("commented bos.app.ts scaffold", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    resetConfigPathCache();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("emits explanatory comments over the descriptor keys", () => {
    const source = serializeAppDescriptorSource(SAMPLE_INPUT);
    expect(source).toContain('import { App } from "everything-dev/descriptor";');
    expect(source).toContain("// The base runtime this app extends");
    expect(source).toContain("// The NEAR account this app publishes under.");
    expect(source).toContain("// The gateway: FastKV lookup key");
    expect(source).toContain("// Local UI workspace override.");
    expect(source).toContain("// Attached plugins, keyed by registry key.");
    expect(source).toContain("// Authoring-only: the starter level");
    expect(source).toContain(`"extends": "bos://base.near/base"`);
    expect(source).toContain(`"starter": "simple"`);
  });

  it("round-trips through loadAppDescriptorConfig", async () => {
    const dir = join(import.meta.dirname, "../fixtures", "convert-scratch-roundtrip");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "bos.config.json"),
      JSON.stringify({
        extends: "bos://base.near/base",
        account: "child.near",
        domain: "child.near",
        title: "Child",
        app: { ui: { development: "local:ui" } },
        plugins: { apps: { development: "local:plugins/apps" } },
      }),
    );

    await convertChildConfigToAppForm(dir);

    const input = await loadAppDescriptorConfig(join(dir, "bos.app.ts"));
    expect(input.account).toBe("child.near");
    expect(input.domain).toBe("child.near");
    expect(input.title).toBe("Child");
    expect(input.extends).toBe("bos://base.near/base");
    expect(input.plugins?.apps).toMatchObject({ development: "local:plugins/apps" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("scaffolds a bos.dev.ts overlay next to bos.app.ts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-dev-overlay-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "bos.config.json"),
      JSON.stringify({ extends: "bos://base.near/base", account: "child.near" }),
    );

    await convertChildConfigToAppForm(dir);
    writeDevOverlayTemplate(dir, { extendsRef: "bos://base.near/base" });

    const overlayPath = join(dir, "bos.dev.ts");
    expect(existsSync(overlayPath)).toBe(true);
    const source = readFileSync(overlayPath, "utf-8");
    expect(source).toContain("Partial<AppDescriptor>");
    expect(source).toContain("Never published");
    expect(source).toContain("bos://base.near/base");
  });

  it("dev overlay writer is idempotent", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-dev-overlay-idem-"));
    tempDirs.push(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bos.dev.ts"), "export default {};\n");

    writeDevOverlayTemplate(dir, { extendsRef: "bos://base.near/base" });

    expect(readFileSync(join(dir, "bos.dev.ts"), "utf-8")).toBe("export default {};\n");
  });

  it("still delivers plugin.dev.ts files children need for bos dev", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-plugin-dev-copy-"));
    tempDirs.push(dir);

    await copyFilteredFiles(REPO_ROOT, dir, ["api/**", "plugins/_template/**"], {
      overrides: ["api", "plugins"],
      plugins: ["template"],
    });

    expect(existsSync(join(dir, "api", "plugin.dev.ts"))).toBe(true);
    expect(existsSync(join(dir, "plugins", "_template", "plugin.dev.ts"))).toBe(true);
    expect(existsSync(join(dir, "api", "src", "contract.ts"))).toBe(true);
  });
});
