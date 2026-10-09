import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getResolvedConfigPath,
  loadGeneratedResolvedConfig,
  readBosConfigForBuild,
  resolveBosConfigPath,
  writeResolvedConfig,
} from "../../src/config";
import type { ResolvedConfigMeta } from "../../src/merge";

const VALID_CONFIG: Record<string, unknown> = {
  account: "test.near",
  domain: "test.dev",
  app: {
    host: { development: "http://localhost:3000", production: "https://host.test.dev" },
    ui: { name: "ui", development: "http://localhost:3003", production: "https://ui.test.dev" },
    api: { name: "api", development: "http://localhost:3001", production: "https://api.test.dev" },
  },
};

describe("resolved config lifecycle", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "bos-lifecycle-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("writes resolved config with _resolved metadata using shared interface", () => {
    writeResolvedConfig(
      testDir,
      VALID_CONFIG as any,
      "development",
      ["bos://parent.near/config"],
      "dev-handler",
    );

    const resolvedPath = getResolvedConfigPath(testDir);
    expect(existsSync(resolvedPath)).toBe(true);

    const raw = JSON.parse(readFileSync(resolvedPath, "utf-8")) as Record<string, unknown>;
    const meta = raw._resolved as ResolvedConfigMeta;
    expect(meta.env).toBe("development");
    expect(meta.resolvedAt).toBeDefined();
    expect(meta.extendsChain).toEqual(["bos://parent.near/config"]);
    expect(meta.source).toBe("dev-handler");
    expect(raw.account).toBe("test.near");
  });

  it("loadGeneratedResolvedConfig reads back config without _resolved", () => {
    writeResolvedConfig(testDir, VALID_CONFIG as any, "development");

    const loaded = loadGeneratedResolvedConfig(testDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.account).toBe("test.near");
  });

  it("readBosConfigForBuild strips _resolved metadata", async () => {
    writeResolvedConfig(testDir, VALID_CONFIG as any, "production", ["bos://parent/test"]);

    const result = await readBosConfigForBuild(testDir);
    expect(result._resolved).toBeUndefined();
    expect(result.account).toBe("test.near");
  });

  it("resolveBosConfigPath prefers resolved config over bos.config.json", () => {
    writeResolvedConfig(testDir, VALID_CONFIG as any, "development");

    const result = resolveBosConfigPath(testDir);
    expect(result).toBe(getResolvedConfigPath(testDir));
  });

  it("resolveBosConfigPath falls back when resolved config absent", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "bos-lifecycle-fallback-"));
    try {
      expect(resolveBosConfigPath(emptyDir)).toBe(join(emptyDir, "bos.config.json"));
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("overwriting resolved config replaces previous content", () => {
    writeResolvedConfig(testDir, { ...VALID_CONFIG, account: "first.near" } as any, "development");
    writeResolvedConfig(testDir, { ...VALID_CONFIG, account: "second.near" } as any, "production");

    const loaded = loadGeneratedResolvedConfig(testDir);
    expect(loaded!.account).toBe("second.near");
  });

  it("canonical key ordering is preserved in resolved output", () => {
    const unordered = {
      shared: { ui: {} },
      plugins: {},
      domain: "test.dev",
      app: {},
      account: "test.near",
    };
    writeResolvedConfig(testDir, unordered as any, "development");

    const raw = JSON.parse(readFileSync(getResolvedConfigPath(testDir), "utf-8")) as Record<
      string,
      unknown
    >;
    const keys = Object.keys(raw).filter((k) => k !== "_resolved");
    expect(keys[0]).toBe("account");
    expect(keys[1]).toBe("domain");
    expect(keys[keys.length - 1]).toBe("shared");
  });

  it("readBosConfigForBuild falls back to bos.config.json", async () => {
    const fallbackDir = mkdtempSync(join(tmpdir(), "bos-lifecycle-buildfb-"));
    try {
      writeFileSync(join(fallbackDir, "bos.config.json"), `${JSON.stringify(VALID_CONFIG)}\n`);

      const result = await readBosConfigForBuild(fallbackDir);
      expect(result.account).toBe("test.near");
    } finally {
      rmSync(fallbackDir, { recursive: true, force: true });
    }
  });
});
