import { createHash } from "node:crypto";
import {
  composeVersionManifest,
  type ManifestSignature,
  signaturePayloadOf,
} from "every-plugin/version-manifest";
import { generateKey, type KeyPair } from "near-kit";
import { describe, expect, it } from "vitest";
import {
  signManifestPayload,
  verifyManifestSignature,
} from "../../src/services/deploy/manifest-signature";
import { SignatureInvalid } from "../../src/services/verify/engine";

/** Data.TaggedError carries no message string — assert on the tag + the
 * reason the verifier names. */
const signatureErrorOf = (run: () => void): string => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SignatureInvalid);
    return (error as SignatureInvalid).reason;
  }
  throw new Error("expected the verification to throw");
};

import type { WorkspaceVersionManifest } from "every-plugin/version-manifest";
import { formatChainFailures, verifyChain } from "../../src/services/verify/chain";
import type { BosConfigInput } from "../../src/types";

const sriOf = (content: string): string =>
  `sha384-${createHash("sha384").update(content).digest("base64")}`;

const payload = signaturePayloadOf({
  version: "8f3ac1d2feedbeef",
  entry: "remoteEntry.8f3a.js",
  entryIntegrity: sriOf("the entry bytes"),
} as WorkspaceVersionManifest);

describe("manifest signature primitive", () => {
  it("round-trips: the signer's key verifies its own payload", () => {
    const key = generateKey();
    const signature = signManifestPayload(payload, key.secretKey);
    expect(signature.algorithm).toBe("ed25519");
    verifyManifestSignature(payload, signature, key.publicKey.toString());
  });

  it("accepts the key record in bare base58 too", () => {
    const key = generateKey();
    const signature = signManifestPayload(payload, key.secretKey);
    const bare = key.publicKey.toString().replace(/^ed25519:/, "");
    verifyManifestSignature(payload, signature, bare);
  });

  it("refuses a tampered payload", () => {
    const key = generateKey();
    const signature = signManifestPayload(payload, key.secretKey);
    expect(
      signatureErrorOf(() =>
        verifyManifestSignature(`${payload} `, signature, key.publicKey.toString()),
      ),
    ).toContain("does not verify");
  });

  it("refuses a signature by a key the config never registered", () => {
    const signer = generateKey();
    const registered = generateKey();
    const signature = signManifestPayload(payload, signer.secretKey);
    expect(
      signatureErrorOf(() =>
        verifyManifestSignature(payload, signature, registered.publicKey.toString()),
      ),
    ).toContain("signed by unregistered key");
  });

  it("refuses a missing signature and a malformed value", () => {
    const key = generateKey();
    expect(
      signatureErrorOf(() => verifyManifestSignature(payload, undefined, key.publicKey.toString())),
    ).toContain("demands attribution");
    const bad: ManifestSignature = {
      algorithm: "ed25519",
      publicKey: key.publicKey.toString(),
      value: Buffer.from("short").toString("base64"),
    };
    expect(
      signatureErrorOf(() => verifyManifestSignature(payload, bad, key.publicKey.toString())),
    ).toContain("ed25519 signatures are 64");
  });

  it("the payload is whitespace-insensitive and excludes the signature field", () => {
    const doc = {
      version: "8f3ac1d2feedbeef",
      entry: "remoteEntry.8f3a.js",
      entryIntegrity: sriOf("the entry bytes"),
    };
    const pretty = JSON.parse(JSON.stringify(doc, null, 4)) as WorkspaceVersionManifest;
    expect(signaturePayloadOf(pretty)).toBe(signaturePayloadOf(doc));
    const withSignature = {
      ...doc,
      signature: { algorithm: "ed25519", publicKey: "x", value: "y" },
    };
    expect(signaturePayloadOf(withSignature as WorkspaceVersionManifest)).toBe(
      signaturePayloadOf(doc),
    );
  });

  it("the version id ignores attribution — signing never moves the pin", () => {
    const input = {
      entry: "remoteEntry.8f3a.js",
      entryIntegrity: sriOf("the entry bytes"),
    };
    expect(composeVersionManifest(input).version).toBe(composeVersionManifest(input).version);
    expect(composeVersionManifest(input).signature).toBeUndefined();
  });
});

const dirId = "0123456789abcdef";
const entryName = "remoteEntry.8f3a.js";
const chunkName = "__federation_expose_plugin.js";

const entryBytes = "the entry bytes";
const chunkBytes = "the chunk bytes";

const base = "https://cdn.test/bundles/a.test/gw.test/auth/";

interface SignedFixture {
  docBytes: string;
  signedWith: KeyPair;
}

const manifestDoc = (signer?: KeyPair): SignedFixture => {
  const doc: WorkspaceVersionManifest = {
    version: "8f3ac1d2feedbeef",
    entry: entryName,
    entryIntegrity: sriOf(entryBytes),
    dir: `versions/${dirId}`,
    files: {
      [entryName]: sriOf(entryBytes),
      [chunkName]: sriOf(chunkBytes),
    },
  };
  const signature = signer
    ? ({
        algorithm: "ed25519",
        publicKey: signer.publicKey.toString(),
        value: Buffer.from(
          signer.sign(new TextEncoder().encode(signaturePayloadOf(doc))).data,
        ).toString("base64"),
      } as ManifestSignature)
    : undefined;
  const document = signature ? { ...doc, signature } : doc;
  return {
    docBytes: `${JSON.stringify(document, null, 2)}\n`,
    signedWith: signer ?? generateKey(),
  };
};

const objectsFor = (docBytes: string): Record<string, string> => ({
  [`${base}versions/8f3ac1d2feedbeef.json`]: docBytes,
  [`${base}versions/${dirId}/${entryName}`]: entryBytes,
  [`${base}versions/${dirId}/${chunkName}`]: chunkBytes,
});

const fixtureCdn = (objects: Record<string, string>) =>
  (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = objects[url];
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(body, { status: 200 });
  }) as typeof fetch;

/** The pin attests the doc bytes as served — SRI passes; attribution is the
 * only leg that can disagree. */
const pinnedConfig = (docBytes: string, verification?: { publicKey: string } | "off") =>
  ({
    account: "a.test",
    domain: "gw.test",
    ...(verification
      ? { publish: { verification: verification === "off" ? "off" : verification } }
      : {}),
    app: {
      auth: {
        development: "local:auth",
        production: base,
        digest: { manifest: "versions/8f3ac1d2feedbeef.json", integrity: sriOf(docBytes) },
      },
    },
  }) as BosConfigInput;

describe("the walker's attribution leg", () => {
  it("attribution-off: unsigned manifests verify as today, no signature leg reported", async () => {
    const { docBytes } = manifestDoc();
    const impl = fixtureCdn(objectsFor(docBytes));
    const chain = await verifyChain({
      config: pinnedConfig(docBytes),
      depth: "entries",
      fetchImpl: impl,
    });
    expect(chain.ok).toBe(true);
    expect(chain.remotes[0]?.signature).toBeUndefined();
  });

  it("a validly signed manifest reports the signature ok at every depth", async () => {
    const signer = generateKey();
    const { docBytes } = manifestDoc(signer);
    const impl = fixtureCdn(objectsFor(docBytes));
    for (const depth of ["pointer", "entries", "files"] as const) {
      const chain = await verifyChain({
        config: pinnedConfig(docBytes, { publicKey: signer.publicKey.toString() }),
        depth,
        fetchImpl: impl,
      });
      expect(chain.ok, depth).toBe(true);
      expect(chain.remotes[0]?.signature, depth).toEqual({ ok: true });
    }
  });

  it("a manifest signed by an unregistered key fails the signature leg at every depth — integrity legs unaffected", async () => {
    const rogue = generateKey();
    const { docBytes } = manifestDoc(rogue);
    const registered = generateKey();
    const impl = fixtureCdn(objectsFor(docBytes));
    for (const depth of ["pointer", "entries", "files"] as const) {
      const chain = await verifyChain({
        config: pinnedConfig(docBytes, { publicKey: registered.publicKey.toString() }),
        depth,
        fetchImpl: impl,
      });
      expect(chain.ok, depth).toBe(false);
      expect(chain.remotes[0]?.manifestOk, depth).toBe(true);
      expect(chain.remotes[0]?.signature?.ok, depth).toBe(false);
      expect(chain.remotes[0]?.signature?.reason ?? "", depth).toContain("unregistered key");
    }
    const rendered = formatChainFailures(
      await verifyChain({
        config: pinnedConfig(docBytes, { publicKey: registered.publicKey.toString() }),
        depth: "files",
        fetchImpl: impl,
      }),
    );
    expect(rendered).toContain("signature —");
  });

  it("a missing signature fails loud when attribution is demanded", async () => {
    const { docBytes } = manifestDoc();
    const registered = generateKey();
    const chain = await verifyChain({
      config: pinnedConfig(docBytes, { publicKey: registered.publicKey.toString() }),
      depth: "pointer",
      fetchImpl: fixtureCdn(objectsFor(docBytes)),
    });
    expect(chain.ok).toBe(false);
    expect(chain.remotes[0]?.signature?.reason ?? "").toContain("demands attribution");
  });

  it("rotation: the old signature reports SignatureInvalid while the entry legs stay green", async () => {
    const oldKey = generateKey();
    const { docBytes } = manifestDoc(oldKey);
    const newKey = generateKey();
    const impl = fixtureCdn(objectsFor(docBytes));
    const chain = await verifyChain({
      config: pinnedConfig(docBytes, { publicKey: newKey.publicKey.toString() }),
      depth: "files",
      fetchImpl: impl,
    });
    expect(chain.ok).toBe(false);
    expect(chain.remotes[0]?.signature?.reason ?? "").toContain("unregistered key");
    expect(chain.remotes[0]?.manifestOk).toBe(true);
    expect(chain.remotes[0]?.mismatches).toEqual([]);
    expect(chain.remotes[0]?.filesChecked).toBeGreaterThan(0);
  });

  it("a tampered document — a signature over bytes that differ from the served doc — fails the signature leg", async () => {
    const signer = generateKey();
    const doc: WorkspaceVersionManifest = {
      version: "8f3ac1d2feedbeef",
      entry: entryName,
      entryIntegrity: sriOf(entryBytes),
      dir: `versions/${dirId}`,
      files: { [entryName]: sriOf(entryBytes), [chunkName]: sriOf(chunkBytes) },
    };
    // The attacker replaced a chunk's SRI and re-signed the TAMPERED payload,
    // but the served bytes (and the pin attesting them) are the honest ones —
    // SRI passes, the signature covers different bytes than served.
    const tampered = { ...doc, files: { ...doc.files, [chunkName]: sriOf("evil bytes") } };
    const signature = {
      algorithm: "ed25519" as const,
      publicKey: signer.publicKey.toString(),
      value: Buffer.from(
        signer.sign(new TextEncoder().encode(signaturePayloadOf(tampered))).data,
      ).toString("base64"),
    };
    const document = { ...doc, signature };
    const docBytes = `${JSON.stringify(document, null, 2)}\n`;
    const chain = await verifyChain({
      config: pinnedConfig(docBytes, { publicKey: signer.publicKey.toString() }),
      depth: "entries",
      fetchImpl: fixtureCdn(objectsFor(docBytes)),
    });
    expect(chain.ok).toBe(false);
    expect(chain.remotes[0]?.manifestOk).toBe(true);
    expect(chain.remotes[0]?.signature?.ok).toBe(false);
  });
});
