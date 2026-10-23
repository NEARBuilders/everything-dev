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

describe("release ref (ADR 0034)", () => {
  it("is the canonical v tag of the framework version", () => {
    expect(releaseRefCandidates("2.0.0-rc.15")).toBe("v2.0.0-rc.15");
  });
});

describe("resolveWorkflowReleasePin (ADR 0034)", () => {
  it("pins the resolved v tag when it resolved", () => {
    expect(resolveWorkflowReleasePin("v2.0.0-rc.15", "v2.0.0-rc.15", "a".repeat(40))).toBe(
      "v2.0.0-rc.15",
    );
  });

  it("pins the resolved sha when only a non-v ref resolved — an @-bearing ref is not a usable uses: target", () => {
    expect(resolveWorkflowReleasePin("v2.0.0-rc.15", "main", "a".repeat(40))).toBe("a".repeat(40));
  });

  it("falls back to the release tag when the pin could not be resolved", () => {
    expect(resolveWorkflowReleasePin("v2.0.0-rc.15", undefined, undefined)).toBe("v2.0.0-rc.15");
  });
});

describe("sync snapshot (files-only shape)", () => {
  it("round-trips file hashes without provenance metadata", async () => {
    tmpRoot = join(tmpdir(), "snapshot-files-only-");
    mkdirSync(tmpRoot, { recursive: true });
    await writeSnapshot(tmpRoot, { files: { "package.json": "abc123" } });
    const snapshot = await readSnapshot(tmpRoot);
    expect(snapshot?.files).toEqual({ "package.json": "abc123" });
    expect(typeof snapshot?.timestamp).toBe("string");
    expect(snapshot && !("parentRef" in snapshot) && !("release" in snapshot)).toBe(true);
  });
});
