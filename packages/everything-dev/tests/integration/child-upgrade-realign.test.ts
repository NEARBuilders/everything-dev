/**
 * Child upgrade realignment e2e — recreates the opencrosspost rc.30 failure
 * end to end, no real network:
 *
 *   C1: a platform-pinned child declaring its own (subset) plugins domain —
 *   wholesale replace — composing a coherent plane. Before the fixes, this
 *   produced "this runtime composes react@unknown" false divergences (the
 *   probe read the legacy package.json catalog and the root node_modules
 *   misses under the isolated linker) and "run bos upgrade to inherit" lines
 *   upgrade can never clear. Asserts the honest output: zero divergence
 *   lines for coherent pins, uncomposed notes for the subset remotes.
 *
 *   C2: the same child with a stale catalog entry — the owned remote
 *   diverges, and detection names the publish key the scoped train takes.
 *
 *   R: the realignment leg — `realignOwnedRemotes` without a stored session
 *   skips with the hand-repair instruction instead of hanging or failing.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeManifestSri } from "../../src/services/deploy/manifest-verify";
import type { Manifest } from "../../src/services/platform/manifest";
import { auditSessionComposition } from "../../src/services/resolution/composition-audit";
import { ResolutionSession } from "../../src/services/resolution/session";
import {
  detectOwnedDivergentKeys,
  realignOwnedRemotes,
} from "../../src/services/scaffold/upgrade-realign";

const tempDirs: string[] = [];
let server: Server;
let serverUrl = "";

const manifestBody = (shared: Record<string, string>): string =>
  JSON.stringify({
    version: "0123456789abcdef",
    entry: "remoteEntry.js",
    entryIntegrity: "sha384-AAAAAA==",
    shared,
  });

/** The release built every remote against this chain. */
const BUILT_SHARED = { react: "19.3.1", "@orpc/client": "2.0.0-beta.45" };
const sriOf = (shared: Record<string, string>): string => computeManifestSri(manifestBody(shared));

const tempChild = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), "child-realign-"));
  tempDirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const filePath = join(dir, path);
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, content);
  }
  return dir;
};

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(manifestBody(BUILT_SHARED));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address && typeof address === "object") serverUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** The opencrosspost-shaped pinned child: catalog in pnpm-workspace.yaml, no
 * root node_modules for the shared singletons, own plugins domain. */
const buildChildSession = (catalog: Record<string, string>): ResolutionSession => {
  const frameworkVersion = "2.0.0-rc.30";
  const dir = tempChild({
    "package.json": "{}\n",
    "pnpm-workspace.yaml": [
      "packages:",
      "  - ui",
      "  - api",
      "  - plugins/*",
      "catalog:",
      ...Object.entries(catalog).map(([name, version]) => `  "${name}": "${version}"`),
      "",
    ].join("\n"),
  });
  const remote = (path: string) => ({
    base: `${serverUrl}/${path}`,
    digest: { manifest: `${serverUrl}/${path}/mf-manifest.json`, integrity: sriOf(BUILT_SHARED) },
  });
  const manifest = {
    schemaVersion: 1,
    kind: "everything-dev/platform-manifest",
    frameworkVersion,
    everyPluginVersion: "3.0.0-rc.15",
    image: { ref: "ghcr.io/test/runtime", tags: [`v${frameworkVersion}`] },
    catalog: { react: "19.3.1" },
    sharedDeps: {},
    templateInventory: [],
    compat: { minChild: "2.0.0-rc.26" },
    remotes: {
      "app.ui": remote("app.ui"),
      "app.api": remote("app.api"),
      "app.auth": remote("app.auth"),
      "app.auth.ui": remote("app.auth.ui"),
      "plugins.ai": remote("plugins.ai"),
      "plugins.registry": remote("plugins.registry"),
      "plugins.proposals": remote("plugins.proposals"),
      "plugins.votes": remote("plugins.votes"),
      "plugins.template": remote("plugins.template"),
    },
  } as unknown as Manifest;
  const rawConfig = {
    extends: "bos://parent/gateway",
    release: frameworkVersion,
    app: { ui: { development: "local:ui" }, api: { development: "local:api" } },
    plugins: {
      auth: { development: "local:plugins/auth" },
      connectors: { development: "local:plugins/connectors" },
      twitter: { development: "local:plugins/twitter" },
    },
  };
  const config = {
    ...rawConfig,
    app: {
      ...rawConfig.app,
      // Owned remotes carry their own published production + pin (merged from
      // the child's published config state) — what collectRemoteDescriptors reads.
      ui: {
        ...rawConfig.app.ui,
        production: `${serverUrl}/app.ui`,
        digest: {
          manifest: `${serverUrl}/app.ui/mf-manifest.json`,
          integrity: sriOf(BUILT_SHARED),
        },
      },
      api: {
        ...rawConfig.app.api,
        production: `${serverUrl}/app.api`,
        digest: {
          manifest: `${serverUrl}/app.api/mf-manifest.json`,
          integrity: sriOf(BUILT_SHARED),
        },
      },
      auth: { name: "auth" },
    },
  };
  return new ResolutionSession({
    config,
    runtime: {} as never,
    root: dir,
    path: null,
    chain: ["bos://parent/gateway"],
    rawConfig,
    catalog: { ...catalog },
    repository: undefined,
    releaseManifest: manifest,
    releaseComposition: {
      stamped: ["app.auth", "app.auth.ui"],
      omitted: [
        "plugins.ai",
        "plugins.registry",
        "plugins.proposals",
        "plugins.votes",
        "plugins.template",
      ],
    },
    env: "development",
    warnings: [],
  });
};

describe("child upgrade realignment — the opencrosspost regression", () => {
  it("a coherent pinned subset child audits clean: uncomposed notes only, no upgrade advice", async () => {
    const session = buildChildSession({ react: "19.3.1", "@orpc/client": "2.0.0-beta.45" });
    const lines = await auditSessionComposition(session);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.kind === "uncomposed")).toBe(true);
    expect(lines.some((line) => line.message.includes("unknown"))).toBe(false);
    expect(lines.some((line) => line.message.includes("bos upgrade"))).toBe(false);
    expect(lines.some((line) => line.message.includes("plugins.ai"))).toBe(true);
  });

  it("an owned remote diverging on a strict singleton is detected with its publish key", async () => {
    const session = buildChildSession({ react: "19.2.0", "@orpc/client": "2.0.0-beta.45" });
    const { keys, lines } = await detectOwnedDivergentKeys(session);
    // Both owned remotes embed react in their shared set — both diverge.
    expect(keys).toEqual(["api", "ui"]);
    const owned = lines.filter((line) => line.kind === "owned");
    expect(
      owned.some((line) => line.remote === "app.ui" && line.message.includes("--packages ui")),
    ).toBe(true);
    expect(
      owned.some((line) => line.remote === "app.api" && line.message.includes("--packages api")),
    ).toBe(true);
  });

  it("realignOwnedRemotes without a stored session skips with the hand-repair instruction", async () => {
    const session = buildChildSession({ react: "19.2.0" });
    const logs: string[] = [];
    const outcome = await realignOwnedRemotes(session.root, ["ui"], (message) =>
      logs.push(message),
    );
    expect(outcome).toEqual({ keys: ["ui"], realigned: [], failures: [] });
    expect(logs.join("\n")).toContain("bos deploy --packages ui");
  });
});
