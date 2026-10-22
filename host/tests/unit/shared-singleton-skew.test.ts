import { describe, expect, it } from "vitest";
import type { PluginManifest } from "everything-dev/ui/manifest";
import type { UiSource } from "../../src/services/ui-compose";
import { sharedSingletonSkew, SharedSingletonSkewError } from "../../src/services/ui-compose";

function source(key: string, shared?: Record<string, string>): UiSource {
  return {
    key,
    mfName: key,
    manifestUrl: `https://cdn.example.com/${key}/manifest.json`,
    ...(shared ? { sharedVersions: shared } : {}),
  } as UiSource;
}

function manifestOf(name: string): PluginManifest {
  return { name } as unknown as PluginManifest;
}

describe("sharedSingletonSkew", () => {
  it("accepts a composition whose sources agree on every named singleton", () => {
    expect(
      sharedSingletonSkew([
        {
          source: source("ui", { react: "19.2.9", "react-dom": "19.2.9" }),
          manifest: manifestOf("ui"),
        },
        { source: source("votes", { react: "19.2.9" }), manifest: manifestOf("votes") },
      ]),
    ).toBeNull();
  });

  it("flags a singleton named at two versions across sources — the #546 shape", () => {
    const skew = sharedSingletonSkew([
      { source: source("ui", { react: "19.2.9" }), manifest: manifestOf("ui") },
      { source: source("votes", { react: "19.2.4" }), manifest: manifestOf("votes") },
    ]);
    expect(skew).toBeInstanceOf(SharedSingletonSkewError);
    expect(skew?.name).toBe("react");
    expect(skew?.message).toContain('"ui" was built against 19.2.9');
    expect(skew?.message).toContain('"votes" against 19.2.4');
  });

  it("skips sources without a shared record (local dev, builds predating the field)", () => {
    expect(
      sharedSingletonSkew([
        { source: source("ui", { react: "19.2.9" }), manifest: manifestOf("ui") },
        { source: source("votes"), manifest: manifestOf("votes") },
      ]),
    ).toBeNull();
  });

  it("compares a dep named by three sources and names the divergent pair", () => {
    const skew = sharedSingletonSkew([
      { source: source("ui", { react: "19.2.9" }), manifest: manifestOf("ui") },
      { source: source("a", { react: "19.2.9" }), manifest: manifestOf("a") },
      { source: source("b", { react: "19.2.4" }), manifest: manifestOf("b") },
    ]);
    expect(skew?.sourceA).toBe("ui");
    expect(skew?.sourceB).toBe("b");
  });
});
