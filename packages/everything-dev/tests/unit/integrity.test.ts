import { afterEach, describe, expect, it, vi } from "vitest";
import { computeSriHash, computeSriHashForUrl, verifySriForUrl } from "../../src/integrity";

describe("integrity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("computes integrity from a streamed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("hello world", {
          status: 200,
          headers: { "content-length": "11" },
        }),
      ),
    );

    await expect(computeSriHashForUrl("https://cdn.example.com/ui")).resolves.toBe(
      computeSriHash("hello world"),
    );
  });

  it("rejects responses whose declared size exceeds the limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("small", {
          status: 200,
          headers: { "content-length": "32" },
        }),
      ),
    );

    await expect(
      verifySriForUrl("https://cdn.example.com/ui", "sha384-test", { maxBytes: 8 }),
    ).rejects.toThrow("exceeds max size");
  });

  it("rejects streamed responses that grow beyond the limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("123456789", {
          status: 200,
        }),
      ),
    );

    await expect(
      computeSriHashForUrl("https://cdn.example.com/ui", { maxBytes: 8 }),
    ).resolves.toBeNull();
  });

  it("verifies integrity against an exact entry url when requested", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("router", {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const expected = computeSriHash("router");

    await expect(
      verifySriForUrl("https://cdn.example.com/remoteEntry.server.js", expected, {
        resolveEntryUrl: false,
      }),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example.com/remoteEntry.server.js");
  });
});
