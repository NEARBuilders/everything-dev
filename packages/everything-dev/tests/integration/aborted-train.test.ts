import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BosConfig } from "../../src/types";

const { fetchBosConfigFromFastKvMock, resolveSigningStrategyMock, submitRegistryWriteMock } =
  vi.hoisted(() => ({
    fetchBosConfigFromFastKvMock: vi.fn(),
    resolveSigningStrategyMock: vi.fn(),
    submitRegistryWriteMock: vi.fn(),
  }));

vi.mock("../../src/fastkv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/fastkv")>();
  return { ...actual, fetchBosConfigFromFastKv: fetchBosConfigFromFastKvMock };
});

vi.mock("../../src/near-signer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/near-signer")>();
  return {
    ...actual,
    resolveSigningStrategy: resolveSigningStrategyMock,
    submitRegistryWrite: submitRegistryWriteMock,
  };
});

vi.mock("../../src/code-artifacts", () => ({ generateCodeArtifacts: vi.fn() }));
vi.mock("../../src/build", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/build")>();
  return {
    ...actual,
    buildWorkspaceTargets: vi.fn().mockResolvedValue({
      built: ["ui"],
      skipped: [],
      deployResults: [{ key: "ui", kind: "app", success: true }],
    }),
  };
});
vi.mock("../../src/resolution/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/resolution/session")>();
  return { ...actual, openResolution: vi.fn() };
});

import { publishToFastKv } from "../../src/publish";
import { openResolution } from "../../src/resolution/session";

const sriOf = (content: Buffer | string) =>
  `sha384-${createHash("sha384").update(content).digest("base64")}`;

/** Mock storage origin: the /api/storage/bundles route contract (server-computed SRI) + GET serving + mcp probe + failure injection. */
class MockStorage {
  readonly objects = new Map<string, { bytes: Buffer; sri: string }>();
  private failBatches = 0;
  private killSockets = false;
  private readonly server: Server;
  readonly ready: Promise<void>;
  origin = "";

  constructor() {
    this.server = createServer((req, res) => this.handle(req, res));
    this.ready = new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.origin = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
        resolve();
      });
    });
  }

  /** Fail the next N upload batch requests with a 500 (the train-killing injection). */
  injectFailures(count: number) {
    this.failBatches = count;
  }

  /** Kill the socket mid-request (the 2026-09-30 transport-failure mode). */
  injectSocketKills() {
    this.killSockets = true;
  }

  key(account: string, gateway: string, workspace: string, path: string) {
    return `${account}/${gateway}/${workspace}/${path}`;
  }

  get(account: string, gateway: string, workspace: string, path: string) {
    return this.objects.get(this.key(account, gateway, workspace, path)) ?? null;
  }

  async fetch(account: string, gateway: string, workspace: string, path: string) {
    const response = await fetch(
      `${this.origin}/bundles/${account}/${gateway}/${workspace}/${path}`,
    );
    return response.ok ? await response.text() : null;
  }

  private handle(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) {
    const url = req.url ?? "";
    if (this.killSockets && req.method === "POST") {
      req.socket.destroy();
      return;
    }
    if (req.method === "GET" && url === "/.well-known/mcp.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ mcp: { endpoint: "/api/mcp" } }));
      return;
    }
    if (req.method === "GET" && url.startsWith("/bundles/")) {
      const object = [...this.objects.entries()].find(([key]) => url.includes(key));
      if (object) {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(object[1].bytes);
        return;
      }
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.method === "POST" && url === "/api/storage/bundles") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        if (this.failBatches > 0) {
          this.failBatches -= 1;
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "injected storage failure" }));
          return;
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          account: string;
          gateway: string;
          workspace: string;
          files: Array<{ path: string; contentBase64: string }>;
        };
        const integrity: Record<string, string> = {};
        let totalBytes = 0;
        for (const file of body.files) {
          const bytes = Buffer.from(file.contentBase64, "base64");
          const sri = sriOf(bytes);
          this.objects.set(this.key(body.account, body.gateway, body.workspace, file.path), {
            bytes,
            sri,
          });
          integrity[file.path] = sri;
          totalBytes += bytes.byteLength;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ stored: body.files.length, totalBytes, integrity, storage: "s3" }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  }

  close() {
    this.server.close();
  }
}

const bosConfig = {
  account: "v1.citynode.near",
  domain: "citynode.app",
  cdn: { origin: "https://cdn.example.test" },
  app: {
    host: { development: "local:host", production: "https://cdn.example.test/host/" },
    ui: { development: "local:ui", production: "https://cdn.example.test/ui/" },
    api: { development: "local:api", production: "https://cdn.example.test/api/" },
  },
} as unknown as BosConfig;

/** A fixture ui dist: hashed entry + legacy alias + hashed browser manifest + build report. */
function writeDist(distRoot: string, version: "v1" | "v2") {
  const entryContent = `console.log("${version} entry");`;
  const entryHash = createHash("sha256").update(entryContent).digest("hex").slice(0, 16);
  const entryName = `remoteEntry.${entryHash}.js`;
  const manifestDoc = JSON.stringify({ metaData: { publicPath: "auto" }, version });
  const manifestHash = createHash("sha256").update(manifestDoc).digest("hex").slice(0, 16);
  const manifestName = `mf-manifest.${manifestHash}.json`;

  writeFileSync(join(distRoot, entryName), entryContent);
  writeFileSync(join(distRoot, "remoteEntry.js"), entryContent);
  writeFileSync(join(distRoot, manifestName), manifestDoc);
  writeFileSync(join(distRoot, "mf-manifest.json"), manifestDoc);
  writeFileSync(
    join(distRoot, "build-report.json"),
    `${JSON.stringify({ entry: entryName, browserManifest: manifestName }, null, 2)}\n`,
  );
  return { entryName, manifestName, entryContent, manifestDoc };
}

describe("an aborted deploy train is a no-op (ticket 05)", () => {
  let storage: MockStorage;
  let configDir: string;
  let savedEnv: Record<string, string | undefined>;
  let publishedPayloads: Array<Record<string, unknown>>;

  beforeEach(async () => {
    storage = new MockStorage();
    await storage.ready;
    configDir = mkdtempSync(join(tmpdir(), "bos-aborted-train-"));
    savedEnv = {
      BOS_BUNDLE_CDN_ORIGIN: process.env.BOS_BUNDLE_CDN_ORIGIN,
      BOS_STORAGE_ORIGIN: process.env.BOS_STORAGE_ORIGIN,
      BOS_STORAGE_API_KEY: process.env.BOS_STORAGE_API_KEY,
    };
    process.env.BOS_BUNDLE_CDN_ORIGIN = "https://cdn.example.test";
    process.env.BOS_STORAGE_ORIGIN = storage.origin;
    process.env.BOS_STORAGE_API_KEY = "edk_test";

    mkdirSync(join(configDir, "host"), { recursive: true });
    mkdirSync(join(configDir, "api"), { recursive: true });
    mkdirSync(join(configDir, "ui", "dist"), { recursive: true });
    writeFileSync(join(configDir, "bos.config.json"), JSON.stringify(bosConfig, null, 2));

    resolveSigningStrategyMock.mockResolvedValue({
      strategy: "near-kit",
      privateKey: "ed25519:test",
      source: "provided",
    });
    vi.mocked(openResolution).mockResolvedValue({ config: bosConfig } as never);
    submitRegistryWriteMock.mockImplementation(async (tx: { args: Record<string, string> }) => {
      publishedPayloads.push(JSON.parse(Object.values(tx.args)[0]!));
      return { success: true, txHash: "tx_test" };
    });
    fetchBosConfigFromFastKvMock.mockImplementation(async () => {
      const last = publishedPayloads[publishedPayloads.length - 1];
      return last ? JSON.parse(JSON.stringify(last)) : Promise.reject(new Error("No config found"));
    });

    publishedPayloads = [];
  });

  afterEach(() => {
    storage.close();
    rmSync(configDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const runDeploy = () =>
    publishToFastKv({
      bosConfig,
      runtimeConfig: null,
      configDir,
      env: "production",
      build: true,
      dryRun: false,
      verbose: false,
      packages: "all",
      network: "mainnet",
      privateKey: "ed25519:test",
    });

  it("v1 deploys, pins its version manifest, and stores its bytes", async () => {
    const dist = join(configDir, "ui", "dist");
    writeDist(dist, "v1");

    const result = await runDeploy();

    expect(result.status).toBe("published");
    expect(publishedPayloads).toHaveLength(1);
    const ui = (publishedPayloads[0] as { app: { ui: Record<string, string> } }).app.ui;
    expect(ui.pin.manifest).toMatch(/^versions\/[0-9a-f]{16}\.json$/);

    const stored = storage.get("v1.citynode.near", "citynode.app", "ui", ui.pin.manifest);
    expect(stored).not.toBeNull();
    expect(stored!.sri).toBe(ui.pin.integrity);
  });

  it("an aborted v2 train leaves v1's pointer, bytes, and SRI fully live", async () => {
    const dist = join(configDir, "ui", "dist");
    writeDist(dist, "v1");
    await runDeploy();
    const v1Ui = (publishedPayloads[0] as { app: { ui: Record<string, string> } }).app.ui;
    const v1EntryPath = JSON.parse(
      storage
        .get("v1.citynode.near", "citynode.app", "ui", v1Ui.pin.manifest)!
        .bytes.toString("utf8"),
    ) as { entry: string };

    // v2: different bytes → different hashes → a different version id
    writeDist(dist, "v2");
    storage.injectFailures(10); // every batch 500s — the train dies mid-flight
    const result = await runDeploy();

    expect(result.status).toBe("error");
    // the published pointer is untouched
    expect(publishedPayloads).toHaveLength(1);
    // v1's pinned bytes are byte-identical and SRI-verified on the storage
    const v1Entry = storage.get("v1.citynode.near", "citynode.app", "ui", v1EntryPath.entry);
    expect(v1Entry!.bytes.toString("utf8")).toBe('console.log("v1 entry");');
    expect(v1Entry!.sri).toBe(sriOf(v1Entry!.bytes));
    const v1Manifest = storage.get("v1.citynode.near", "citynode.app", "ui", v1Ui.pin.manifest);
    expect(v1Manifest!.sri).toBe(v1Ui.pin.integrity);
  });

  it("a socket-kill v2 train (the 2026-09-30 transport failure) also leaves v1 fully live", async () => {
    const dist = join(configDir, "ui", "dist");
    writeDist(dist, "v1");
    await runDeploy();
    const v1Ui = (publishedPayloads[0] as { app: { ui: Record<string, string> } }).app.ui;
    const v1EntryName = JSON.parse(
      storage
        .get("v1.citynode.near", "citynode.app", "ui", v1Ui.pin.manifest)!
        .bytes.toString("utf8"),
    ).entry as string;

    writeDist(dist, "v2");
    storage.injectSocketKills();
    const result = await runDeploy();

    expect(result.status).toBe("error");
    expect(result.error).toContain("fetch failed");
    expect(publishedPayloads).toHaveLength(1);
    // GET serving: v1's pinned entry + manifest still serve their exact bytes
    const servedEntry = await storage.fetch("v1.citynode.near", "citynode.app", "ui", v1EntryName);
    expect(servedEntry).toBe('console.log("v1 entry");');
    const servedManifest = await storage.fetch(
      "v1.citynode.near",
      "citynode.app",
      "ui",
      v1Ui.pin.manifest,
    );
    expect(servedManifest).not.toBeNull();
    expect(storage.get("v1.citynode.near", "citynode.app", "ui", v1Ui.pin.manifest)!.sri).toBe(
      v1Ui.pin.integrity,
    );
  });

  it("a completed v2 train switches the pointer atomically; v1 bytes stay servable", async () => {
    const dist = join(configDir, "ui", "dist");
    const v1 = writeDist(dist, "v1");
    await runDeploy();
    const v1Ui = (publishedPayloads[0] as { app: { ui: Record<string, string> } }).app.ui;
    const v1EntryName = JSON.parse(
      storage
        .get("v1.citynode.near", "citynode.app", "ui", v1Ui.pin.manifest)!
        .bytes.toString("utf8"),
    ).entry as string;

    writeDist(dist, "v2");
    const result = await runDeploy();

    expect(result.status).toBe("published");
    expect(publishedPayloads).toHaveLength(2);
    const v2Ui = (publishedPayloads[1] as { app: { ui: Record<string, string> } }).app.ui;
    expect(v2Ui.pin.manifest).not.toBe(v1Ui.pin.manifest);

    // retention: v1's hashed entry + version manifest are still exactly v1's bytes
    const v1Entry = storage.get("v1.citynode.near", "citynode.app", "ui", v1EntryName);
    expect(v1Entry!.bytes.toString("utf8")).toBe(v1.entryContent);
    const v1Manifest = storage.get("v1.citynode.near", "citynode.app", "ui", v1Ui.pin.manifest);
    expect(v1Manifest!.bytes.toString("utf8")).toContain("mf-manifest");
    expect(v1Manifest!.sri).toBe(v1Ui.pin.integrity);
  });
});
