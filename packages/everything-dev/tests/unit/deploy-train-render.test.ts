import chalk from "chalk";
import { beforeAll, describe, expect, it } from "vitest";
import { cliDeployTrainRender, renderBuildWarnings } from "../../src/cli/render/deploy-train";

const quietConsole = () => {
  const printed: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => {
    printed.push(args.join(" "));
  };
  return { printed, restore: () => (console.log = log) };
};

describe("cliDeployTrainRender (output snapshots)", () => {
  beforeAll(() => {
    // Snapshots pin text and layout, not ANSI escapes.
    chalk.level = 0;
  });

  it("upload outcome: one line per workspace, aligned name column, dim detail behind verbose", () => {
    const { printed, restore } = quietConsole();
    try {
      cliDeployTrainRender.uploadOutcome?.({
        key: "ui",
        ok: true,
        base: "https://cdn.test/bundles/a/g/ui/",
        uploaded: 3,
        skipped: 12,
        durationMs: 1234,
      });
      cliDeployTrainRender.uploadOutcome?.({
        key: "votes",
        ok: true,
        base: "https://cdn.test/bundles/a/g/votes/",
        uploaded: 0,
        skipped: 9,
        durationMs: 210,
        // verbose mode: attributed detail lines with the name column held
        detailNotes: [
          "2 unchanged file(s) — skipping (manifest diff)",
          "version manifest versions/v2.json (SRI pinned)",
        ],
      });
      cliDeployTrainRender.uploadOutcome?.({ key: "api", ok: false });

      expect(printed).toMatchInlineSnapshot(`
        [
          "  ✓ ui                           → https://cdn.test/bundles/a/g/ui/ (3 uploaded, 12 skipped, 1.2s)",
          "  ✓ votes                        → https://cdn.test/bundles/a/g/votes/ (0 uploaded, 9 skipped, 210ms)",
          "                                 2 unchanged file(s) — skipping (manifest diff)",
          "                                 version manifest versions/v2.json (SRI pinned)",
          "  ✗ api                          upload failed",
        ]
      `);
    } finally {
      restore();
    }
  });

  it("publish section: registry URL, fingerprint, ordered slot pins, audit manifest", () => {
    const { printed, restore } = quietConsole();
    try {
      cliDeployTrainRender.publish?.({
        registryUrl: "https://kv.example/v0/latest/a/g/apps%2Fa%2Fg%2Fbos.config.json",
        fingerprint: "e3b0c44298fc1c14",
        slotPins: [
          ["app.ui", "https://cdn.test/.../versions/v1.json+sha384-x"],
          ["plugins.votes.ui", "https://cdn.test/.../versions/v1.json+sha384-y"],
        ],
        auditManifestFile: "2026-10-16T16-49-02-220Z.json",
      });

      expect(printed).toMatchInlineSnapshot(`
        [
          "",
          "  Publishing to:",
          "    https://kv.example/v0/latest/a/g/apps%2Fa%2Fg%2Fbos.config.json",
          "    Fingerprint: e3b0c44298fc1c14",
          "    app.ui:",
          "      https://cdn.test/.../versions/v1.json+sha384-x",
          "    plugins.votes.ui:",
          "      https://cdn.test/.../versions/v1.json+sha384-y",
          "    + per-deploy manifest 2026-10-16T16-49-02-220Z.json (audit trail)",
        ]
      `);
    } finally {
      restore();
    }
  });

  it("build warnings render attributed per workspace", () => {
    const { printed, restore } = quietConsole();
    try {
      renderBuildWarnings([
        { key: "ui", warnings: ["WARNING in ./src/index.ts\n  ⚠ something smells (rsbuild)"] },
        { key: "api", warnings: [] },
        { key: "votes", warnings: ["WARN stale lockfile detected"] },
      ]);

      expect(printed).toMatchInlineSnapshot(`
        [
          "",
          "  ⚠ Build warnings:",
          "    ui                           WARNING in ./src/index.ts",
          "                                   ⚠ something smells (rsbuild)",
          "    votes                        WARN stale lockfile detected",
        ]
      `);
    } finally {
      restore();
    }
  });

  it("renders nothing when no workspace has warnings", () => {
    const { printed, restore } = quietConsole();
    try {
      renderBuildWarnings([{ key: "ui", warnings: [] }]);
      expect(printed).toEqual([]);
    } finally {
      restore();
    }
  });

  it("cdn banner opens the section with a blank line", () => {
    const { printed, restore } = quietConsole();
    try {
      cliDeployTrainRender.cdnBanner?.("https://storage.test");
      expect(printed).toMatchInlineSnapshot(`
        [
          "",
          "  CDN deploy — uploading workspace dists to https://storage.test...",
        ]
      `);
    } finally {
      restore();
    }
  });
});
