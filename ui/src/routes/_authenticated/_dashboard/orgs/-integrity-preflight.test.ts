import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyTenantConfigDraft } from "@/app";
import { runIntegrityPreflight } from "./-integrity-preflight";

const HELLO_SHA384 = "sha384-WeF0h3dEjGnea4ANejO7+5/xtGPkQ1TDVTvNucZm+pASWjx5+QOXvfX2oT3oKGhP";

function stubBundle(body: string) {
  const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runIntegrityPreflight", () => {
  it("passes without fetching when no bundle is configured", async () => {
    const fetchMock = stubBundle("hello");

    const result = await runIntegrityPreflight({ ...emptyTenantConfigDraft, title: "Chicago" });

    expect(result).toEqual({ status: "ok" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes when the UI bundle hashes to the declared integrity", async () => {
    const fetchMock = stubBundle("hello");

    const result = await runIntegrityPreflight({
      ...emptyTenantConfigDraft,
      uiProduction: "https://cdn.example.com/bundles/chi/",
      uiIntegrity: HELLO_SHA384,
    });

    expect(result).toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example.com/bundles/chi/remoteEntry.js", {
      cache: "no-store",
    });
  });

  it("reports a mismatch with the computed hash", async () => {
    stubBundle("hello");

    const result = await runIntegrityPreflight({
      ...emptyTenantConfigDraft,
      uiProduction: "https://cdn.example.com/bundles/chi/",
      uiIntegrity: "sha384-AAAA",
    });

    expect(result).toEqual({
      status: "mismatch",
      message: `UI integrity mismatch — the bundle hashes to ${HELLO_SHA384}`,
    });
  });

  it("checks the SSR bundle against remoteEntry.server.js", async () => {
    const fetchMock = stubBundle("hello");

    const result = await runIntegrityPreflight({
      ...emptyTenantConfigDraft,
      ssrUrl: "https://cdn.example.com/bundles/chi/ssr",
      ssrIntegrity: "sha384-AAAA",
    });

    expect(result).toEqual({
      status: "mismatch",
      message: `SSR integrity mismatch — the bundle hashes to ${HELLO_SHA384}`,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cdn.example.com/bundles/chi/ssr/remoteEntry.server.js",
      { cache: "no-store" },
    );
  });

  it("reports unverified when the bundle cannot be fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const result = await runIntegrityPreflight({
      ...emptyTenantConfigDraft,
      uiProduction: "https://cdn.example.com/bundles/chi/",
      uiIntegrity: HELLO_SHA384,
    });

    expect(result).toEqual({
      status: "unverified",
      message: "Couldn't fetch the UI bundle to verify it (network down).",
    });
  });
});
