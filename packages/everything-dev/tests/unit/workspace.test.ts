import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearWorkspaceRootCache,
  DepsBuildFailure,
  ensureFreshDeps,
  findWorkspaceRoot,
  localDepsOf,
  type WorkspaceMember,
  type WorkspaceRoot,
} from "../../src/workspace";

const tmpDirs: string[] = [];

function makeRoot(layout: Record<string, Record<string, unknown>>): string {
  const dir = mkdtempSync(join(tmpdir(), "workspace-"));
  tmpDirs.push(dir);
  for (const [relPath, manifest] of Object.entries(layout)) {
    const memberDir = join(dir, relPath);
    mkdirSync(memberDir, { recursive: true });
    writeFileSync(join(memberDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  clearWorkspaceRootCache();
  return dir;
}

function makeMember(
  root: WorkspaceRoot,
  name: string,
  localDeps: readonly string[],
): WorkspaceMember {
  const member = root.members.find((entry) => entry.name === name);
  if (!member) throw new Error(`fixture member ${name} missing`);
  return { ...member, localDeps };
}

function makeRootFromMembers(rootDir: string, members: readonly WorkspaceMember[]): WorkspaceRoot {
  return { dir: rootDir, members };
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  clearWorkspaceRootCache();
});

describe("localDepsOf", () => {
  const rootDir = "/";
  const member = (name: string, localDeps: readonly string[]): WorkspaceMember => ({
    name,
    dir: `${rootDir}${name}`,
    localDeps,
  });

  it("closes over transitive declared edges, dependencies before dependents", () => {
    const root = makeRootFromMembers(rootDir, [
      member("every-plugin", []),
      member("everything-dev", ["every-plugin"]),
      member("ui", ["everything-dev", "every-plugin", "better-near-auth"]),
      member("better-near-auth", []),
    ]);

    const closure = localDepsOf(root, [`${rootDir}ui`]);

    expect(closure.map((entry) => entry.name)).toEqual([
      "every-plugin",
      "everything-dev",
      "better-near-auth",
    ]);
  });

  it("excludes the targets themselves", () => {
    const root = makeRootFromMembers(rootDir, [member("ui", []), member("api", ["ui"])]);

    expect(localDepsOf(root, [`${rootDir}api`, `${rootDir}ui`]).map((e) => e.name)).toEqual(["ui"]);
  });

  it("ignores dependencies that are not workspace members", () => {
    const root = makeRootFromMembers(rootDir, [member("api", ["react", "zod", "effect"])]);

    expect(localDepsOf(root, [`${rootDir}api`])).toEqual([]);
  });

  it("returns empty when a target dir is not a member", () => {
    const root = makeRootFromMembers(rootDir, [member("ui", [])]);

    expect(localDepsOf(root, ["/elsewhere/not-a-member"])).toEqual([]);
  });

  it("survives cycles and emits each member once", () => {
    const root = makeRootFromMembers(rootDir, [
      member("a", ["b"]),
      member("b", ["a"]),
      member("c", ["a", "b"]),
    ]);

    const closure = localDepsOf(root, [`${rootDir}c`]);

    expect(closure.map((entry) => entry.name).sort()).toEqual(["a", "b"]);
  });

  it("deduplicates shared dependencies across diamond targets", () => {
    const root = makeRootFromMembers(rootDir, [
      member("base", []),
      member("left", ["base"]),
      member("right", ["base"]),
    ]);

    const closure = localDepsOf(root, [`${rootDir}left`, `${rootDir}right`]);

    expect(closure.map((entry) => entry.name)).toEqual(["base"]);
  });
});

describe("findWorkspaceRoot", () => {
  it("finds the nearest package.json declaring workspaces and enumerates members", () => {
    const root = makeRoot({
      "pkgs/base": { name: "base", dependencies: { react: "*" } },
      app: { name: "app", dependencies: { base: "*" } },
      stray: { name: "stray-without-workspace-coverage" },
    });
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({ workspaces: { packages: ["pkgs/*", "app"] } }, null, 2)}\n`,
    );

    const found = findWorkspaceRoot(join(root, "pkgs", "base"));

    expect(found?.dir).toBe(root);
    expect(found?.members.map((member) => member.name).sort()).toEqual(["app", "base"]);
    const base = found?.members.find((member) => member.name === "base");
    expect(base?.localDeps).toEqual([]);
    const app = found?.members.find((member) => member.name === "app");
    expect(app?.localDeps).toEqual(["base"]);
  });

  it("accepts array-form workspaces globs and skips glob dirs without package.json", () => {
    const root = makeRoot({ "packages/one": { name: "one" } });
    mkdirSync(join(root, "packages", "empty"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({ workspaces: ["packages/*"] })}\n`,
    );

    const found = findWorkspaceRoot(root);

    expect(found?.members.map((member) => member.name)).toEqual(["one"]);
  });

  it("returns null when no ancestor declares workspaces", () => {
    const root = makeRoot({ nested: { name: "nested" } });

    expect(findWorkspaceRoot(join(root, "nested"))).toBeNull();
  });

  it("memoizes per start dir and honors the cache clear", () => {
    const root = makeRoot({ pkg: { name: "pkg" } });
    writeFileSync(join(root, "package.json"), `${JSON.stringify({ workspaces: ["pkg"] })}\n`);

    expect(findWorkspaceRoot(root)?.members).toHaveLength(1);
    writeFileSync(join(root, "pkg", "package.json"), `${JSON.stringify({ name: "renamed" })}\n`);
    expect(findWorkspaceRoot(root)?.members).toHaveLength(1);
    clearWorkspaceRootCache();
    expect(findWorkspaceRoot(root)?.members.map((member) => member.name)).toEqual(["renamed"]);
  });
});

describe("ensureFreshDeps", () => {
  function writeBuildFixture(root: string, name: string, deps: Record<string, string>): string {
    const memberDir = join(root, "pkgs", name);
    mkdirSync(memberDir, { recursive: true });
    writeFileSync(
      join(memberDir, "package.json"),
      `${JSON.stringify(
        {
          name,
          module: "dist/index.mjs",
          scripts: { build: "mkdir -p dist && printf 'built' > dist/index.mjs" },
          dependencies: deps,
        },
        null,
        2,
      )}\n`,
    );
    mkdirSync(join(memberDir, "src"), { recursive: true });
    writeFileSync(join(memberDir, "src", "index.ts"), "export {};\n");
    return memberDir;
  }

  function writeGraph(): { root: string; app: string; mid: string; base: string } {
    const root = makeRoot({});
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({ workspaces: ["pkgs/*", "app"] }, null, 2)}\n`,
    );
    const app = writeBuildFixture(root, "app", { mid: "*" });
    const mid = writeBuildFixture(root, "mid", { base: "*" });
    const base = writeBuildFixture(root, "base", {});
    return { root, app, mid, base };
  }

  it("builds the stale dependency closure and reports it", async () => {
    const { root, app } = writeGraph();

    const report = await ensureFreshDeps(root, [app]);

    expect(report.rebuilt.map((member) => member.name).sort()).toEqual(["base", "mid"]);
    expect(report.fresh).toEqual([]);
  });

  it("treats freshly built members as fresh on the next run", async () => {
    const { root, app, mid, base } = writeGraph();
    await ensureFreshDeps(root, [app]);
    const future = new Date(Date.now() + 60_000);
    for (const dir of [mid, base]) {
      utimesSync(join(dir, "dist", "index.mjs"), future, future);
    }

    const report = await ensureFreshDeps(root, [app]);

    expect(report.rebuilt).toEqual([]);
    expect(report.fresh.map((member) => member.name).sort()).toEqual(["base", "mid"]);
  });

  it("rebuilds only the member whose sources went stale", async () => {
    const { root, app, mid, base } = writeGraph();
    await ensureFreshDeps(root, [app]);
    const future = new Date(Date.now() + 60_000);
    for (const dir of [mid, base]) {
      utimesSync(join(dir, "dist", "index.mjs"), future, future);
    }
    const newer = new Date(Date.now() + 120_000);
    utimesSync(join(mid, "src", "index.ts"), newer, newer);

    const report = await ensureFreshDeps(root, [app]);

    expect(report.rebuilt.map((member) => member.name)).toEqual(["mid"]);
    expect(report.fresh.map((member) => member.name)).toEqual(["base"]);
  });

  it("builds all closure members when forced", async () => {
    const { root, app, mid, base } = writeGraph();
    await ensureFreshDeps(root, [app]);
    const future = new Date(Date.now() + 60_000);
    for (const dir of [mid, base]) {
      utimesSync(join(dir, "dist", "index.mjs"), future, future);
    }

    const report = await ensureFreshDeps(root, [app], { force: true });

    expect(report.rebuilt.map((member) => member.name).sort()).toEqual(["base", "mid"]);
  });

  it("throws DepsBuildFailure naming the failing member", async () => {
    const root = makeRoot({});
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({ workspaces: ["pkgs/*", "app"] })}\n`,
    );
    const app = join(root, "app");
    mkdirSync(app, { recursive: true });
    writeFileSync(
      join(app, "package.json"),
      `${JSON.stringify({ name: "app", dependencies: { broken: "*" } })}\n`,
    );
    const broken = join(root, "pkgs", "broken");
    mkdirSync(broken, { recursive: true });
    writeFileSync(
      join(broken, "package.json"),
      `${JSON.stringify({
        name: "broken",
        module: "dist/index.mjs",
        scripts: { build: "mkdir -p dist && exit 3" },
      })}\n`,
    );

    const outcome = await ensureFreshDeps(root, [app]).then(
      () => null,
      (error: unknown) => error,
    );

    expect(outcome).toBeInstanceOf(DepsBuildFailure);
    const failure = outcome as DepsBuildFailure;
    expect(failure.failures.map((entry) => entry.member.name)).toEqual(["broken"]);
    expect(failure.failures[0].exitCode).toBe(3);
    expect(failure.message).toContain("broken");
  });

  it("is a no-op when the start dir belongs to no workspace", async () => {
    const root = makeRoot({ pkg: { name: "pkg" } });

    const report = await ensureFreshDeps(join(root, "pkg"), []);

    expect(report).toEqual({ rebuilt: [], fresh: [] });
  });
});
