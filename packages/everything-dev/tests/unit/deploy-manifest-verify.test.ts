import { describe, expect, it } from "vitest";
import {
  fetchVerifiedManifest,
  manifestDocumentUrl,
} from "../../src/services/deploy/manifest-verify";

const body = JSON.stringify({ entry: "ui/entry.abc.js" });
const sri = `sha384-${(await import("node:crypto")).createHash("sha384").update(body).digest("base64")}`;

describe("manifestDocumentUrl", () => {
  it("joins the slot base and the pin's manifest path, tolerating slash drift", () => {
    expect(manifestDocumentUrl("https://cdn/ui/", "versions/a.json")).toBe(
      "https://cdn/ui/versions/a.json",
    );
    expect(manifestDocumentUrl("https://cdn/ui", "/versions/a.json")).toBe(
      "https://cdn/ui/versions/a.json",
    );
  });
});

describe("fetchVerifiedManifest", () => {
  it("returns the text when the served bytes match the pinned SRI", async () => {
    const fetchImpl = (async () => new Response(body, { status: 200 })) as typeof fetch;
    const result = await fetchVerifiedManifest({
      base: "https://cdn/ui/",
      pin: { manifest: "versions/a.json", integrity: sri },
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe(body);
  });

  it("reports a non-ok status instead of throwing", async () => {
    const fetchImpl = (async () => new Response("gone", { status: 404 })) as typeof fetch;
    const result = await fetchVerifiedManifest({
      base: "https://cdn/ui/",
      pin: { manifest: "versions/a.json", integrity: sri },
      fetchImpl,
    });
    expect(result).toMatchObject({ ok: false, reason: "manifest fetch failed: 404" });
  });

  it("reports an SRI mismatch with expected and computed values", async () => {
    const fetchImpl = (async () => new Response("tampered", { status: 200 })) as typeof fetch;
    const result = await fetchVerifiedManifest({
      base: "https://cdn/ui/",
      pin: { manifest: "versions/a.json", integrity: sri },
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("integrity mismatch");
      expect(result.reason).toContain(sri);
    }
  });

  it("reports a fetch rejection (network down) instead of throwing", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const result = await fetchVerifiedManifest({
      base: "https://cdn/ui/",
      pin: { manifest: "versions/a.json", integrity: sri },
      fetchImpl,
    });
    expect(result).toMatchObject({ ok: false, reason: "manifest fetch failed: ECONNREFUSED" });
  });
});
