import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateAlchemyRun } from "../../src/alchemy";
import { buildDatabaseConfigs } from "../../src/cli/infra";
import {
  findBosConfigPathInDir,
  readBosConfigSource,
  stringifyBosConfig,
} from "../../src/config-source";
import { mergeBosConfigWithExtends } from "../../src/merge";

describe("TOML config e2e pipeline", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bos-e2e-toml-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads a full bos.config.toml with infra + deploy sections", () => {
    writeFileSync(
      join(tmpDir, "bos.config.toml"),
      [
        `account = "test.everything.near"`,
        `domain = "test.everything.dev"`,
        ``,
        `[ci]`,
        `[ci.railway]`,
        `service = "test-api"`,
        ``,
        `[infra.database]`,
        `type = "postgres"`,
        ``,
        `[deploy]`,
        `provider = "railway"`,
        `service = "test-api"`,
        `redeploy = true`,
        ``,
        `[app.ui]`,
        `development = "local:ui"`,
        `production = "https://cdn.example.com/ui"`,
        ``,
        `[app.api]`,
        `development = "local:api"`,
        `production = "https://cdn.example.com/api"`,
        ``,
        `[app.host]`,
        `development = "local:host"`,
        `production = "https://cdn.example.com/host"`,
        ``,
        `[plugins.apps]`,
        `development = "local:plugins/apps"`,
        `production = "https://cdn.example.com/apps"`,
      ].join("\n"),
    );

    const config = readBosConfigSource(join(tmpDir, "bos.config.toml"));
    expect(config.account).toBe("test.everything.near");
    expect(config.domain).toBe("test.everything.dev");
    expect(config.ci?.railway?.service).toBe("test-api");
    expect(config.deploy?.provider).toBe("railway");
    expect(config.deploy?.service).toBe("test-api");
    expect(config.deploy?.redeploy).toBe(true);

    const infra = config.infra!;
    expect(infra.database).toBeDefined();
    if (infra.database && !Array.isArray(infra.database) && typeof infra.database === "object") {
      const db = infra.database as Record<string, unknown>;
      expect(db.type).toBe("postgres");
    }

    const appUi = config.app?.ui as Record<string, unknown> | undefined;
    expect(appUi?.development).toBe("local:ui");

    const plugins = config.plugins as Record<string, unknown> | undefined;
    const appsPlugin = plugins?.apps as Record<string, unknown> | undefined;
    expect(appsPlugin?.development).toBe("local:plugins/apps");
  });

  it("finds bos.config.toml in directory", () => {
    const found = findBosConfigPathInDir(tmpDir);
    expect(found).toBe(join(tmpDir, "bos.config.toml"));
  });

  it("merges infra + deploy through extends chain", () => {
    const parent = {
      account: "parent.near",
      infra: { database: { type: "postgres" as const } },
    };
    const child = {
      account: "child.near",
      deploy: { provider: "railway" as const, service: "child-api" },
    };
    const merged = mergeBosConfigWithExtends(parent, child);
    const m = merged as Record<string, unknown>;
    expect(m.account).toBe("child.near");
    expect(m.infra).toEqual(parent.infra);
    expect(m.deploy).toEqual({ provider: "railway", service: "child-api" });
  });

  it("ci.railway maps to deploy in merge", () => {
    const merged = mergeBosConfigWithExtends(
      {},
      {
        ci: { railway: { service: "mapped-service" } },
        account: "test.near",
      },
    );
    const m = merged as Record<string, unknown>;
    expect(m.deploy).toEqual({ provider: "railway", service: "mapped-service" });
  });

  it("buildDatabaseConfigs uses shared DATABASE_URL with infraConfig", () => {
    const configs = buildDatabaseConfigs(
      ["API_DATABASE_URL", "AUTH_DATABASE_URL"],
      new Map(),
      {},
      { database: { type: "postgres" } },
    );
    expect(configs).toHaveLength(1);
    expect(configs[0].secret).toBe("DATABASE_URL");
  });

  it("generateAlchemyRun produces valid output", () => {
    generateAlchemyRun(
      { provider: "railway", service: "test-api", redeploy: true },
      { database: { type: "postgres" } },
      tmpDir,
    );

    const output = readFileSync(join(tmpDir, "alchemy.run.ts"), "utf-8");
    expect(output).toContain('provider = "railway"');
    expect(output).toContain('stage = "production"');
    expect(output).toContain('const service = "test-api"');
    expect(output).toContain("Redeploy service: test-api");
    expect(output).not.toContain("[d eploy]");
  });

  it("stringifyBosConfig round-trips through readBosConfigSource", () => {
    const original = {
      account: "roundtrip.near",
      domain: "roundtrip.dev",
      deploy: { provider: "railway" as const, service: "rt-service", redeploy: true },
    };
    const toml = stringifyBosConfig(original);
    writeFileSync(join(tmpDir, "roundtrip.toml"), toml);
    const parsed = readBosConfigSource(join(tmpDir, "roundtrip.toml"));
    expect(parsed.account).toBe("roundtrip.near");
    expect(parsed.deploy?.service).toBe("rt-service");
  });

  it("TOML with infra section produces correct infra config", () => {
    writeFileSync(
      join(tmpDir, "infra-test.toml"),
      [
        `[infra.database]`,
        `type = "postgres"`,
        ``,
        `[infra.redis]`,
        `enabled = true`,
        ``,
        `[deploy]`,
        `provider = "railway"`,
        `service = "my-app"`,
      ].join("\n"),
    );
    const config = readBosConfigSource(join(tmpDir, "infra-test.toml"));
    expect(config.infra?.database).toBeDefined();
    const db = config.infra!.database as Record<string, unknown>;
    expect(db.type).toBe("postgres");
    expect(config.infra?.redis?.enabled).toBe(true);
    expect(config.deploy?.provider).toBe("railway");
    expect(config.deploy?.service).toBe("my-app");
  });
});
