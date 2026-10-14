import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPublishedConfigFromFastKv, parseFastKvConfigValue } from "../../src/fastkv";
import { clearHttpCache } from "../../src/http-client";

beforeEach(() => {
  clearHttpCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function entriesResponse(value: unknown) {
  return new Response(JSON.stringify({ entries: [{ value }] }), { status: 200 });
}

describe("fetchPublishedConfigFromFastKv", () => {
  it("reads the registry URL verbatim and unwraps the entry value", async () => {
    const fetchMock = vi.fn(async () =>
      entriesResponse({ account: "a.near", domain: "a.app", app: { ui: { pin: {} } } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const url =
      "https://kv.main.fastnear.com/v0/latest/dev.everything.near/a.near/apps%2Fa.near%2Fa.app%2Fbos.config.json";
    const config = await fetchPublishedConfigFromFastKv<Record<string, unknown>>(url);

    expect(fetchMock).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
    expect(config).toEqual({ account: "a.near", domain: "a.app", app: { ui: { pin: {} } } });
  });

  it("JSON-parses a string-valued entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => entriesResponse(JSON.stringify({ account: "a.near" }))),
    );

    const config = await fetchPublishedConfigFromFastKv<Record<string, unknown>>(
      "https://kv.main.fastnear.com/v0/latest/ns/a.near/key.json",
    );

    expect(config).toEqual({ account: "a.near" });
  });

  it("maps 404 to No config found (first-publish signal)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );

    await expect(
      fetchPublishedConfigFromFastKv("https://kv.main.fastnear.com/v0/latest/ns/a.near/key.json"),
    ).rejects.toThrow("No config found");
  });

  it("surfaces non-404 HTTP failures as unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );

    await expect(
      fetchPublishedConfigFromFastKv("https://kv.main.fastnear.com/v0/latest/ns/a.near/key.json"),
    ).rejects.toThrow("HTTP 503");
  });

  it("rejects on network failure instead of conflating with No config found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection reset");
      }),
    );

    await expect(
      fetchPublishedConfigFromFastKv("https://kv.main.fastnear.com/v0/latest/ns/a.near/key.json"),
    ).rejects.toThrow();
  });
});

describe("parseFastKvConfigValue", () => {
  it("throws No config found on a null payload", () => {
    expect(() => parseFastKvConfigValue(null, "label")).toThrow("No config found for label");
  });

  it("throws No config found on empty entries", () => {
    expect(() => parseFastKvConfigValue({ entries: [] }, "label")).toThrow(
      "No config found for label",
    );
  });

  it("throws Invalid config value on a scalar value", () => {
    expect(() => parseFastKvConfigValue({ entries: [{ value: 42 }] }, "label")).toThrow(
      "Invalid config value for label",
    );
  });
});
