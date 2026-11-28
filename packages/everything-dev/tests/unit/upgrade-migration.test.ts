import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lockfileOf } from "../../src/services/lockfile/schema";
import { planCleanout, runCleanout } from "../../src/services/scaffold/cleanout";
import {
  describeMigrationFailure,
  diffCatalogEntries,
  migrateChildRootPackageJson,
} from "../../src/services/scaffold/upgrade";
import { BosConfigSchema } from "../../src/types";

describe("describeMigrationFailure", () => {
  it("faces the re-exec child's JSON error", () => {
    const stdout = JSON.stringify({
      status: "error",
      error: { message: "Template sync hit unresolvable local conflicts" },
    });
    expect(describeMigrationFailure(stdout, undefined)).toBe(
      "Template sync hit unresolvable local conflicts",
    );
  });

  it("falls back to the raw streams when stdout is not JSON", () => {
    expect(describeMigrationFailure("not json", "boom")).toBe("boom");
  });

  it("falls back to stdout when stderr is empty and stdout is plain text", () => {
    expect(describeMigrationFailure("panic", "")).toBe("panic");
  });

  it("reports Unknown error when nothing usable arrives", () => {
    expect(describeMigrationFailure(undefined, "   ")).toBe("Unknown error");
  });
});

describe("diffCatalogEntries", () => {
  it("flags existing entries whose version moves", () => {
    const updates = diffCatalogEntries(
      { "my-lib": "^2.0.0", "my-tool": "^3.0.0" },
      { "my-lib": "^1.5.0" },
    );
    expect(updates).toEqual([
      { name: "my-lib", from: "^1.5.0", to: "^2.0.0" },
      { name: "my-tool", from: undefined, to: "^3.0.0" },
    ]);
  });

  it("does not count purely-additive chain entries the child does not consume", () => {
    const updates = diffCatalogEntries(
      { "already-mine": "^1.0.0", "new-chain-only": "^9.0.0" },
      { "already-mine": "^1.0.0", "new-chain-only": "^9.0.0" },
    );
    expect(updates).toEqual([]);
  });

  it("never treats the framework packages themselves as drift", () => {
    const updates = diffCatalogEntries(
      { "everything-dev": "^100.0.0", "every-plugin": "^100.0.0", "my-lib": "^2.0.0" },
      { "everything-dev": "^1.0.0", "my-lib": "^1.0.0" },
    );
    expect(updates).toEqual([{ name: "my-lib", from: "^1.0.0", to: "^2.0.0" }]);
  });
});

describe("migrateChildRootPackageJson", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeProjectDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "upgrade-package-migration-"));
    tempDirs.push(dir);
    return dir;
  }

  function writeProject(
    dir: string,
    config: Record<string, unknown>,
    pkg: Record<string, unknown>,
  ) {
    writeFileSync(
      join(dir, "bos.app.ts"),
      `export default ${JSON.stringify({ name: "test-app", ...config }, null, 2)};\n`,
    );
    writeFileSync(join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  }

  it("renovates the v2 root manifest basics and strips parent-only scripts", async () => {
    const dir = makeProjectDir();
    writeProject(
      dir,
      { extends: "bos://dev.everything.near/everything.dev", account: "test.near" },
      {
        name: "monorepo",
        module: "index.js",
        scripts: { dev: "bos dev", "sync-catalog": "pnpm sync-catalog", init: "bos init" },
      },
    );

    expect(await migrateChildRootPackageJson(dir)).toBe(true);

    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as Record<
      string,
      unknown
    >;
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe("module");
    expect(pkg.module).toBeUndefined();
    expect((pkg.scripts as Record<string, unknown>)["sync-catalog"]).toBeUndefined();
    expect((pkg.scripts as Record<string, unknown>).init).toBeUndefined();
    expect((pkg.scripts as Record<string, unknown>).dev).toBe("bos dev");
  });

  it("is idempotent on a compliant manifest", async () => {
    const dir = makeProjectDir();
    writeProject(
      dir,
      { extends: "bos://dev.everything.near/everything.dev", account: "test.near" },
      { private: true, type: "module", scripts: { dev: "bos dev" } },
    );

    expect(await migrateChildRootPackageJson(dir)).toBe(true);
    expect(await migrateChildRootPackageJson(dir)).toBe(false);
  });

  it("scrubs the retired postinstall typegen by value", async () => {
    const dir = makeProjectDir();
    writeProject(
      dir,
      { extends: "bos://dev.everything.near/everything.dev", account: "test.near" },
      {
        private: true,
        type: "module",
        scripts: {
          dev: "bos dev",
          postinstall: "node node_modules/.bin/bos types gen || true",
        },
      },
    );

    expect(await migrateChildRootPackageJson(dir)).toBe(true);

    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as Record<
      string,
      unknown
    >;
    expect((pkg.scripts as Record<string, unknown>).postinstall).toBeUndefined();
    expect((pkg.scripts as Record<string, unknown>).dev).toBe("bos dev");
  });

  it("keeps a child-authored postinstall the framework did not scaffold", async () => {
    const dir = makeProjectDir();
    writeProject(
      dir,
      { extends: "bos://dev.everything.near/everything.dev", account: "test.near" },
      { private: true, type: "module", scripts: { postinstall: "husky install" } },
    );

    await migrateChildRootPackageJson(dir);

    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as Record<
      string,
      unknown
    >;
    expect((pkg.scripts as Record<string, unknown>).postinstall).toBe("husky install");
  });

  it("returns false without a bos:// extends — parent wiring is not the CLI's business", async () => {
    const dir = makeProjectDir();
    writeProject(dir, { account: "test.near" }, { private: true, type: "module" });
    expect(await migrateChildRootPackageJson(dir)).toBe(false);
  });

  it("writes nothing when the config is missing", async () => {
    const dir = makeProjectDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
    );
    expect(await migrateChildRootPackageJson(dir)).toBe(false);
  });
});

describe("cleanout — the migration deletes legacy state for real (#921)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeChildDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "cleanout-child-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "bos.app.ts"),
      `export default ${JSON.stringify(
        {
          name: "child",
          extends: "bos://dev.everything.near/everything.dev",
          account: "test.near",
        },
        null,
        2,
      )};\n`,
    );
    return dir;
  }

  const lockConfig = BosConfigSchema.parse({
    account: "test.near",
    domain: "test.dev",
    app: {
      host: { development: "local:host", production: "https://cdn/host/" },
      ui: { development: "local:ui", production: "https://cdn/ui/" },
      api: { development: "local:api", production: "https://cdn/api/" },
    },
  });

  function writeGhostSnapshot(dir: string): void {
    mkdirSync(join(dir, ".bos"), { recursive: true });
    writeFileSync(
      join(dir, "bos.lock.json"),
      JSON.stringify(
        lockfileOf({ account: "test.near", gateway: "test.dev", config: lockConfig }),
        null,
        2,
      ),
    );
    writeFileSync(
      join(dir, ".bos", "sync-snapshot.json"),
      JSON.stringify(
        { timestamp: "2026-11-01T00:00:00.000Z", files: { ".gitignore": "hash-1" } },
        null,
        2,
      ),
    );
  }

  function writeGhostChangesets(dir: string): void {
    mkdirSync(join(dir, ".changeset"), { recursive: true });
    writeFileSync(
      join(dir, ".changeset", "config.json"),
      JSON.stringify({ $schema: "https://unpkg.com/@changesets/config" }, null, 2),
    );
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify(
        {
          name: "child",
          private: true,
          type: "module",
          scripts: {
            dev: "bos dev",
            changeset: "changeset",
            version: "changeset version",
            release: "changeset release",
          },
        },
        null,
        2,
      )}\n`,
    );
  }

  it("the dry-run plan names every ghost without writing anything", async () => {
    const dir = makeChildDir();
    writeGhostSnapshot(dir);
    writeGhostChangesets(dir);

    const plan = await planCleanout(dir);

    expect(plan.map((item) => item.target)).toEqual([
      ".bos/sync-snapshot.json",
      ".changeset/",
      "package.json scripts.changeset",
      "package.json scripts.version",
      "package.json scripts.release",
    ]);
    expect(existsSync(join(dir, ".changeset"))).toBe(true);
    expect(existsSync(join(dir, ".bos", "sync-snapshot.json"))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      scripts: Record<string, unknown>;
    };
    expect(pkg.scripts.changeset).toBe("changeset");
  });

  it("the run deletes each ghost and logs what it removed", async () => {
    const dir = makeChildDir();
    writeGhostSnapshot(dir);
    writeGhostChangesets(dir);
    const log = vi.fn();

    const { items, lockAbsorbed } = await runCleanout(dir, log);

    expect(lockAbsorbed).toBe(true);
    expect(items.map((item) => item.target)).toEqual([".bos/sync-snapshot.json", ".changeset/"]);
    expect(existsSync(join(dir, ".changeset"))).toBe(false);
    expect(existsSync(join(dir, ".bos", "sync-snapshot.json"))).toBe(false);
    const lock = JSON.parse(readFileSync(join(dir, "bos.lock.json"), "utf-8")) as {
      template?: { files?: Record<string, string> };
    };
    expect(lock.template?.files).toEqual({ ".gitignore": "hash-1" });
    const messages = log.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes("sync-snapshot.json"))).toBe(true);
    expect(messages.some((m) => m.includes(".changeset/"))).toBe(true);
  });

  it("a re-run is a no-op", async () => {
    const dir = makeChildDir();
    writeGhostSnapshot(dir);
    writeGhostChangesets(dir);
    await runCleanout(dir, () => {});
    await migrateChildRootPackageJson(dir, () => {});

    expect(await planCleanout(dir)).toEqual([]);
    const second = await runCleanout(dir, () => {});
    expect(second).toEqual({ items: [], lockAbsorbed: false });
  });

  it("the root runtime keeps its changesets — the lever lives there", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cleanout-root-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "bos.app.ts"),
      `export default ${JSON.stringify({ name: "root", account: "test.near" }, null, 2)};\n`,
    );
    writeGhostChangesets(dir);

    expect(await planCleanout(dir)).toEqual([]);
    const { items } = await runCleanout(dir, () => {});
    expect(items).toEqual([]);
    expect(existsSync(join(dir, ".changeset"))).toBe(true);
  });

  it("the script scrub logs what it removed", async () => {
    const dir = makeChildDir();
    writeGhostChangesets(dir);
    const log = vi.fn();

    expect(await migrateChildRootPackageJson(dir, log)).toBe(true);

    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      scripts: Record<string, unknown>;
    };
    expect(pkg.scripts.changeset).toBeUndefined();
    expect(pkg.scripts.version).toBeUndefined();
    expect(pkg.scripts.release).toBeUndefined();
    expect(pkg.scripts.dev).toBe("bos dev");
    const messages = log.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes("scripts.changeset"))).toBe(true);
    expect(messages.some((m) => m.includes("scripts.release"))).toBe(true);
  });
});
