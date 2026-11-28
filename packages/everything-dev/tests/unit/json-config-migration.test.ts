import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  convertLegacyJsonConfig,
  readAuthoredOrLegacyJsonConfig,
} from "../../src/services/scaffold/json-config-migration";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "json-config-migration-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(dir: string, config: Record<string, unknown>): void {
  writeFileSync(join(dir, "bos.config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

const fullChild = {
  extends: "bos://dev.everything.near/everything.dev",
  account: "child.near",
  domain: "child.dev",
  title: "Child",
  release: "2.0.0-rc.18",
  plugins: {
    local: { development: "local:plugins/local", variables: { namespace: "child.near" } },
    remote: { production: "https://remote.child.dev", secrets: ["REMOTE_KEY"] },
    mixed: { development: "local:plugins/mixed", production: "https://mixed.child.dev" },
  },
  app: {
    host: { development: "local:host" },
    ui: { development: "local:ui" },
    api: { development: "local:api", secrets: ["API_DATABASE_URL"] },
    auth: { variables: { account: "child.near" } },
  },
};

describe("convertLegacyJsonConfig (#920)", () => {
  it("converts a full v2 JSON child, deletes the JSON, and keeps a backup", async () => {
    const dir = makeProject();
    writeJson(dir, fullChild);

    const result = await convertLegacyJsonConfig(dir);

    expect(result.status).toBe("converted");
    expect(existsSync(join(dir, "bos.config.json"))).toBe(false);
    expect(existsSync(join(dir, "bos.app.ts"))).toBe(true);
    expect(existsSync(join(dir, ".bos", "sync-backup", "bos.config.json"))).toBe(true);

    const source = readFileSync(join(dir, "bos.app.ts"), "utf-8");
    expect(source).toContain('"extends": "bos://dev.everything.near/everything.dev"');
    expect(source).toContain(
      '"extends": "bos://dev.everything.near/everything.dev#plugins.remote"',
    );
    expect(source).toContain('"extends": "bos://dev.everything.near/everything.dev#plugins.mixed"');
    expect(source).toContain('"path": "plugins/local"');
    expect(source).toContain('"path": "api"');
    expect(source).not.toContain('"production"');
  });

  it("is a no-op without the legacy file and when a descriptor already exists", async () => {
    const dir = makeProject();
    expect((await convertLegacyJsonConfig(dir)).status).toBe("absent");

    writeJson(dir, fullChild);
    writeFileSync(join(dir, "bos.app.ts"), "export default { name: 'x' };\n");
    expect((await convertLegacyJsonConfig(dir)).status).toBe("already-descriptor");
    expect(existsSync(join(dir, "bos.config.json"))).toBe(true);
  });

  it("aborts loudly and leaves the tree unchanged on fields the descriptor cannot express", async () => {
    const dir = makeProject();
    writeJson(dir, { ...fullChild, gateway: "child.dev" });

    await expect(convertLegacyJsonConfig(dir)).rejects.toThrow(/gateway/);
    expect(existsSync(join(dir, "bos.app.ts"))).toBe(false);
    expect(existsSync(join(dir, "bos.config.json"))).toBe(true);
    expect(existsSync(join(dir, ".bos", "sync-backup"))).toBe(false);
  });

  it("aborts loudly when a remote-only plugin has no extends ref to target", async () => {
    const dir = makeProject();
    writeJson(dir, {
      account: "child.near",
      plugins: { orphan: { production: "https://orphan.child.dev" } },
    });

    await expect(convertLegacyJsonConfig(dir)).rejects.toThrow(/orphan/);
    expect(existsSync(join(dir, "bos.app.ts"))).toBe(false);
  });

  it("aborts loudly when the auth attachment's ui carries pipeline fields", async () => {
    const dir = makeProject();
    writeJson(dir, {
      account: "child.near",
      app: { auth: { ui: { production: "https://auth-ui.child.dev" } } },
    });

    await expect(convertLegacyJsonConfig(dir)).rejects.toThrow(/app\.auth\.ui/);
    expect(existsSync(join(dir, "bos.app.ts"))).toBe(false);
  });
});

describe("readAuthoredOrLegacyJsonConfig", () => {
  it("prefers the descriptor and falls back to direct legacy JSON", async () => {
    const dir = makeProject();
    writeJson(dir, { account: "legacy.near" });
    expect((await readAuthoredOrLegacyJsonConfig(dir))?.account).toBe("legacy.near");

    writeFileSync(
      join(dir, "bos.app.ts"),
      `export default ${JSON.stringify({ name: "d", account: "desc.near" })};\n`,
    );
    expect((await readAuthoredOrLegacyJsonConfig(dir))?.account).toBe("desc.near");
  });

  it("returns null when no config exists", async () => {
    const dir = makeProject();
    expect(await readAuthoredOrLegacyJsonConfig(dir)).toBeNull();
  });
});
