import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { versionDirPath } from "every-plugin/version-manifest";
import { afterAll, describe, expect, it } from "vitest";
import { localSriMap } from "../../src/services/deploy/diff";
import type { BundleUploadResult, DistFile } from "../../src/services/deploy/storage";
import { type StorageLegDeps, uploadWorkspaceBundle } from "../../src/services/deploy/upload-leg";

const archiveDir = mkdtempSync(join(tmpdir(), "upload-leg-"));
const archivePath = join(archiveDir, "app.tar.gz");
writeFileSync(archivePath, "archive bytes");

const distFiles: DistFile[] = [
  { path: "entry.abc.js", bytes: new TextEncoder().encode("entry bytes") },
  { path: "ssr/entry.def.js", bytes: new TextEncoder().encode("ssr bytes") },
];

function report(entry: string) {
  return { entry, browserManifest: undefined, ssr: undefined };
}

function fakeDeps(overrides?: Partial<StorageLegDeps>): StorageLegDeps {
  const integrity: Record<string, string> = {
    "entry.abc.js": "sha384-entry",
    "ssr/entry.def.js": "sha384-ssr",
    "versions/v1.json": "sha384-manifest",
    "app.tar.gz": "sha384-archive",
  };
  const upload = (storage?: "s3" | "memory"): Promise<BundleUploadResult> =>
    Promise.resolve({ stored: 2, totalBytes: 100, integrity, ...(storage ? { storage } : {}) });
  return {
    collectDistFiles: async () => distFiles,
    uploadWorkspaceDist: () => upload(),
    uploadBundle: () => upload(),
    resolveRemoteVersion: async () => {
      throw new Error("no previous pin in this test");
    },
    readBuildReport: (dir: string) =>
      dir.includes("ssr") ? report("entry.def.js") : report("entry.abc.js"),
    composeWorkspaceVersionManifest: (input) => ({
      version: "v1",
      entry: input.report.entry,
      entryIntegrity: input.integrityMap[input.report.entry] ?? "sha384-entry",
    }),
    buildSourceArchive: async () => ({
      file: "app.tar.gz",
      path: archivePath,
      integrity: "sha384-archive",
    }),
    ...overrides,
  };
}

function baseInput(overrides?: Partial<Parameters<typeof uploadWorkspaceBundle>[0]>) {
  return {
    account: "v1.acct.near",
    gateway: "app.test",
    workspaceKey: "app",
    distDir: "/tmp/dist",
    storageOrigin: "https://storage.test",
    urlOrigin: "https://cdn.test",
    previousPin: undefined,
    deps: fakeDeps(),
    ...overrides,
  };
}

afterAll(() => {
  rmSync(archiveDir, { recursive: true, force: true });
});

describe("uploadWorkspaceBundle", () => {
  it("uploads the dist, pins the version manifest, and reports entry integrities", async () => {
    const outcome = await uploadWorkspaceBundle(baseInput());
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.pin).toMatchObject({ file: "versions/v1.json", integrity: "sha384-manifest" });
      expect(outcome.entryIntegrity).toBe("sha384-entry");
      expect(outcome.ssrEntryIntegrity).toBe("sha384-ssr");
      expect(outcome.uploaded).toBe(2);
      expect(outcome.skipped).toBe(0);
    }
  });

  it("serves the ui sub-leg with the same implementation — no source leg, own key", async () => {
    const uploads: Array<{ workspace: string; versionDir: boolean }> = [];
    const deps = fakeDeps({
      uploadWorkspaceDist: (input) => {
        uploads.push({
          workspace: input.workspace,
          versionDir: input.files.some((file) => file.path.startsWith("versions/")),
        });
        return fakeDeps().uploadWorkspaceDist(input);
      },
    });
    const outcome = await uploadWorkspaceBundle(baseInput({ workspaceKey: "app-ui", deps }));
    expect(outcome.kind).toBe("ok");
    expect(uploads).toEqual([
      { workspace: "app-ui", versionDir: false },
      { workspace: "app-ui", versionDir: true },
    ]);
  });

  it("dual-writes the dist into a content-addressed immutable version directory (#826)", async () => {
    const dirCalls: Array<Array<{ path: string }>> = [];
    const deps = fakeDeps({
      uploadWorkspaceDist: (input) => {
        if (input.files.some((file) => file.path.startsWith("versions/"))) {
          dirCalls.push(input.files.map((file) => ({ path: file.path })));
        }
        return fakeDeps().uploadWorkspaceDist(input);
      },
    });
    const outcome = await uploadWorkspaceBundle(baseInput({ deps }));
    expect(outcome.kind).toBe("ok");
    expect(dirCalls.length).toBe(1);
    const entry = dirCalls[0]![0]!;
    expect(entry.path).toMatch(/^versions\/[0-9a-f]{16}\/entry\.abc\.js$/);
    expect(dirCalls[0]).toEqual([
      { path: `${entry.path.split("/").slice(0, 2).join("/")}/entry.abc.js` },
      { path: `${entry.path.split("/").slice(0, 2).join("/")}/ssr/entry.def.js` },
    ]);
    if (outcome.kind === "ok") {
      const notes = outcome.detail.notes.join("\n");
      expect(notes).toContain("version dir versions/");
      expect(notes).toContain("2 files, immutable");
    }
  });

  it("skips the version-dir upload when the previous pin declares the same directory", async () => {
    const previousFiles = localSriMap(distFiles);
    const dirPath = versionDirPath(previousFiles);
    const dirUploads: unknown[] = [];
    const deps = fakeDeps({
      resolveRemoteVersion: async () => ({
        dir: dirPath,
        files: previousFiles,
      }),
      uploadWorkspaceDist: (input) => {
        if (input.files.some((file) => file.path.startsWith("versions/"))) {
          dirUploads.push(input.files);
        }
        return fakeDeps().uploadWorkspaceDist(input);
      },
    });
    const outcome = await uploadWorkspaceBundle(
      baseInput({
        deps,
        previousPin: { manifest: "versions/v0.json", integrity: "sha384-prev" },
      }),
    );
    expect(outcome.kind).toBe("ok");
    expect(dirUploads).toEqual([]);
    if (outcome.kind === "ok") {
      expect(outcome.detail.notes.join("\n")).toContain(
        `version dir ${dirPath} unchanged — skipping`,
      );
    }
  });

  it("surfaces the version manifest's shared record for the publish train's truth gate (#546)", async () => {
    const outcome = await uploadWorkspaceBundle(baseInput());
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.shared).toBeUndefined();
    }
    const withShared = await uploadWorkspaceBundle(
      baseInput({
        deps: fakeDeps({
          readBuildReport: () => ({ entry: "entry.abc.js", shared: { react: "19.2.4" } }),
          composeWorkspaceVersionManifest: (input) => ({
            version: "v1",
            entry: input.report.entry,
            entryIntegrity: input.integrityMap[input.report.entry] ?? "sha384-entry",
            ...(input.report.shared ? { shared: input.report.shared } : {}),
          }),
        }),
      }),
    );
    expect(withShared.kind).toBe("ok");
    if (withShared.kind === "ok") {
      expect(withShared.shared).toEqual({ react: "19.2.4" });
    }
  });

  it("stays silent — detail lines are returned, never printed (sectioned renderer)", async () => {
    const printed: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => printed.push(args.join(" "));
    try {
      const localSri = localSriMap(distFiles);
      const deps = fakeDeps({
        // The previous manifest's entry SRI matches the local hash — the
        // skip decision — plus a file that left the dist.
        resolveRemoteVersion: async () => ({
          files: { ...localSri, "stale.js": "sha384-stale" },
        }),
      });
      const outcome = await uploadWorkspaceBundle(
        baseInput({
          deps,
          previousPin: { manifest: "versions/v0.json", integrity: "sha384-prev" },
        }),
      );
      expect(outcome.kind).toBe("ok");
      if (outcome.kind === "ok") {
        expect(outcome.detail).toMatchObject({
          manifestFile: "versions/v1.json",
        });
        expect(outcome.uploaded).toBe(0);
        expect(outcome.skipped).toBe(2);
        expect(outcome.detail.notes.length).toBeGreaterThan(0);
        expect(outcome.detail.notes.join("\n")).toContain("unchanged file(s)");
        expect(outcome.detail.notes.join("\n")).toContain("version manifest versions/v1.json");
      }
    } finally {
      console.log = log;
    }
    expect(printed).toEqual([]);
  });

  it("maps a memory-backend upload to the abort outcome", async () => {
    const deps = fakeDeps({
      uploadWorkspaceDist: () =>
        Promise.resolve({ stored: 1, totalBytes: 1, integrity: {}, storage: "memory" }),
    });
    const outcome = await uploadWorkspaceBundle(baseInput({ deps }));
    expect(outcome).toMatchObject({ kind: "memory" });
  });

  it("maps a missing build report (legacy dist) to the missing-manifest outcome", async () => {
    const deps = fakeDeps({ readBuildReport: () => null });
    const outcome = await uploadWorkspaceBundle(baseInput({ deps }));
    expect(outcome.kind).toBe("missing-manifest");
  });

  it("maps an upload failure to the error outcome with the original message", async () => {
    const deps = fakeDeps({
      uploadWorkspaceDist: () => Promise.reject(new Error("storage 503")),
    });
    const outcome = await uploadWorkspaceBundle(baseInput({ deps }));
    expect(outcome).toMatchObject({ kind: "error", message: "storage 503" });
  });

  it("resolves the source archive when the source leg is enabled", async () => {
    const uploads: string[] = [];
    const deps = fakeDeps({
      uploadBundle: (input) => {
        uploads.push(input.workspace);
        return fakeDeps().uploadBundle();
      },
    });
    const outcome = await uploadWorkspaceBundle(
      baseInput({
        deps,
        source: { repoRoot: "/tmp", workspaceDir: "app" },
        gitSha: "abc123",
      }),
    );
    expect(outcome.kind).toBe("ok");
    expect(uploads).toEqual(["app", "app"]);
  });

  it("maps a memory-backend source archive to the abort outcome", async () => {
    const deps = fakeDeps({
      uploadBundle: (input) => {
        if (input.files[0]?.path.endsWith(".tar.gz")) {
          return Promise.resolve({ stored: 1, totalBytes: 1, integrity: {}, storage: "memory" });
        }
        return fakeDeps().uploadBundle();
      },
    });
    const outcome = await uploadWorkspaceBundle(
      baseInput({ deps, source: { repoRoot: "/tmp", workspaceDir: "app" } }),
    );
    expect(outcome).toMatchObject({ kind: "memory" });
  });
});
