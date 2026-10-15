import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  syncSkillLibraryVersions,
  syncWorkspaceSkillLibraryVersions,
} from "../../src/skill-library-versions";

const tmpRoot = join(import.meta.dirname, ".skill-library-versions-fixture");

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function makePackage(
  name: string,
  version: string | undefined,
  skills: Record<string, string>,
): string {
  const pkgDir = join(tmpRoot, "packages", name);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    `${JSON.stringify(version ? { name, version } : { name }, null, 2)}\n`,
  );
  for (const [dir, content] of Object.entries(skills)) {
    mkdirSync(join(pkgDir, "skills", dir), { recursive: true });
    writeFileSync(join(pkgDir, "skills", dir, "SKILL.md"), content);
  }
  return pkgDir;
}

function readMarker(skillPath: string): string | undefined {
  return readFileSync(skillPath, "utf8").match(/library_version: "([^"]*)"/)?.[1];
}

const skillWithMarker = (version: string) =>
  `---
name: client
metadata:
  library: better-near-auth
  library_version: "${version}"
---

# Client
`;

describe("syncSkillLibraryVersions", () => {
  it("rewrites markers to the package version and reports each change", () => {
    const pkgDir = makePackage("lib", "2.0.0-rc.1", {
      client: skillWithMarker("2.0.0-rc.0"),
      relay: skillWithMarker("1.9.0"),
    });

    const changed = syncSkillLibraryVersions(pkgDir);

    expect(changed).toEqual([
      { file: "skills/client/SKILL.md", from: "2.0.0-rc.0", to: "2.0.0-rc.1" },
      { file: "skills/relay/SKILL.md", from: "1.9.0", to: "2.0.0-rc.1" },
    ]);
    expect(readMarker(join(pkgDir, "skills/client/SKILL.md"))).toBe("2.0.0-rc.1");
    expect(readMarker(join(pkgDir, "skills/relay/SKILL.md"))).toBe("2.0.0-rc.1");
  });

  it("is a no-op when markers already match", () => {
    const pkgDir = makePackage("lib", "2.0.0-rc.1", { client: skillWithMarker("2.0.0-rc.1") });

    expect(syncSkillLibraryVersions(pkgDir)).toEqual([]);
  });

  it("leaves skills without a library_version marker untouched", () => {
    const withoutMarker = "---\nname: plain\nmetadata:\n  sources: src/index.ts\n---\n\n# Plain\n";
    const pkgDir = makePackage("lib", "2.0.0-rc.1", { plain: withoutMarker });

    expect(syncSkillLibraryVersions(pkgDir)).toEqual([]);
    expect(readFileSync(join(pkgDir, "skills/plain/SKILL.md"), "utf8")).toBe(withoutMarker);
  });

  it("does not touch library_version-like text in the body", () => {
    const pkgDir = makePackage("lib", "2.0.0-rc.1", {
      client: `${skillWithMarker("2.0.0-rc.0")}\nAs of 1.8.2, library_version: "0.0.1" appears in prose.\n`,
    });

    expect(syncSkillLibraryVersions(pkgDir)).toEqual([
      { file: "skills/client/SKILL.md", from: "2.0.0-rc.0", to: "2.0.0-rc.1" },
    ]);
    expect(readFileSync(join(pkgDir, "skills/client/SKILL.md"), "utf8")).toContain(
      'library_version: "0.0.1" appears in prose',
    );
  });

  it("skips packages without a version or skills directory", () => {
    const noVersion = makePackage("no-version", undefined, { client: skillWithMarker("0.1.0") });
    const noSkills = makePackage("no-skills", "1.0.0", {});

    expect(syncSkillLibraryVersions(noVersion)).toEqual([]);
    expect(syncSkillLibraryVersions(noSkills)).toEqual([]);
  });
});

describe("syncWorkspaceSkillLibraryVersions", () => {
  it("syncs every package member under packages/ and ignores stray directories", () => {
    mkdirSync(tmpRoot, { recursive: true });
    const stray = join(tmpRoot, "not-packages", "stray");
    mkdirSync(join(stray, "skills", "client"), { recursive: true });
    writeFileSync(
      join(stray, "package.json"),
      `${JSON.stringify({ name: "stray", version: "9.0.0" })}\n`,
    );
    writeFileSync(join(stray, "skills", "client", "SKILL.md"), skillWithMarker("8.0.0"));
    makePackage("published", "3.0.0", { client: skillWithMarker("2.9.0") });
    makePackage("markerless", "1.0.0", { plain: "---\nname: plain\n---\n\n# Plain\n" });

    const changed = syncWorkspaceSkillLibraryVersions(tmpRoot);

    expect(changed).toEqual([{ file: "skills/client/SKILL.md", from: "2.9.0", to: "3.0.0" }]);
    expect(readMarker(join(stray, "skills/client/SKILL.md"))).toBe("8.0.0");
  });
});
