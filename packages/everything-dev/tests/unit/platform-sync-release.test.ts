import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSnapshot, writeSnapshot } from "../../src/services/scaffold/snapshot";
import { applyReleaseRefs } from "../../src/services/scaffold/sync";

let tmpRoot: string;

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe("applyReleaseRefs", () => {
  it("pins the framework's reusable-workflow refs to the release tag", () => {
    const content = [
      "jobs:",
      "  deploy:",
      "    uses: NEARBuilders/everything-dev/.github/workflows/consumer-deploy.yml@main",
      "  ci:",
      "    uses: NEARBuilders/everything-dev/.github/workflows/consumer-ci.yml@main",
      "  checkout:",
      "    uses: actions/checkout@v4",
    ].join("\n");
    expect(applyReleaseRefs(content, "v2.0.0-rc.14")).toBe(
      content
        .replace("consumer-deploy.yml@main", "consumer-deploy.yml@v2.0.0-rc.14")
        .replace("consumer-ci.yml@main", "consumer-ci.yml@v2.0.0-rc.14"),
    );
  });

  it("leaves non-main refs and non-uses text alone", () => {
    expect(applyReleaseRefs("uses: actions/checkout@v4\n# @main comment", "v2")).toBe(
      "uses: actions/checkout@v4\n# @main comment",
    );
  });
});

describe("sync snapshot release provenance (ADR 0034)", () => {
  it("round-trips the release field beside parentRef", async () => {
    tmpRoot = join(tmpdir(), "snapshot-release-");
    mkdirSync(tmpRoot, { recursive: true });
    await writeSnapshot(tmpRoot, {
      parentRef: "bos://root.near/root",
      release: "32723626aaaa",
      files: { "package.json": "abc123" },
    });
    const snapshot = await readSnapshot(tmpRoot);
    expect(snapshot?.release).toBe("32723626aaaa");
    expect(snapshot?.parentRef).toBe("bos://root.near/root");
  });
});
