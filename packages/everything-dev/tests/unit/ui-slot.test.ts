import { describe, expect, it } from "vitest";
import { type EntrySlot, entryUrls } from "../../src/ui/slot";

const APPS = "https://cdn.example.com/apps";
const APPS_SSR = "https://cdn.example.com/apps-ssr";

const remoteSlot = (over: Partial<EntrySlot> = {}): EntrySlot => ({
  name: "apps",
  url: APPS,
  entryUrl: `${APPS}/remoteEntry.aaa.js`,
  integrity: "sha384-entry",
  ssrUrl: APPS_SSR,
  ssrEntryUrl: `${APPS_SSR}/remoteEntry.server.aaa.js`,
  ssrIntegrity: "sha384-ssr",
  browserManifestUrl: `${APPS}/mf-manifest.bbb.json`,
  ...over,
});

describe("entryUrls — pinned remote slot", () => {
  it("production: pin-derived hashed entries win on both surfaces, no busters", () => {
    expect(entryUrls(remoteSlot(), "production")).toEqual({
      web: `${APPS}/remoteEntry.aaa.js`,
      ssr: `${APPS_SSR}/remoteEntry.server.aaa.js`,
      browserManifest: `${APPS}/mf-manifest.bbb.json`,
    });
  });

  it("development: the pin-derived entry still wins over the fixed dev name", () => {
    const urls = entryUrls(remoteSlot(), "development");
    expect(urls.web).toBe(`${APPS}/remoteEntry.aaa.js`);
    expect(urls.ssr).toBe(`${APPS_SSR}/remoteEntry.server.aaa.js`);
  });

  it("hashed URLs never grow a buster, even with integrity present", () => {
    const urls = entryUrls(remoteSlot(), "development");
    expect(urls.web).not.toContain("?");
    expect(urls.ssr).not.toContain("?");
  });
});

describe("entryUrls — dev fixed names (no pin derivation in development)", () => {
  it("web buster comes from integrity; server buster from ssrIntegrity", () => {
    const urls = entryUrls(
      remoteSlot({ entryUrl: undefined, ssrEntryUrl: undefined }),
      "development",
    );
    expect(urls.web).toBe(`${APPS}/remoteEntry.js?v=sha384-entry`);
    expect(urls.ssr).toBe(`${APPS_SSR}/remoteEntry.server.js?v=sha384-ssr`);
  });

  it("no integrity sources — plain fixed dev names, exactly the dev contract", () => {
    const urls = entryUrls(
      remoteSlot({
        entryUrl: undefined,
        ssrEntryUrl: undefined,
        integrity: undefined,
        ssrIntegrity: undefined,
      }),
      "development",
    );
    expect(urls.web).toBe(`${APPS}/remoteEntry.js`);
    expect(urls.ssr).toBe(`${APPS_SSR}/remoteEntry.server.js`);
  });

  it("server buster order: ssrIntegrity beats containerVersion", () => {
    const urls = entryUrls(
      remoteSlot({
        entryUrl: undefined,
        ssrEntryUrl: undefined,
        ssrIntegrity: "sha384-ssr",
        containerVersion: "1727",
      }),
      "development",
    );
    expect(urls.ssr).toBe(`${APPS_SSR}/remoteEntry.server.js?v=sha384-ssr`);
  });

  it("containerVersion is the dev-only freshness fallback for local containers", () => {
    const urls = entryUrls(
      remoteSlot({
        entryUrl: undefined,
        ssrEntryUrl: undefined,
        ssrIntegrity: undefined,
        containerVersion: "1727987612345",
      }),
      "development",
    );
    expect(urls.ssr).toBe(`${APPS_SSR}/remoteEntry.server.js?v=1727987612345`);
  });
});

describe("entryUrls — local slot (atomic-deploys 08)", () => {
  const localSlot = (over: Partial<EntrySlot> = {}): EntrySlot => ({
    name: "auth-ui",
    url: "http://localhost:4111",
    localPath: "/w/plugins/auth-ui",
    ssrUrl: "http://127.0.0.1:4112/ssr",
    containerVersion: "1727987612345",
    ...over,
  });

  it("dev fixed web entry from the dev server base, SSR container from the loopback base", () => {
    const urls = entryUrls(localSlot(), "development");
    expect(urls.web).toBe("http://localhost:4111/remoteEntry.js");
    expect(urls.ssr).toBe("http://127.0.0.1:4112/ssr/remoteEntry.server.js?v=1727987612345");
  });

  it("browserManifest is structurally absent — local slots have no pin-derived manifest", () => {
    expect(entryUrls(localSlot(), "development").browserManifest).toBeUndefined();
  });

  it("a stamped browserManifestUrl never survives a local slot", () => {
    const urls = entryUrls(
      localSlot({ browserManifestUrl: "https://cdn.example.com/apps/mf-manifest.aaa.json" }),
      "development",
    );
    expect(urls.browserManifest).toBeUndefined();
  });
});

describe("entryUrls — base selection (publicUrl ?? url, ADR 0011)", () => {
  it("dev fixed web entry rides the publicUrl base, trailing slash trimmed", () => {
    const urls = entryUrls(
      remoteSlot({ entryUrl: undefined, publicUrl: "https://bundles.example.com/apps/" }),
      "development",
    );
    expect(urls.web).toBe("https://bundles.example.com/apps/remoteEntry.js?v=sha384-entry");
  });

  it("a pin-derived entryUrl ignores the base entirely", () => {
    const urls = entryUrls(
      remoteSlot({ publicUrl: "https://bundles.example.com/apps/" }),
      "production",
    );
    expect(urls.web).toBe(`${APPS}/remoteEntry.aaa.js`);
  });

  it("an absent base degrades to the root-relative fixed name (client-shell head path)", () => {
    const urls = entryUrls(
      { name: "ui", entryUrl: undefined, integrity: "sha384-entry" },
      "development",
    );
    expect(urls.web).toBe("/remoteEntry.js?v=sha384-entry");
  });
});

describe("entryUrls — loud throw outside development", () => {
  it("web surface: a remote slot without the derived entry names the slot and surface", () => {
    expect(() => entryUrls(remoteSlot({ entryUrl: undefined }), "production").web).toThrow(
      /slot "apps" has no derived web entry/,
    );
  });

  it("ssr surface: an SSR-configured slot without the derived ssr entry names the slot and surface", () => {
    expect(() => entryUrls(remoteSlot({ ssrEntryUrl: undefined }), "production").ssr).toThrow(
      /slot "apps" has no derived ssr entry/,
    );
  });

  it("surfaces throw independently — resolving web does not trip the ssr surface", () => {
    const urls = entryUrls(remoteSlot({ ssrEntryUrl: undefined }), "production");
    expect(urls.web).toBe(`${APPS}/remoteEntry.aaa.js`);
  });

  it("a slot with no SSR coordinates at all resolves web without throwing — ssr is undefined", () => {
    const urls = entryUrls(
      {
        name: "api",
        url: "https://api.example.com",
        entryUrl: "https://api.example.com/remoteEntry.aaa.js",
      },
      "production",
    );
    expect(urls.web).toBe("https://api.example.com/remoteEntry.aaa.js");
    expect(urls.ssr).toBeUndefined();
    expect(urls.browserManifest).toBeUndefined();
  });

  it("staging resolves like production — only development gets fixed names", () => {
    expect(() => entryUrls(remoteSlot({ entryUrl: undefined }), "staging").web).toThrow(
      /has no derived web entry/,
    );
  });
});
