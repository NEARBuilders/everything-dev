import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeMigrationFailure,
  diffCatalogEntries,
  migrateChildRootPackageJson,
} from "../../src/services/scaffold/upgrade";

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
    writeFileSync(join(dir, "bos.config.json"), `${JSON.stringify(config, null, 2)}\n`);
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
