import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getResolvedConfigPath } from "../../src/config";
import type { ResolvedConfigMeta } from "../../src/services/resolution/merge";
import { readWorkspaceCatalog } from "../../src/services/workspace/catalog";
import { syncResolvedSharedDeps } from "../../src/services/workspace/shared-deps";
import type { BosConfig } from "../../src/types";

const VALID_CONFIG = {
  name: "test-app",
  account: "test.near",
  domain: "test.dev",
  host: { development: "http://localhost:3000" },
  ui: { development: "http://localhost:3003" },
  api: { development: "http://localhost:3001" },
  auth: {
    name: "auth",
    path: "plugins/auth",
    shared: {
      "better-auth": { version: "1.6.9", singleton: true },
      "better-near-auth": { version: "1.5.0", singleton: true },
    },
  },
};

const writeAuthoredConfig = (dir: string, config: Record<string, unknown>): void => {
  writeFileSync(join(dir, "bos.app.ts"), `export default ${JSON.stringify(config, null, 2)};\n`);
};

const CATALOG = {
  "better-auth": "1.6.9",
  "better-near-auth": "1.5.0",
  "@better-auth/api-key": "1.6.9",
  "@better-auth/passkey": "1.6.9",
};

describe("shared sync resolved config", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "bos-shared-sync-"));
    writeAuthoredConfig(testDir, VALID_CONFIG);
    writeFileSync(
      join(testDir, "package.json"),
      `${JSON.stringify(
        {
          name: "test-app",
          private: true,
          workspaces: {
            packages: ["ui", "api"],
            catalog: CATALOG,
          },
        },
        null,
        2,
      )}\n`,
    );
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("catalog->bos mode writes to .bos/bos.resolved-config.json, not bos.app.ts", async () => {
    const beforeBos = readFileSync(join(testDir, "bos.app.ts"), "utf-8");

    const result = await syncResolvedSharedDeps({
      configDir: testDir,
      hostMode: "local",
    });

    expect(result.mode).toBe("catalog->bos");

    const afterBos = readFileSync(join(testDir, "bos.app.ts"), "utf-8");
    expect(afterBos).toBe(beforeBos);

    const resolvedPath = getResolvedConfigPath(testDir);
    expect(existsSync(resolvedPath)).toBe(true);

    const resolved = JSON.parse(readFileSync(resolvedPath, "utf-8")) as Record<string, unknown>;
    expect(resolved._resolved).toBeDefined();
    expect((resolved._resolved as ResolvedConfigMeta).source).toBe("shared-sync");
    expect(resolved.account).toBe("test.near");
  });

  it("bos->catalog mode writes the workspace catalog from the config", async () => {
    const remoteDir = mkdtempSync(join(tmpdir(), "bos-shared-remote-"));
    try {
      writeAuthoredConfig(remoteDir, VALID_CONFIG);
      writeFileSync(
        join(remoteDir, "package.json"),
        `${JSON.stringify(
          {
            name: "remote-app",
            workspaces: { packages: ["ui", "api"], catalog: {} },
          },
          null,
          2,
        )}\n`,
      );

      const result = await syncResolvedSharedDeps({
        configDir: remoteDir,
        hostMode: "remote",
      });

      expect(result.mode).toBe("bos->catalog");

      const catalog = readWorkspaceCatalog(remoteDir);
      expect(catalog["better-auth"]).toBe("1.6.9");
      expect(catalog["better-near-auth"]).toBe("1.5.0");
    } finally {
      rmSync(remoteDir, { recursive: true, force: true });
    }
  });

  it("shared dep versions sync from catalog to resolved config", async () => {
    await syncResolvedSharedDeps({
      configDir: testDir,
      hostMode: "local",
    });

    const resolved = JSON.parse(readFileSync(getResolvedConfigPath(testDir), "utf-8")) as Record<
      string,
      unknown
    >;
    const auth = (resolved.app as { auth?: { shared?: Record<string, Record<string, unknown>> } })
      .auth?.shared as Record<string, Record<string, unknown>>;
    expect(auth["better-auth"].version).toBe("1.6.9");
    expect(auth["better-near-auth"].version).toBe("1.5.0");
  });

  it("uses provided resolved config when raw child config omits inherited host", async () => {
    const childDir = mkdtempSync(join(tmpdir(), "bos-shared-child-"));
    try {
      writeFileSync(
        join(childDir, "bos.config.json"),
        `${JSON.stringify(
          {
            extends: "bos://dev.everything.near/everything.dev",
            account: "child.near",
            app: {
              ui: { name: "ui", development: "local:ui" },
              api: { name: "api", development: "local:api" },
            },
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        join(childDir, "package.json"),
        `${JSON.stringify(
          {
            name: "child-app",
            private: true,
            workspaces: {
              packages: ["ui", "api"],
              catalog: { "better-auth": "1.6.9" },
            },
          },
          null,
          2,
        )}\n`,
      );

      const resolvedConfig: BosConfig = {
        account: "child.near",
        extends: "bos://dev.everything.near/everything.dev",
        app: {
          host: { development: "http://localhost:3000", production: "https://host.test.dev" },
          ui: { name: "ui", development: "local:ui", production: "https://ui.test.dev" },
          auth: {
            name: "auth",
            development: "local:plugins/auth",
            production: "https://auth.test.dev",
            shared: { "better-auth": { version: "0.0.1", singleton: true } },
          },
          api: { name: "api", development: "local:api", production: "https://api.test.dev" },
        },
      };

      const result = await syncResolvedSharedDeps({
        configDir: childDir,
        hostMode: "local",
        bosConfig: resolvedConfig,
      });

      expect(result.mode).toBe("catalog->bos");
      const resolved = JSON.parse(readFileSync(getResolvedConfigPath(childDir), "utf-8")) as {
        app: { auth: { shared: { "better-auth": { version: string; requiredVersion: string } } } };
      };
      expect(resolved.app.auth.shared["better-auth"].version).toBe("1.6.9");
      expect(resolved.app.auth.shared["better-auth"].requiredVersion).toBe("^1.6.9");
    } finally {
      rmSync(childDir, { recursive: true, force: true });
    }
  });

  it("generatedDigest is deterministic for same deps", async () => {
    const r1 = await syncResolvedSharedDeps({ configDir: testDir, hostMode: "local" });
    const r2 = await syncResolvedSharedDeps({ configDir: testDir, hostMode: "local" });
    expect(r1.resolved.generatedDigest).toBe(r2.resolved.generatedDigest);
  });

  it("fails when a shared dep has no exact version", async () => {
    const unresolvedDir = mkdtempSync(join(tmpdir(), "bos-shared-unresolved-"));
    try {
      writeAuthoredConfig(unresolvedDir, {
        name: "test-app",
        account: "test.near",
        domain: "test.dev",
        host: { development: "http://localhost:3000" },
        ui: { development: "http://localhost:3003" },
        api: {
          development: "http://localhost:3001",
          shared: {
            effect: { version: "catalog:" },
          },
        },
      });
      writeFileSync(
        join(unresolvedDir, "package.json"),
        `${JSON.stringify(
          {
            name: "test-app",
            private: true,
            workspaces: {
              packages: ["ui", "api"],
              catalog: {},
            },
          },
          null,
          2,
        )}\n`,
      );

      await expect(
        syncResolvedSharedDeps({ configDir: unresolvedDir, hostMode: "local" }),
      ).rejects.toThrow(/Could not resolve exact version for shared dependency "effect"/);
    } finally {
      rmSync(unresolvedDir, { recursive: true, force: true });
    }
  });
});
