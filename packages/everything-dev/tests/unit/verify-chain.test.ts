import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { formatChainFailures, verifyChain } from "../../src/services/verify/chain";
import { verifyPublishedPins } from "../../src/services/deploy/verify";
import type { BosConfigInput } from "../../src/types";

const sriOf = (content: string): string =>
  `sha384-${createHash("sha384").update(content).digest("base64")}`;

const dirId = "0123456789abcdef";
const entryName = "remoteEntry.8f3a.js";
const ssrName = "remoteEntry.server.153c.js";
const chunkName = "__federation_expose_plugin.js";

const manifestDoc = (input: {
  files?: Record<string, string>;
  ssr?: { entry: string; integrity: string };
  dir?: string;
}): string =>
  JSON.stringify({
    version: "8f3ac1d2feedbeef",
    entry: entryName,
    entryIntegrity: sriOf("the entry bytes"),
    ...(input.dir ? { dir: input.dir } : {}),
    ...(input.ssr ? { ssr: input.ssr } : {}),
    ...(input.files ? { files: input.files } : {}),
  });

function fixtureCdn(objects: Record<string, string>) {
  const hits: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    hits.push(url);
    const body = objects[url];
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(body, { status: 200 });
  }) as typeof fetch;
  return { impl, hits };
}

const pinnedConfig = (integrity: string): BosConfigInput =>
  ({
    account: "a.test",
    domain: "gw.test",
    app: {
      auth: {
        development: "local:auth",
        production: "https://cdn.test/bundles/a.test/gw.test/auth/",
        digest: { manifest: "versions/8f3ac1d2feedbeef.json", integrity },
      },
    },
  }) as BosConfigInput;

const healthyObjects = (extra: Record<string, string> = {}): Record<string, string> => {
  const dir = `versions/${dirId}`;
  const files = {
    [entryName]: sriOf("the entry bytes"),
    [chunkName]: sriOf("the chunk bytes"),
  };
  return {
    [`https://cdn.test/bundles/a.test/gw.test/auth/versions/8f3ac1d2feedbeef.json`]: manifestDoc({
      files,
      dir,
    }),
    [`https://cdn.test/bundles/a.test/gw.test/auth/${dir}/${entryName}`]: "the entry bytes",
    [`https://cdn.test/bundles/a.test/gw.test/auth/${dir}/${chunkName}`]: "the chunk bytes",
    ...extra,
  };
};

const healthyPin = (objects: Record<string, string>) =>
  pinnedConfig(
    sriOf(
      objects["https://cdn.test/bundles/a.test/gw.test/auth/versions/8f3ac1d2feedbeef.json"],
    ),
  );

describe("verifyChain — pointer depth", () => {
  it("SRI-verifies the pinned manifest documents and stops there", async () => {
    const { impl, hits } = fixtureCdn(healthyObjects());
    const chain = await verifyChain({ config: healthyPin(healthyObjects()), depth: "pointer", fetchImpl: impl });
    expect(chain.ok).toBe(true);
    expect(chain.remotes[0]?.manifestOk).toBe(true);
    expect(chain.entries).toHaveLength(0);
    expect(chain.remotes[0]?.filesChecked).toBe(0);
    expect(hits.filter((url) => !url.endsWith(".json"))).toHaveLength(0);
  });

  it("fails at the named error when a pin's document no longer matches", async () => {
    const objects = healthyObjects();
    const chain = await verifyChain({
      config: pinnedConfig("sha384-not-the-served-bytes"),
      depth: "pointer",
      fetchImpl: fixtureCdn(objects).impl,
    });
    expect(chain.ok).toBe(false);
    expect(chain.remotes[0]?.manifestOk).toBe(false);
    expect(chain.remotes[0]?.manifestReason).toContain("SRI mismatch");
    expect(chain.remotes[0]?.manifestReason).toContain("sha384-not-the-served-bytes");
  });
});

describe("verifyChain — entries depth", () => {
  it("verifies the entry and ssr bytes beyond the manifest", async () => {
    const dir = `versions/${dirId}`;
    const objects = healthyObjects({
      [`https://cdn.test/bundles/a.test/gw.test/auth/${dir}/remoteEntry.server.153c.js`]:
        "the ssr bytes",
    });
    const manifestWithSsr = manifestDoc({
      files: { [entryName]: sriOf("the entry bytes"), [chunkName]: sriOf("the chunk bytes") },
      ssr: { entry: ssrName, integrity: sriOf("the ssr bytes") },
      dir,
    });
    objects["https://cdn.test/bundles/a.test/gw.test/auth/versions/8f3ac1d2feedbeef.json"] =
      manifestWithSsr;

    const { impl, hits } = fixtureCdn(objects);
    const chain = await verifyChain({
      config: pinnedConfig(sriOf(manifestWithSsr)),
      depth: "entries",
      fetchImpl: impl,
    });
    expect(chain.ok).toBe(true);
    expect(chain.entries).toHaveLength(2);
    expect(chain.entries.every((leg) => leg.ok)).toBe(true);
    expect(hits.some((url) => url.endsWith(ssrName))).toBe(true);
    expect(hits.some((url) => url.endsWith(chunkName))).toBe(false);
  });

  it("names the rotted entry at the entries depth", async () => {
    const objects = healthyObjects();
    const dir = `versions/${dirId}`;
    objects[`https://cdn.test/bundles/a.test/gw.test/auth/${dir}/${entryName}`] =
      "the parent overwrote the entry";
    const { impl } = fixtureCdn(objects);
    const chain = await verifyChain({
      config: healthyPin(objects),
      depth: "entries",
      fetchImpl: impl,
    });
    expect(chain.ok).toBe(false);
    const failed = chain.entries.find((leg) => !leg.ok);
    expect(failed?.reason).toContain("entry SRI mismatch");
    expect(failed?.reason).toContain("pin");
    expect(failed?.reason).toContain("served");
    expect(formatChainFailures(chain)).toContain("entry SRI mismatch");
  });

  it("names a missing entry as a provenance failure", async () => {
    const objects = healthyObjects();
    for (const key of Object.keys(objects)) {
      if (key.endsWith(entryName)) delete objects[key];
    }
    const chain = await verifyChain({
      config: healthyPin(objects),
      depth: "entries",
      fetchImpl: fixtureCdn(objects).impl,
    });
    expect(chain.ok).toBe(false);
    const failed = chain.entries.find((leg) => !leg.ok);
    expect(failed?.reason).toContain("entry GET 404");
  });
});

describe("verifyChain — files depth (the bos verify sweep)", () => {
  it("walks every file in the files map and names the drifted one", async () => {
    const objects = healthyObjects();
    const dir = `versions/${dirId}`;
    objects[`https://cdn.test/bundles/a.test/gw.test/auth/${dir}/${chunkName}`] =
      "the parent overwrote this";
    const { impl } = fixtureCdn(objects);
    const chain = await verifyChain({
      config: healthyPin(objects),
      depth: "files",
      fetchImpl: impl,
    });
    expect(chain.ok).toBe(false);
    expect(chain.remotes[0]?.mismatches).toHaveLength(1);
    expect(chain.remotes[0]?.mismatches[0]?.file).toBe(chunkName);
    expect(chain.remotes[0]?.mismatches[0]?.actual).toBe(sriOf("the parent overwrote this"));
    expect(chain.entries).toHaveLength(0);
  });

  it("verifyPublishedPins stays byte-comparable — files depth through the same walker", async () => {
    const objects = healthyObjects();
    const report = await verifyPublishedPins({
      config: healthyPin(objects),
      fetchImpl: fixtureCdn(objects).impl,
    });
    expect(report.remotes).toHaveLength(1);
    const remote = report.remotes[0]!;
    expect(remote.manifestOk).toBe(true);
    expect(remote.legacy).toBe(false);
    expect(remote.dir).toBe(`versions/${dirId}`);
    expect(remote.filesChecked).toBe(2);
    expect(remote.mismatches).toEqual([]);
  });
});
