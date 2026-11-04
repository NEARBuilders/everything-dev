import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOCKFILE_NAME,
  lockfileFingerprint,
  lockfileOf,
  lockfilePath,
  parseLockfile,
  serializeLockfile,
} from "../../src/services/lockfile/schema";
import { pointerFingerprint } from "../../src/services/registry/fingerprint";
import { BosConfigSchema } from "../../src/types";

/**
 * Golden wire tests for the composition lockfile (ADR 0042, ticket 01): the
 * lockfile's fingerprint IS the pointer fingerprint of the frozen config
 * (`lockfileOf` ≡ `pointerFingerprint`), and it recomputes from the stored
 * `remotes` record alone (`lockfileFingerprint`) because the record is written
 * in walk order — including entries that freeze nothing. Wire ref:
 * `bos.lock.json` at the app root.
 */

const config = BosConfigSchema.parse({
  account: "v1.citynode.near",
  domain: "citynode.app",
  app: {
    host: {
      development: "local:host",
      production: "https://cdn/host/",
      digest: { manifest: "versions/aaa.json", integrity: "sha384-host-manifest-sri" },
    },
    ui: {
      development: "local:ui",
      production: "https://cdn/ui/",
      digest: { manifest: "versions/bbb.json", integrity: "sha384-manifest-sri" },
      ssr: "https://cdn/ui/ssr/",
      ssrIntegrity: "sha384-ssr-sri",
    },
    api: {
      development: "local:api",
      production: "https://cdn/api/",
      digest: { manifest: "versions/ccc.json", integrity: "sha384-api-manifest-sri" },
    },
  },
  plugins: {
    votes: "votes",
    auth: {
      name: "@everything-dev/auth-plugin",
      development: "local:plugins/auth",
      production: "https://cdn/auth/",
      digest: { manifest: "versions/ddd.json", integrity: "sha384-auth-manifest-sri" },
      ui: {
        name: "auth-ui",
        development: "local:plugins/auth/ui",
        production: "https://cdn/auth-ui/",
        digest: { manifest: "versions/eee.json", integrity: "sha384-auth-ui-manifest-sri" },
      },
    },
  },
});

const ACCOUNT = "dev.everything.near";
const GATEWAY = "citynode.app";

describe("lockfilePath", () => {
  it("is bos.lock.json at the app root", () => {
    expect(lockfilePath("/apps/citynode")).toBe(path.join("/apps/citynode", LOCKFILE_NAME));
    expect(LOCKFILE_NAME).toBe("bos.lock.json");
  });
});

describe("lockfileOf", () => {
  it("freezes the pointer fingerprint as THE composition identity", () => {
    const lock = lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config });
    expect(lock.fingerprint).toBe(pointerFingerprint(config));
  });

  it("recomputes the same fingerprint from the stored remotes record alone", () => {
    const lock = lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config });
    expect(lockfileFingerprint(lock)).toBe(lock.fingerprint);
  });

  it("freezes descriptors and bare plugin refs in walk order", () => {
    const lock = lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config });
    expect(Object.keys(lock.remotes)).toEqual([
      "app.host",
      "app.ui",
      "app.api",
      "plugins.votes",
      "plugins.auth",
      "plugins.auth.ui",
    ]);
    expect(lock.remotes["app.host"]).toEqual({
      kind: "descriptor",
      base: "https://cdn/host/",
      digest: { manifest: "versions/aaa.json", integrity: "sha384-host-manifest-sri" },
    });
    expect(lock.remotes["plugins.votes"]).toEqual({ kind: "pluginRef", ref: "votes" });
  });

  it("records the release when pinned, null when on a channel", () => {
    expect(lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config }).release).toBeNull();
    expect(
      lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config, release: "2.0.0-rc.37" }).release,
    ).toBe("2.0.0-rc.37");
  });

  it("carries optional shared-singleton and contract records when provided", () => {
    const lock = lockfileOf({
      account: ACCOUNT,
      gateway: GATEWAY,
      config,
      sharedSingletons: { react: "19.1.0" },
      contracts: { "plugins.auth": "abc123" },
    });
    expect(lock.sharedSingletons).toEqual({ react: "19.1.0" });
    expect(lock.contracts).toEqual({ "plugins.auth": "abc123" });
    expect(
      lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config }).sharedSingletons,
    ).toBeUndefined();
  });
});

describe("round-trip", () => {
  it("survives serialize/parse with the fingerprint recomputable", () => {
    const lock = lockfileOf({
      account: ACCOUNT,
      gateway: GATEWAY,
      config,
      release: "2.0.0-rc.37",
      sharedSingletons: { react: "19.1.0" },
    });
    const restored = parseLockfile(serializeLockfile(lock));
    expect(restored).toEqual(lock);
    expect(lockfileFingerprint(restored)).toBe(lock.fingerprint);
  });

  it("detects a hand-edited fingerprint — parse accepts the shape, the recomputation refuses it", () => {
    const lock = lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config });
    const tampered = { ...lock, fingerprint: "0".repeat(16) };
    expect(parseLockfile(serializeLockfile(tampered))).toEqual(tampered);
    expect(lockfileFingerprint(tampered)).not.toBe(tampered.fingerprint);
  });

  it("rejects unknown top-level keys — the lockfile is derived, never extended by hand", () => {
    const lock = lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config });
    expect(() => parseLockfile(serializeLockfile({ ...lock, note: "hand-edited" }))).toThrow();
  });
});
