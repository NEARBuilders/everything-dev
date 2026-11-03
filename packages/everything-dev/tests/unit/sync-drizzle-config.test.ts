import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { shouldSyncPluginDrizzleConfig } from "../../src/services/scaffold/sync";

describe("shouldSyncPluginDrizzleConfig", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function pluginDirWith(files: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), "sync-drizzle-gate-"));
    tempDirs.push(dir);
    for (const file of files) {
      const full = join(dir, "plugins", "demo", file);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, "");
    }
    return dir;
  }

  it("maps plugins with a database seam", () => {
    const dir = pluginDirWith(["src/db/schema.ts"]);
    expect(shouldSyncPluginDrizzleConfig(dir, "demo")).toBe(true);
  });

  it("maps config-only plugins the src/db gate stranded", () => {
    const dir = pluginDirWith(["drizzle.config.ts"]);
    expect(shouldSyncPluginDrizzleConfig(dir, "demo")).toBe(true);
  });

  it("skips plugins without a database", () => {
    const dir = pluginDirWith(["src/index.ts"]);
    expect(shouldSyncPluginDrizzleConfig(dir, "demo")).toBe(false);
  });
});

describe("drizzle-config parity (the framework-owned sync source)", () => {
  const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");
  const source = readFileSync(join(repoRoot, "api", "drizzle.config.ts"), "utf-8");

  it("every plugin copy and the scaffold template match api's bytes", () => {
    const pluginsDir = join(repoRoot, "plugins");
    const withConfigs = readdirSync(pluginsDir).filter((entry) =>
      existsSync(join(pluginsDir, entry, "drizzle.config.ts")),
    );
    expect(withConfigs.length).toBeGreaterThan(2);
    for (const entry of withConfigs) {
      expect(readFileSync(join(pluginsDir, entry, "drizzle.config.ts"), "utf-8")).toBe(source);
    }
    expect(readFileSync(join(pluginsDir, "_template", "drizzle.config.ts"), "utf-8")).toBe(source);
  });
});
