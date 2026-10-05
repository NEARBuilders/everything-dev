import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  computeKeepSet,
  expandWorkspaceGlobs,
  pruneNodeModules,
  readWorkspacePackageGlobs,
} from "../../../../scripts/prune-runtime-node-modules";

const tmpRoot = join(import.meta.dirname, ".prune-fixture");

function pkg(dir: string, body: Record<string, unknown>) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(body));
}

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function makeFixture() {
  const nm = join(tmpRoot, "node_modules");
  pkg(join(nm, "a"), { name: "a", dependencies: { b: "^1" } });
  pkg(join(nm, "b"), { name: "b", dependencies: { c: "^1" }, peerDependencies: { f: "*" } });
  pkg(join(nm, "c"), { name: "c" });
  pkg(join(nm, "d"), { name: "d" });
  pkg(join(nm, "e"), { name: "e", optionalDependencies: { c: "^1" } });
  pkg(join(nm, "f"), { name: "f" });
  pkg(join(nm, "@scope/x"), { name: "@scope/x" });
  pkg(join(nm, "@scope/y"), { name: "@scope/y" });
  mkdirSync(join(nm, ".bin"), { recursive: true });
  return nm;
}

describe("computeKeepSet", () => {
  it("keeps the transitive production closure and nothing else", () => {
    const nm = makeFixture();
    const keep = computeKeepSet(nm, [join(nm, "a/package.json"), join(nm, "e/package.json")]);
    expect(keep.has("a")).toBe(true);
    expect(keep.has("b")).toBe(true);
    expect(keep.has("c")).toBe(true);
    expect(keep.has("e")).toBe(true);
    expect(keep.has("f")).toBe(false);
    expect(keep.has("d")).toBe(false);
  });

  it("ignores declared deps that are not installed", () => {
    const nm = makeFixture();
    const keep = computeKeepSet(nm, [join(nm, "d/package.json")]);
    expect(keep.has("d")).toBe(true);
    expect(keep.has("ghost-package")).toBe(false);
  });

  it("resolves scoped package names", () => {
    const nm = makeFixture();
    pkg(join(nm, "a"), { name: "a", dependencies: { "@scope/x": "^1" } });
    const keep = computeKeepSet(nm, [join(nm, "a/package.json")]);
    expect(keep.has("@scope/x")).toBe(true);
    expect(keep.has("@scope/y")).toBe(false);
  });
});

describe("pruneNodeModules", () => {
  it("deletes packages outside the keep-set and preserves dotfile entries", () => {
    const nm = makeFixture();
    const keep = new Set(["a", "@scope/x"]);
    const { removed } = pruneNodeModules(nm, keep);
    expect(removed.sort()).toEqual(["@scope/y", "b", "c", "d", "e", "f"]);
    expect(join(nm, "a")).toBeTruthy();
  });

  it("prunes platform-mismatched optional binaries even when kept", () => {
    const nm = makeFixture();
    pkg(join(nm, "a"), { name: "a", os: ["darwin"] });
    pkg(join(nm, "b"), { name: "b", os: ["linux"], cpu: ["arm64"] });
    pkg(join(nm, "c"), { name: "c-libc-thing", libc: ["musl"] });
    pkg(join(nm, "binding-linux-arm64-gnu"), { name: "binding-linux-arm64-gnu" });
    pkg(join(nm, "binding-linux-arm64-musl"), { name: "binding-linux-arm64-musl" });
    const linuxMusl = { platform: "linux", arch: "arm64", musl: true };
    const { removed } = pruneNodeModules(
      nm,
      new Set(["a", "b", "c", "binding-linux-arm64-gnu", "binding-linux-arm64-musl"]),
      linuxMusl,
    );
    expect(removed.sort()).toEqual([
      "@scope/x",
      "@scope/y",
      "a",
      "binding-linux-arm64-gnu",
      "d",
      "e",
      "f",
    ]);
  });
});

describe("readWorkspacePackageGlobs", () => {
  it("reads pnpm-workspace.yaml packages first, then the legacy workspaces field", () => {
    mkdirSync(tmpRoot, { recursive: true });
    writeFileSync(join(tmpRoot, "pnpm-workspace.yaml"), "packages:\n  - api\n  - packages/*\n");
    expect(readWorkspacePackageGlobs(tmpRoot)).toEqual(["api", "packages/*"]);

    rmSync(join(tmpRoot, "pnpm-workspace.yaml"));
    writeFileSync(
      join(tmpRoot, "package.json"),
      JSON.stringify({ workspaces: { packages: ["ui", "host"] } }),
    );
    expect(readWorkspacePackageGlobs(tmpRoot)).toEqual(["ui", "host"]);
  });
});

describe("expandWorkspaceGlobs", () => {
  it("expands star patterns and drops members without package.json", () => {
    mkdirSync(join(tmpRoot, "ws/plugins/one"), { recursive: true });
    pkg(join(tmpRoot, "ws/plugins/one"), { name: "one" });
    mkdirSync(join(tmpRoot, "ws/plugins/empty"), { recursive: true });
    const dirs = expandWorkspaceGlobs(join(tmpRoot, "ws"), ["plugins/*"]);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toContain("one");
  });
});
