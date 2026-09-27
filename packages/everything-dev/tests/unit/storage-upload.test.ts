import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { collectDistFiles, uploadBundle, uploadWorkspaceDist } from "../../src/storage-upload";

describe("collectDistFiles", () => {
  const root = mkdtempSync(join(tmpdir(), "storage-upload-"));
  const dist = join(root, "dist");

  beforeAll(() => {
    mkdirSync(join(dist, "static", "js", "async"), { recursive: true });
    writeFileSync(join(dist, "remoteEntry.js"), "entry");
    writeFileSync(join(dist, "mf-manifest.json"), "{}");
    writeFileSync(join(dist, "static", "js", "async", "chunk.1234abcd5678ef90.js"), "chunk");
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("walks the dist recursively with deterministic, slash-normalized paths", async () => {
    const files = await collectDistFiles(dist);
    expect(files.map((f) => f.path)).toEqual([
      "mf-manifest.json",
      "remoteEntry.js",
      "static/js/async/chunk.1234abcd5678ef90.js",
    ]);
    expect(files.find((f) => f.path === "remoteEntry.js")!.bytes).toEqual(
      new TextEncoder().encode("entry"),
    );
  });

  it("throws for a missing dist directory", async () => {
    await expect(collectDistFiles(join(root, "missing"))).rejects.toThrow();
  });
});

describe("uploadBundle", () => {
  const originalFetch = globalThis.fetch;

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts the namespace, files, and api key; returns integrity", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} };
      return new Response(
        JSON.stringify({ stored: 1, totalBytes: 5, integrity: { "remoteEntry.js": "sha384-abc" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await uploadBundle({
      origin: "https://everything.dev",
      apiKey: "edk_test",
      account: "v1.citynode.near",
      gateway: "citynode.app",
      workspace: "ui",
      files: [{ path: "remoteEntry.js", bytes: new TextEncoder().encode("entry") }],
    });

    expect(captured!.url).toBe("https://everything.dev/api/storage/bundles");
    const headers = new Headers(captured!.init.headers);
    expect(headers.get("x-api-key")).toBe("edk_test");
    expect(headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(String(captured!.init.body));
    expect(body.account).toBe("v1.citynode.near");
    expect(body.files[0].contentBase64).toBe(Buffer.from("entry").toString("base64"));
    expect(result.integrity["remoteEntry.js"]).toBe("sha384-abc");
  });

  it("throws with the response status when the upload fails", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 403 })) as typeof fetch;
    await expect(
      uploadBundle({
        origin: "https://everything.dev",
        account: "v1.citynode.near",
        gateway: "citynode.app",
        workspace: "ui",
        files: [{ path: "remoteEntry.js", bytes: new Uint8Array(1) }],
      }),
    ).rejects.toThrow("403");
  });
});

describe("uploadWorkspaceDist", () => {
  const originalFetch = globalThis.fetch;

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("batches files across requests under the per-request ceiling and merges integrity", async () => {
    const calls: number[][] = [];
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      calls.push(body.files.map((f: { path: string }) => f.path.length));
      return new Response(
        JSON.stringify({
          stored: body.files.length,
          totalBytes: 0,
          integrity: Object.fromEntries(
            body.files.map((f: { path: string }) => [f.path, `sha384-${f.path}`]),
          ),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await uploadWorkspaceDist({
      origin: "https://everything.dev",
      account: "a.near",
      gateway: "app.dev",
      workspace: "ui",
      files: [
        { path: "a.js", bytes: new Uint8Array(30) },
        { path: "b.js", bytes: new Uint8Array(30) },
        { path: "c.js", bytes: new Uint8Array(30) },
      ],
      maxRequestBytes: 200,
    });

    expect(calls.length).toBe(3);
    expect(result.stored).toBe(3);
    expect(result.integrity["c.js"]).toBe("sha384-c.js");
  });

  it("throws when a single file exceeds the per-request ceiling", async () => {
    await expect(
      uploadWorkspaceDist({
        origin: "https://everything.dev",
        account: "a.near",
        gateway: "app.dev",
        workspace: "ui",
        files: [{ path: "huge.js", bytes: new Uint8Array(200) }],
        maxRequestBytes: 100,
      }),
    ).rejects.toThrow("exceeds");
  });
});
