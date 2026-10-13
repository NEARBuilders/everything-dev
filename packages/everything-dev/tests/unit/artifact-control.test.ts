import { createUploadClient } from "@everything-dev/upload-app/client";
import { describe, expect, it } from "vitest";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("upload client", () => {
  it("uploads bundle files and reports server-side unchanged skips", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const client = createUploadClient({
      origin: "https://upload.everything.dev",
      apiKey: "edk_test",
      fetchImpl: (async (url: string | URL, init?: RequestInit) => {
        captured = { url: String(url), init: init ?? {} };
        return jsonResponse({
          stored: 0,
          unchanged: 1,
          totalBytes: 5,
          integrity: { "remoteEntry.js": "sha384-abc" },
          storage: "memory",
        });
      }) as typeof fetch,
    });

    const result = await client.uploadBundle({
      account: "v1.citynode.near",
      gateway: "citynode.app",
      workspace: "ui",
      files: [{ path: "remoteEntry.js", contentBase64: Buffer.from("entry").toString("base64") }],
    });

    expect(captured?.url).toBe("https://upload.everything.dev/api/storage/bundles");
    const headers = new Headers(captured?.init.headers);
    expect(headers.get("x-api-key")).toBe("edk_test");
    expect(headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(await new Response(captured!.init.body ?? null).text());
    expect(body.account).toBe("v1.citynode.near");
    expect(result).toMatchObject({ stored: 0, unchanged: 1, totalBytes: 5 });
  });

  it("lists bundles and versions and fetches integrity reports over query params", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createUploadClient({
      origin: "https://upload.everything.dev",
      apiKey: "edk_read",
      fetchImpl: (async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        const path = String(url);
        if (path.includes("/api/storage/bundles?")) {
          return jsonResponse({
            storage: "s3",
            prefix: "bundles/a.test/gw.test/ui/",
            objects: [
              {
                key: "bundles/a.test/gw.test/ui/remoteEntry.js",
                size: 10,
                lastModified: "2026-01-01T00:00:00Z",
              },
            ],
            truncated: false,
          });
        }
        if (path.includes("/api/storage/versions?")) {
          return jsonResponse({
            storage: "s3",
            versions: [
              {
                version: "0123456789abcdef",
                entry: "remoteEntry.abcdef12.js",
                entryIntegrity: "sha384-xyz",
                fileCount: 3,
                lastModified: "2026-01-01T00:00:00Z",
              },
            ],
            truncated: false,
          });
        }
        return jsonResponse({
          storage: "s3",
          manifest: {
            version: "0123456789abcdef",
            entry: "remoteEntry.abcdef12.js",
            entryIntegrity: "sha384-xyz",
          },
          entryVerified: true,
        });
      }) as typeof fetch,
    });

    const bundles = await client.listBundles({
      account: "a.test",
      gateway: "gw.test",
      workspace: "ui",
    });
    expect(calls[0]?.url).toBe(
      "https://upload.everything.dev/api/storage/bundles?account=a.test&gateway=gw.test&workspace=ui",
    );
    expect(bundles.objects).toHaveLength(1);
    expect(bundles.truncated).toBe(false);

    const versions = await client.listVersions({
      account: "a.test",
      gateway: "gw.test",
      workspace: "ui",
    });
    expect(versions.versions[0]).toMatchObject({ version: "0123456789abcdef", fileCount: 3 });

    const report = await client.integrityReport({
      account: "a.test",
      gateway: "gw.test",
      workspace: "ui",
      version: "0123456789abcdef",
    });
    expect(report.entryVerified).toBe(true);
    expect(report.manifest.entry).toBe("remoteEntry.abcdef12.js");
  });
});
