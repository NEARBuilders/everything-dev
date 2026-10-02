import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadBundle } from "../../src/storage-upload";

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const baseInput = {
  origin: "https://citynode.app",
  apiKey: "edk",
  account: "a.near",
  gateway: "g.app",
  workspace: "ui",
  files: [{ path: "remoteEntry.8f3a.js", bytes: new Uint8Array([1, 2, 3]) }],
};

afterEach(() => {
  vi.useRealTimers();
});

describe("uploadBundle transport hardening", () => {
  it("retries a transport error on a fresh connection and succeeds", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("The socket connection was closed unexpectedly"))
      .mockResolvedValueOnce(
        okResponse({ stored: 1, totalBytes: 3, integrity: {}, storage: "s3" }),
      );

    const result = await uploadBundle({ ...baseInput, fetchImpl });

    expect(result.stored).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // the retry must not reuse the pooled keepalive socket that died
    expect((fetchImpl.mock.calls[1]![1] as RequestInit).headers).toMatchObject({
      connection: "close",
    });
  });

  it("gives up after five transport attempts with the last socket error", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("The socket connection was closed unexpectedly"));

    await expect(uploadBundle({ ...baseInput, fetchImpl })).rejects.toThrow(
      /socket connection was closed/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("does not retry a non-retryable status", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"error":"forbidden"}', { status: 403 }));

    await expect(uploadBundle({ ...baseInput, fetchImpl })).rejects.toThrow(/403/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caps retryable status errors at three attempts", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"error":"unavailable"}', { status: 503 }));

    await expect(uploadBundle({ ...baseInput, fetchImpl })).rejects.toThrow(/503/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
