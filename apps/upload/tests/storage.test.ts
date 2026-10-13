import { describe, expect, it } from "vitest";
import {
  computeObjectIntegrity,
  createStorageLayerFromEnv,
  MemoryStorageClient,
  parseListObjectsV2,
  resolveStorageConfigFromEnv,
  STORAGE_LIST_MAX_KEYS,
} from "../src/storage";

describe("upload storage", () => {
  it("reads a complete storage config from env", () => {
    const config = resolveStorageConfigFromEnv({
      BOS_STORAGE_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      BOS_STORAGE_BUCKET: "upload-bundles",
      BOS_STORAGE_ACCESS_KEY_ID: "access-key",
      BOS_STORAGE_SECRET_ACCESS_KEY: "secret-key",
      BOS_STORAGE_REGION: "auto",
    });

    expect(config).toEqual({
      endpoint: "https://example.r2.cloudflarestorage.com",
      bucket: "upload-bundles",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      region: "auto",
    });
  });

  it("returns null when production storage config is missing", () => {
    expect(resolveStorageConfigFromEnv({})).toBeNull();
    expect(createStorageLayerFromEnv({}, { allowMemory: false })).toBeNull();
  });

  it("persists SRI metadata so byte-identical re-uploads are recognizable via stat", async () => {
    const storage = new MemoryStorageClient();
    const bytes = new TextEncoder().encode("entry-bytes");
    await storage.put({
      key: "bundles/a.test/gw.test/ui/remoteEntry.js",
      bytes,
      contentType: "text/javascript",
      cacheControl: "public, max-age=0, must-revalidate",
      sri: computeObjectIntegrity(bytes),
    });

    const meta = await storage.stat("bundles/a.test/gw.test/ui/remoteEntry.js");
    expect(meta?.sri).toBe(computeObjectIntegrity(bytes));
    expect(meta?.size).toBe(bytes.byteLength);
  });

  it("lists keys under a prefix with pagination parity between adapters", async () => {
    const storage = new MemoryStorageClient();
    for (const path of [
      "bundles/a.test/gw.test/ui/remoteEntry.js",
      "bundles/a.test/gw.test/ui/versions/0123456789abcdef.json",
      "bundles/a.test/gw.test/api/remoteEntry.server.js",
      "bundles/other.test/gw.test/ui/remoteEntry.js",
    ]) {
      await storage.put({
        key: path,
        bytes: new Uint8Array([1]),
        contentType: "text/javascript",
        cacheControl: "",
        sri: "sha384-x",
      });
    }

    const listing = await storage.list("bundles/a.test/gw.test/ui/");
    expect(listing.keys.map((entry) => entry.key)).toEqual([
      "bundles/a.test/gw.test/ui/remoteEntry.js",
      "bundles/a.test/gw.test/ui/versions/0123456789abcdef.json",
    ]);
    expect(listing.truncated).toBe(false);
  });

  it("reports truncation when the listing cap is exceeded", async () => {
    const storage = new MemoryStorageClient();
    const many = STORAGE_LIST_MAX_KEYS + 5;
    for (let i = 0; i < many; i++) {
      await storage.put({
        key: `bundles/a.test/gw.test/ui/file-${String(i).padStart(6, "0")}.js`,
        bytes: new Uint8Array([1]),
        contentType: "text/javascript",
        cacheControl: "",
      });
    }
    const listing = await storage.list("bundles/a.test/gw.test/ui/");
    expect(listing.keys).toHaveLength(STORAGE_LIST_MAX_KEYS);
    expect(listing.truncated).toBe(true);
  });

  it("parses ListObjectsV2 XML with entity-encoded keys and continuation tokens", () => {
    const parsed = parseListObjectsV2(
      `<?xml version="1.0" encoding="UTF-8"?>
       <ListBucketResult>
         <IsTruncated>true</IsTruncated>
         <NextContinuationToken>1ueGcxLPRx1Tr/XYexH</NextContinuationToken>
         <Contents><Key>bundles/a.test/gw.test/ui/remoteEntry&amp;x.js</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>&quot;etag-1&quot;</ETag><Size>128</Size></Contents>
         <Contents><Key>bundles/a.test/gw.test/ui/versions/0123456789abcdef.json</Key><LastModified>2026-01-02T00:00:00.000Z</LastModified><ETag>&quot;etag-2&quot;</ETag><Size>256</Size></Contents>
       </ListBucketResult>`,
    );

    expect(parsed.contents).toEqual([
      {
        key: "bundles/a.test/gw.test/ui/remoteEntry&x.js",
        size: 128,
        lastModified: "2026-01-01T00:00:00.000Z",
      },
      {
        key: "bundles/a.test/gw.test/ui/versions/0123456789abcdef.json",
        size: 256,
        lastModified: "2026-01-02T00:00:00.000Z",
      },
    ]);
    expect(parsed.nextContinuationToken).toBe("1ueGcxLPRx1Tr/XYexH");
  });
});
