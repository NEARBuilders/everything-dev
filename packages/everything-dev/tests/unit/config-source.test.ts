import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CONFIG_FILENAMES,
  findBosConfigPath,
  readBosConfigSource,
  readBosConfigWithResolvedFallback,
  stringifyBosConfig,
} from "../../src/config-source";

describe("CONFIG_FILENAMES", () => {
  it("has toml first, json second", () => {
    expect(CONFIG_FILENAMES).toEqual(["bos.config.toml", "bos.config.json"]);
  });
});

describe("readBosConfigSource", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bos-config-source-"));
    writeFileSync(
      join(tmpDir, "bos.config.toml"),
      `account = "dev.everything.near"\ndomain = "everything.dev"\n`,
    );
    writeFileSync(
      join(tmpDir, "bos.config.json"),
      JSON.stringify({ account: "dev.everything.near", domain: "everything.dev" }),
    );
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses TOML config", () => {
    const config = readBosConfigSource(join(tmpDir, "bos.config.toml"));
    expect(config.account).toBe("dev.everything.near");
    expect(config.domain).toBe("everything.dev");
  });

  it("parses JSON config", () => {
    const config = readBosConfigSource(join(tmpDir, "bos.config.json"));
    expect(config.account).toBe("dev.everything.near");
    expect(config.domain).toBe("everything.dev");
  });

  it("parses TOML with nested tables", () => {
    writeFileSync(
      join(tmpDir, "nested.toml"),
      `[app.ui]\ndevelopment = "local:ui"\nproduction = "https://ui.example.com"\nintegrity = "sha384-abc123"\n`,
    );
    const config = readBosConfigSource(join(tmpDir, "nested.toml"));
    expect(config.app?.ui).toBeDefined();
    const ui = config.app?.ui as Record<string, unknown>;
    expect(ui.development).toBe("local:ui");
    expect(ui.production).toBe("https://ui.example.com");
    expect(ui.integrity).toBe("sha384-abc123");
  });

  it("throws on missing file", () => {
    expect(() => readBosConfigSource(join(tmpDir, "nonexistent.toml"))).toThrow();
  });

  it("throws on invalid TOML", () => {
    writeFileSync(join(tmpDir, "invalid.toml"), "<<< NOT TOML >>>");
    expect(() => readBosConfigSource(join(tmpDir, "invalid.toml"))).toThrow();
  });

  it("throws on invalid JSON", () => {
    writeFileSync(join(tmpDir, "invalid.json"), "{invalid}");
    expect(() => readBosConfigSource(join(tmpDir, "invalid.json"))).toThrow();
  });
});

describe("findBosConfigPath", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bos-find-config-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    // Clean up any config files created during test
    for (const name of ["bos.config.toml", "bos.config.json"]) {
      const p = join(tmpDir, name);
      if (existsSync(p)) rmSync(p);
    }
  });

  it("errors when both config files exist", () => {
    writeFileSync(join(tmpDir, "bos.config.json"), "{}");
    writeFileSync(join(tmpDir, "bos.config.toml"), 'key = "value"');
    expect(() => findBosConfigPath(tmpDir)).toThrow();
  });

  it("finds JSON when TOML absent", () => {
    writeFileSync(join(tmpDir, "bos.config.json"), "{}");
    const found = findBosConfigPath(tmpDir);
    expect(found).toBe(join(tmpDir, "bos.config.json"));
  });

  it("walks up directory tree", () => {
    const subDir = join(tmpDir, "sub", "deep");
    writeFileSync(join(tmpDir, "bos.config.json"), "{}");
    const found = findBosConfigPath(subDir);
    expect(found).toBe(join(tmpDir, "bos.config.json"));
  });

  it("returns null when no config found", () => {
    const emptyDir = join(tmpDir, "empty");
    const found = findBosConfigPath(emptyDir);
    expect(found).toBeNull();
  });
});

describe("readBosConfigWithResolvedFallback", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bos-resolved-fallback-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads from source when no resolved config exists", () => {
    writeFileSync(join(tmpDir, "bos.config.toml"), `account = "test.near"\ndomain = "test.dev"\n`);
    const config = readBosConfigWithResolvedFallback(tmpDir);
    expect(config.account).toBe("test.near");
    expect(config.domain).toBe("test.dev");
    rmSync(join(tmpDir, "bos.config.toml"));
  });

  it("prefers resolved config over source", () => {
    writeFileSync(join(tmpDir, "bos.config.toml"), `account = "source.near"\n`);
    mkdirSync(join(tmpDir, ".bos"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".bos/bos.resolved-config.json"),
      JSON.stringify({
        _resolved: { env: "development", resolvedAt: "2024-01-01" },
        account: "resolved.near",
      }),
    );
    const config = readBosConfigWithResolvedFallback(tmpDir);
    expect(config.account).toBe("resolved.near");
    // Clean up
    rmSync(join(tmpDir, "bos.config.toml"));
    rmSync(join(tmpDir, ".bos/bos.resolved-config.json"), { force: true });
  });

  it("falls back to source when resolved config is empty", () => {
    writeFileSync(join(tmpDir, "bos.config.toml"), `account = "source.near"\n`);
    mkdirSync(join(tmpDir, ".bos"), { recursive: true });
    writeFileSync(join(tmpDir, ".bos/bos.resolved-config.json"), JSON.stringify({ _resolved: {} }));
    const config = readBosConfigWithResolvedFallback(tmpDir);
    expect(config.account).toBe("source.near");
    rmSync(join(tmpDir, "bos.config.toml"));
    rmSync(join(tmpDir, ".bos/bos.resolved-config.json"), { force: true });
  });
});

describe("stringifyBosConfig", () => {
  it("produces valid TOML", () => {
    const toml = stringifyBosConfig({
      account: "test.near",
      domain: "test.dev",
      app: {
        ui: {
          development: "local:ui",
          production: "https://ui.example.com",
        },
      },
    });
    expect(toml).toContain('account = "test.near"');
    expect(toml).toContain('domain = "test.dev"');
    expect(toml).toContain("[app.ui]");
    expect(toml).toContain('development = "local:ui"');
    expect(toml).toContain('production = "https://ui.example.com"');
  });

  it("strips null and undefined values", () => {
    const toml = stringifyBosConfig({
      account: "test.near",
      integrity: null,
      extra: undefined,
      nested: {
        value: "kept",
        removed: null,
      },
    });
    expect(toml).toContain('account = "test.near"');
    expect(toml).toContain('value = "kept"');
    expect(toml).not.toContain("integrity");
    expect(toml).not.toContain("removed");
  });

  it("handles arrays", () => {
    const toml = stringifyBosConfig({
      secrets: ["API_KEY", "DB_URL"],
    });
    expect(toml).toContain("API_KEY");
    expect(toml).toContain("DB_URL");
  });

  it("handles empty objects", () => {
    const toml = stringifyBosConfig({});
    expect(toml).toBe("");
  });
});
