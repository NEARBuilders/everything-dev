import { generateSnapshotFromManifest, getResourceUrl } from "@module-federation/sdk";
import { isManifestDocumentUrl, manifestBaseOf } from "every-plugin/ui/manifest/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getFederationInstance,
  patchManifestFetchForSsrPublicPath,
  registerRemote,
} from "../../src/services/federation/service";

const FIXTURE_BASE = "http://localhost:4105";
const HASHED_ENTRY_NAME = "remoteEntry.f66f838102d45ffa.js";
const HASHED_MANIFEST_URL = `${FIXTURE_BASE}/mf-manifest.0190fae63d7daaa5.json`;

const hostManifest = () => ({
  id: "host",
  name: "host",
  metaData: {
    name: "host",
    type: "app",
    buildInfo: { buildVersion: "2.0.0-rc.44", buildName: "host" },
    remoteEntry: { name: HASHED_ENTRY_NAME, path: "", type: "commonjs-module" },
    globalName: "host",
    pluginVersion: "2.9.2",
    publicPath: "/",
  },
  shared: [],
  exposes: [{ name: "./Server", path: "./Server" }],
});

const stubManifestResponse = (body: unknown) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
};

const composedNodeEntryUrl = (manifest: unknown): string => {
  const snapshot = generateSnapshotFromManifest(
    manifest as Parameters<typeof generateSnapshotFromManifest>[0],
  );
  return getResourceUrl(snapshot as never, (snapshot as { remoteEntry: string }).remoteEntry);
};

describe("manifest document url shapes", () => {
  it("recognizes both naming regimes", () => {
    expect(isManifestDocumentUrl("http://cdn.example/ui/mf-manifest.json")).toBe(true);
    expect(isManifestDocumentUrl(HASHED_MANIFEST_URL)).toBe(true);
    expect(isManifestDocumentUrl(`${HASHED_MANIFEST_URL}?t=1`)).toBe(true);
    expect(isManifestDocumentUrl("http://cdn.example/ui")).toBe(false);
    expect(isManifestDocumentUrl(`${FIXTURE_BASE}/${HASHED_ENTRY_NAME}`)).toBe(false);
    expect(
      isManifestDocumentUrl("https://cdn.example/versions/v1/mf-manifest.abc1234567.json"),
    ).toBe(true);
  });

  it("derives the serving base for every layout", () => {
    expect(manifestBaseOf(HASHED_MANIFEST_URL)).toBe(`${FIXTURE_BASE}/`);
    expect(manifestBaseOf(`${FIXTURE_BASE}/mf-manifest.json`)).toBe(`${FIXTURE_BASE}/`);
    expect(manifestBaseOf("https://cdn.example/ui/versions/v1/mf-manifest.abc1234567.json")).toBe(
      "https://cdn.example/ui/versions/v1/",
    );
  });
});

describe("patchManifestFetchForSsrPublicPath", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes hash-named manifest documents, not just the fixed name", async () => {
    stubManifestResponse(hostManifest());
    const instance = getFederationInstance();
    patchManifestFetchForSsrPublicPath(instance);

    const res = (await instance.loaderHook.lifecycle.fetch.emit(HASHED_MANIFEST_URL, {})) as
      | Response
      | undefined;
    expect(res).toBeInstanceOf(Response);
    const json = await (res as Response).json();
    expect(json.metaData.ssrPublicPath).toBe(`${FIXTURE_BASE}/`);
  });

  it("keeps the composed node entry url absolute — the #875 regression shape", async () => {
    stubManifestResponse(hostManifest());
    const instance = getFederationInstance();
    patchManifestFetchForSsrPublicPath(instance);

    const res = (await instance.loaderHook.lifecycle.fetch.emit(HASHED_MANIFEST_URL, {})) as
      | Response
      | undefined;
    const patched = await (res as Response).json();

    expect(composedNodeEntryUrl(patched)).toBe(`${FIXTURE_BASE}/${HASHED_ENTRY_NAME}`);
  });

  it("leaves the unpatched document relative — the pre-fix failure this guards against", () => {
    const composed = composedNodeEntryUrl(hostManifest());
    expect(composed).toBe(`/${HASHED_ENTRY_NAME}`);
    expect(composed.startsWith("http")).toBe(false);
  });

  it("passes non-manifest urls through untouched", async () => {
    stubManifestResponse(hostManifest());
    const instance = getFederationInstance();
    patchManifestFetchForSsrPublicPath(instance);

    const emitted = await instance.loaderHook.lifecycle.fetch.emit(
      `${FIXTURE_BASE}/${HASHED_ENTRY_NAME}`,
      {},
    );
    expect(emitted).toBeUndefined();
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(0);
  });
});

describe("registerRemote manifest type inference", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("infers manifest for hash-named manifest documents", async () => {
    await registerRemote({ name: "probe-host", entry: HASHED_MANIFEST_URL });
    const instance = getFederationInstance();
    const registered = (instance.options.remotes as Array<{ name: string; type?: string }>).find(
      (remote) => remote.name === "probe-host",
    );
    expect(registered?.type).toBe("manifest");
  });
});
