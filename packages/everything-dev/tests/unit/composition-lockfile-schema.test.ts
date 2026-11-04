import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  digestOfLockfile,
  LOCKFILE_NAME,
  lockfileFingerprint,
  lockfileOf,
  lockfilePath,
  parseLockfile,
  serializeLockfile,
  writeLockfile,
  writeLockfileSync,
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

describe("writeLockfile — the producer seam (ADR 0042 ticket 02)", () => {
  it("writes atomically and reports written→unchanged on the identical re-run", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lockfile-write-"));
    const lock = lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config });
    const first = await writeLockfile(lock, dir);
    expect(first.status).toBe("written");
    expect(first.fingerprint).toBe(lock.fingerprint);
    const second = await writeLockfile(lock, dir);
    expect(second.status).toBe("unchanged");
    expect(parseLockfile(await readFile(path.join(dir, "bos.lock.json"), "utf8"))).toEqual(lock);
  });

  it("--check passes when the file matches, drifts when missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lockfile-check-"));
    const lock = lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config });
    const missing = await writeLockfile(lock, dir, { check: true });
    expect(missing.status).toBe("drift");
    expect(missing.drift[0]).toContain("missing");
    await writeLockfile(lock, dir);
    const ok = await writeLockfile(lock, dir, { check: true });
    expect(ok.status).toBe("unchanged");
    expect(ok.drift).toEqual([]);
  });

  it("--check drifts when the frozen composition differs from the resolved one", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lockfile-drift-"));
    const stale = lockfileOf({
      account: ACCOUNT,
      gateway: GATEWAY,
      config,
      release: "2.0.0-rc.36",
    });
    const fresh = lockfileOf({
      account: ACCOUNT,
      gateway: GATEWAY,
      config,
      release: "2.0.0-rc.37",
    });
    await writeLockfile(stale, dir);
    const drifted = await writeLockfile(fresh, dir, { check: true });
    expect(drifted.status).toBe("drift");
    expect(drifted.drift.join(" ")).toContain("differs from the resolved composition");
    expect(parseLockfile(await readFile(path.join(dir, "bos.lock.json"), "utf8"))).toEqual(stale);
  });
});

describe("digestOfLockfile + writeLockfileSync — the train's producer seam (ADR 0042 ticket 04)", () => {
  it("digests the serialized bytes deterministically", () => {
    const lock = lockfileOf({ account: ACCOUNT, gateway: GATEWAY, config });
    const serialized = serializeLockfile(lock);
    expect(digestOfLockfile(serialized)).toBe(digestOfLockfile(serialized));
    expect(digestOfLockfile(serialized)).toMatch(/^[0-9a-f]{64}$/);
    expect(digestOfLockfile(`${serialized}x`)).not.toBe(digestOfLockfile(serialized));
  });

  it("writes sync (the train is sync-fs) — atomic, parent dirs created", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lockfile-sync-"));
    const lock = lockfileOf({
      account: ACCOUNT,
      gateway: GATEWAY,
      config,
      release: "2.0.0-rc.37",
    });
    const target = writeLockfileSync(lock, dir);
    expect(target).toBe(path.join(dir, "bos.lock.json"));
    expect(parseLockfile(await readFile(target, "utf8"))).toEqual(lock);
  });
});
