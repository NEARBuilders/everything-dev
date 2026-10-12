import { describe, expect, it } from "vitest";
import { createArtifactControlClient } from "../../src/artifact-control";

describe("artifact control client", () => {
  it("creates a session, transfers files, and finalizes the upload", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const client = createArtifactControlClient({
      origin: "https://everything.dev",
      apiKey: "edk_test",
      sessionIdFactory: () => "session-123",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      fetchImpl: (async (url: string | URL, init?: RequestInit) => {
        captured = { url: String(url), init: init ?? {} };
        return new Response(
          JSON.stringify({ stored: 1, totalBytes: 5, integrity: { "remoteEntry.js": "sha384-abc" }, storage: "memory" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    });

    const session = client.createUploadSession({
      account: "v1.citynode.near",
      gateway: "citynode.app",
      workspace: "ui",
      files: [{ path: "remoteEntry.js", contentBase64: Buffer.from("entry").toString("base64") }],
    });
    expect(session).toMatchObject({
      sessionId: "session-123",
      account: "v1.citynode.near",
      gateway: "citynode.app",
      workspace: "ui",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const transfer = await client.transfer(session);
    expect(captured?.url).toBe("https://everything.dev/api/storage/bundles");
    const headers = new Headers(captured?.init.headers);
    expect(headers.get("x-api-key")).toBe("edk_test");
    expect(headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(await new Response(captured!.init.body ?? null).text());
    expect(body.sessionId).toBe("session-123");
    expect(body.account).toBe("v1.citynode.near");
    expect(transfer.sessionId).toBe("session-123");

    const finalized = await client.finalize(session, transfer);
    expect(finalized).toMatchObject({
      sessionId: "session-123",
      stored: 1,
      totalBytes: 5,
      finalizedAt: "2026-01-01T00:00:00.000Z",
    });
  });
});
