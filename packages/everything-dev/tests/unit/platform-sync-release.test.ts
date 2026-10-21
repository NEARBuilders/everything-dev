import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { releaseRefCandidates } from "../../src/services/resolution/init-source";
import { readSnapshot, writeSnapshot } from "../../src/services/scaffold/snapshot";
import { applyReleaseRefs, resolveWorkflowReleasePin } from "../../src/services/scaffold/sync";

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

  it("leaves non-main refs, third-party @main refs, and non-uses text alone", () => {
    expect(
      applyReleaseRefs(
        "uses: actions/checkout@main\nuses: some-org/some-action@main\n# @main comment",
        "v2",
      ),
    ).toBe("uses: actions/checkout@main\nuses: some-org/some-action@main\n# @main comment");
  });
});

describe("release ref candidates (#519)", () => {
  it("tries the canonical v tag first, then the changesets per-package tag", () => {
    expect(releaseRefCandidates("2.0.0-rc.15")).toEqual([
      "v2.0.0-rc.15",
      "everything-dev@2.0.0-rc.15",
    ]);
  });
});

describe("resolveWorkflowReleasePin (#519)", () => {
  const candidates = releaseRefCandidates("2.0.0-rc.15");

  it("pins the resolved v tag when it resolved", () => {
    expect(resolveWorkflowReleasePin(candidates, "v2.0.0-rc.15", "a".repeat(40))).toBe(
      "v2.0.0-rc.15",
    );
  });

  it("pins the resolved sha when only the per-package tag resolved — an @-bearing tag is not a usable uses: ref", () => {
    expect(
      resolveWorkflowReleasePin(candidates, "everything-dev@2.0.0-rc.15", "a".repeat(40)),
    ).toBe("a".repeat(40));
  });

  it("falls back to the first candidate when nothing resolved", () => {
    expect(resolveWorkflowReleasePin(candidates, undefined, undefined)).toBe("v2.0.0-rc.15");
  });

  it("never release-scopes without a platform manifest", () => {
    expect(resolveWorkflowReleasePin(undefined, "main", "a".repeat(40))).toBeUndefined();
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
